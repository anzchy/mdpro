# Purpose: Bash command parsing for the rule 70 role guard (role-guard.sh), moved out
# of the hook in D186 so the hook and every module stay well under 300 lines.
# git_calls(cmd, cwd) yields one (dir, sub, args, ctx) per git invocation, with
# ctx = ([(--git-dir|--work-tree, value)], {GIT_DIR…: path}, ([(-c|--config-env, v)], {VAR: x}),
# [global option words as written]); role_guard_refs.py reads the first three.
# Commands are tokenised with shlex (quotes respected, so a commit message saying
# "push" is not a push) and split on `&&`, `||`, `|`, `;`, newlines and `$(`.
# Leading `VAR=x`, `command`, `time`, `nohup`, `exec` and `env` (with its `-u NAME`,
# `--unset NAME`, `-P` values, `-C DIR` as a cd, `-S 'cmd'` split) are skipped.
# `bash|sh|zsh|dash [opts] -c '…'` is parsed recursively (depth 3), where any short
# cluster holding `c` (`-lc`, `-ec`) counts and `-o`/`-O`/`--rcfile` values are
# skipped. git's global options never hide the subcommand (value-taking ones in
# GIT_OPT_ARG). `cd DIR`, `git -C DIR`, `--git-dir`, `--work-tree` and a GIT_DIR /
# GIT_WORK_TREE prefix decide the call's dir; `-c`, `--config-env` and inline
# `VAR=x` prefixes (inherited by a nested `bash -c`) are passed on in ctx.
# Not covered: backticks, `eval`, scripts that run git.
# Imported lazily by the hook (implementor) and by role_guard_tester.py; a missing or
# broken copy refuses the call for that role (fail closed).
# Regression tests: tests/role-guard-hook.test.ts, tests/d180-role-guard-*.test.ts,
# tests/d184-role-guard-*.test.ts, tests/d186-*.test.ts.
import os, shlex

SEPARATORS = {"&&", "||", "|", ";", ";;", "&", "|&", "\n", "(", ")"}
WRAPPERS = {"command", "time", "nohup", "exec", "builtin"}
SHELLS = {"bash", "sh", "zsh", "dash"}

def tokens(cmd):
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    lex.commenters = ""
    return list(lex)

def segments(cmd):
    try:
        toks = tokens(cmd)
    except ValueError:
        return []  # unbalanced quotes: bash would refuse to run it too
    seg, out = [], []
    for t in toks:
        if t in SEPARATORS or (t and set(t) <= set(";&|()\n")):
            if seg:
                out.append(seg)
            seg = []
        elif t.endswith("$") and t != "$":
            seg.append(t[:-1])  # `foo$(` → word `foo`, then a new segment
            out.append(seg)
            seg = []
        elif t == "$":
            if seg:
                out.append(seg)
            seg = []
        else:
            seg.append(t)
    if seg:
        out.append(seg)
    return out

def is_assignment(t):
    name, eq, _ = t.partition("=")
    return bool(eq) and name.replace("_", "a").isalnum() and not name[0].isdigit()

ENV_VALUE_OPTS = {"-u", "--unset", "-P", "-C", "--chdir"}

def strip_prefix(seg, here):
    """Drop `VAR=x` / wrapper / `env [opts]` prefixes; return (rest, GIT_DIR-style env, dir, all VAR=x)."""
    i, genv, assigns = 0, {}, {}
    while i < len(seg):
        t = seg[i]
        if is_assignment(t) or t in WRAPPERS:
            name, _, val = t.partition("=")
            if is_assignment(t):
                assigns[name] = val
            if name in ("GIT_DIR", "GIT_WORK_TREE"):
                genv[name] = os.path.join(here, os.path.expanduser(val))
            i += 1
        elif t == "env":
            i += 1
            while i < len(seg) and (is_assignment(seg[i]) or seg[i].startswith("-")):
                o = seg[i]
                if o in ("-S", "--split-string") and i + 1 < len(seg):
                    seg = seg[:i] + tokens(seg[i + 1]) + seg[i + 2:]  # `env -S 'cmd args'`
                    continue
                if is_assignment(o):
                    assigns[o.split("=", 1)[0]] = o.split("=", 1)[1]
                if is_assignment(o) and o.split("=", 1)[0] in ("GIT_DIR", "GIT_WORK_TREE"):
                    genv[o.split("=", 1)[0]] = os.path.join(here, os.path.expanduser(o.split("=", 1)[1]))
                if o in ("-C", "--chdir") and i + 1 < len(seg):
                    here = os.path.join(here, os.path.expanduser(seg[i + 1]))
                i += 2 if o in ENV_VALUE_OPTS else 1
        else:
            break
    return seg[i:], genv, here, assigns

SHELL_VALUE_OPTS = {"-o", "+o", "-O", "+O", "--rcfile", "--init-file"}

def shell_script(args):
    """The script of `bash|sh|zsh|dash [opts] -c script`: any short cluster holding `c` counts."""
    has_c, i = False, 0
    while i < len(args):
        a = args[i]
        if a in SHELL_VALUE_OPTS:
            i += 2
        elif len(a) > 1 and a[0] in "-+" and a != "--":
            has_c = has_c or (a[0] == "-" and a[1] != "-" and "c" in a[1:])
            i += 1
        else:
            i += a == "--"
            return args[i] if has_c and i < len(args) else None
    return None

# git's global options that take the next word as their value (git 2.50.1 `git.c`); a
# missing one would read its value as the subcommand (`git --attr-source HEAD push`, D186).
GIT_OPT_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix",
               "--exec-path", "--attr-source"}

def parse_git(args, here):
    """Return (dir, sub, sub_args, [(--git-dir|--work-tree, v)], [(-c|--config-env, v)], [option words])
    for `git <opts> sub ...`; option words are the global options as written, values left out."""
    d, gopts, cfg, words, i = here, [], [], [], 0
    while i < len(args):
        a = args[i]
        opt, eq, val = a.partition("=")
        if a.startswith("-"):
            words.append(a)
        if a == "-C" and i + 1 < len(args):
            d = os.path.join(d, os.path.expanduser(args[i + 1]))
            i += 2
        elif opt in ("--git-dir", "--work-tree"):
            gopts.append((opt, val if eq else (args[i + 1] if i + 1 < len(args) else "")))
            i += 1 if eq else 2
        elif a == "-c" or opt == "--config-env":
            cfg.append((opt, val if eq else (args[i + 1] if i + 1 < len(args) else "")))
            i += 1 if eq else 2
        elif a in GIT_OPT_ARG:
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            return d, a, args[i + 1:], gopts, cfg, words
    return d, None, [], gopts, cfg, words

def git_calls(cmd, here, depth=0, outer=({}, {})):
    """Yield (dir, sub, args, (gopts, genv, (cfg, VAR=x), global option words)) per git call;
    `outer` is inherited by `bash -c`."""
    for seg in segments(cmd):
        seg, genv, there, assigns = strip_prefix(seg, here)  # `env -C DIR` moves this command only
        genv, assigns = {**outer[0], **genv}, {**outer[1], **assigns}
        if not seg:
            continue
        prog = os.path.basename(seg[0])
        if prog == "cd":
            target = seg[1] if len(seg) > 1 else os.path.expanduser("~")
            here = os.path.join(here, os.path.expanduser(target))
        elif prog in SHELLS and depth < 3:
            script = shell_script(seg[1:])
            if script is not None:
                yield from git_calls(script, there, depth + 1, (genv, assigns))
        elif prog == "git":
            d, sub, args, gopts, cfg, words = parse_git(seg[1:], there)
            yield d, sub, args, (gopts, genv, (cfg, assigns), words)
