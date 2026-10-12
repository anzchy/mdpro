#!/usr/bin/env bash
# Purpose: PreToolUse guard that enforces rule 70's per-role limits
# (.claude/rules/70-multi-session-coordination.md). The role comes from
# MDPRO_ROLE, set when the session starts (`MDPRO_ROLE=implementor claude`).
#
# - unset / empty / delegator / auditor / device-harness: no limits. Any other
#   value is unknown and also passes silently, so a typo never locks a session.
# - implementor: no AskUserQuestion (questions go to mdpro-delegator by
#   SendMessage); no `git push`; no commit / merge / rebase / cherry-pick / reset
#   while the branch is `master` (the single integration trunk, ADR-0083) or a
#   `release/*` hotfix branch, both landed only by the delegator; the old trunk
#   `frontend-backend-redesign` stays protected until 2026-11-11 (ADR-0084); no
#   moving a protected branch by name from anywhere (branch / update-ref /
#   symbolic-ref / fetch, pull and --refmap destinations / checkout -B / switch -C /
#   worktree add -B / rebase <upstream> <P> / rebase --update-refs); no broad staging
#   (`git add -A/--all/./-u`, `git commit -a/--all`) and no staging of
#   `.claude/tdd-guardian/state.json`. These checks live in role_guard_refs.py
#   (D180) and role_guard_opts.py (D184: abbreviated long options, `rebase.updateRefs`
#   set by `-c` / `--config-env` / GIT_CONFIG_*); if either is missing or fails to
#   import, every implementor Bash call is refused (fail closed). Other tools and
#   roles do not import them. A missing
#   python3 still fails open (the hook exits non-2, a non-blocking error).
# - real-device-tester: no git subcommand that changes state (read-only git
#   passes); Write / Edit / NotebookEdit only inside $MDPRO_REPORT_DIR (default
#   $HOME/.mdpro-redesign/dtrack) or the session scratch under /tmp/claude-*.
#
# Bash commands are tokenised with shlex (quotes respected, so a commit message
# saying "push" is not a push) and split on `&&`, `||`, `|`, `;`, newlines and
# `$(`. Leading `VAR=x`, `command`, `time`, `nohup`, `exec` and `env` (with its
# `-u NAME`, `--unset NAME`, `-P` values, `-C DIR` as a cd, `-S 'cmd'` split)
# are skipped. `bash|sh|zsh|dash [opts] -c '…'` is checked recursively, where any
# short-option cluster holding `c` (`-lc`, `-ec`) counts and `-o`/`-O`/`--rcfile`
# values are skipped. `cd DIR`, `git -C DIR`, `--git-dir`, `--work-tree` and a
# GIT_DIR / GIT_WORK_TREE prefix decide where the current branch is read; `-c`,
# `--config-env` and inline `VAR=x` prefixes (inherited by a nested `bash -c`) are
# passed on for the config checks.
# Not covered: backticks, `eval`, scripts that run git, and Bash writing files.
#
# Input: Claude Code's hook JSON on stdin (`tool_name`, `tool_input.command` /
# `file_path` / `notebook_path`, `cwd`).
# Exit 2 + one stderr line = the call is denied and the line goes to the model.
# Exit 0 = allowed. Malformed JSON exits 0 (fail open, like block-target-scan.sh):
# a guard that crashes on input it cannot read would block every tool call in
# every session, which costs more than the one call it might have caught.
# Regression tests: tests/role-guard-hook.test.ts, tests/d180-role-guard-*.test.ts,
# tests/d180-verifier-probes.test.ts, tests/d184-role-guard-*.test.ts.
set -euo pipefail

role="${MDPRO_ROLE:-}"
case "$role" in
  implementor|real-device-tester) ;;
  *) exit 0 ;;
esac

input="$(cat)"
HOOK_INPUT="$input" ROLE_GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" python3 - <<'PY'
import json, os, shlex, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.environ["ROLE_GUARD_DIR"])

try:
    data = json.loads(os.environ["HOOK_INPUT"])
    if not isinstance(data, dict):
        raise ValueError
except Exception:
    sys.exit(0)

role = os.environ.get("MDPRO_ROLE", "")
tool = data.get("tool_name") or ""
tin = data.get("tool_input") or {}
if not isinstance(tin, dict):
    tin = {}
cwd = data.get("cwd") or os.getcwd()
PROTECTED = {"master", "frontend-backend-redesign"}  # drop the old trunk name on 2026-11-11 (ADR-0084)
PROTECTED_PREFIXES = ("release/",)

def is_protected(b):
    return b in PROTECTED or b.startswith(PROTECTED_PREFIXES)

def deny(msg):
    sys.stderr.write(f"Blocked by role-guard ({role}): {msg}\n")
    sys.exit(2)

# ---- Bash parsing --------------------------------------------------------

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

GIT_OPT_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix", "--exec-path"}

def parse_git(args, here):
    """Return (dir, sub, sub_args, [(--git-dir|--work-tree, v)], [(-c|--config-env, v)]) for `git <opts> sub ...`."""
    d, gopts, cfg, i = here, [], [], 0
    while i < len(args):
        a = args[i]
        opt, eq, val = a.partition("=")
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
            return d, a, args[i + 1:], gopts, cfg
    return d, None, [], gopts, cfg

def git_calls(cmd, here, depth=0, outer=({}, {})):
    """Yield (dir, sub, args, (gopts, genv, (cfg, VAR=x))) per git call; `outer` is inherited by `bash -c`."""
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
            d, sub, args, gopts, cfg = parse_git(seg[1:], there)
            yield d, sub, args, (gopts, genv, (cfg, assigns))

# ---- implementor ---------------------------------------------------------

def load_checks(cmd):
    """D180 checks, imported lazily; a missing or broken module refuses the call (fail closed)."""
    try:
        from role_guard_refs import implementor_git
        return implementor_git
    except BaseException:  # incl. SystemExit from a module that exits on import
        deny(f"role-guard: refs module missing or broken, refusing {cmd}; fix .claude/hooks/role_guard_refs.py or role_guard_opts.py")

def implementor_bash(cmd):
    check, chain = load_checks(cmd), {}
    for d, sub, args, ctx in git_calls(cmd, cwd):
        msg = check(d, sub, args, ctx, chain, is_protected)
        if msg:
            deny(msg)

# ---- real-device-tester --------------------------------------------------

ALWAYS_MUTATING = {"add", "commit", "push", "merge", "rebase", "reset", "cherry-pick", "checkout",
                   "switch", "restore", "clean", "pull", "revert", "rm", "mv", "am", "apply", "update-ref"}
READ_ONLY_SUBSUB = {"stash": {"list", "show"}, "worktree": {"list"}}
BRANCH_MUTATING = {"-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force",
                   "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"}

def tester_git_mutates(sub, args):
    if sub in ALWAYS_MUTATING:
        return True
    if sub in READ_ONLY_SUBSUB:
        return not args or args[0] not in READ_ONLY_SUBSUB[sub]
    if sub == "branch":
        if any(a in BRANCH_MUTATING or a.startswith("--set-upstream-to=") for a in args):
            return True
        listing = any(a in ("-l", "--list") for a in args)
        return not listing and any(not a.startswith("-") for a in args)
    if sub == "tag":
        return bool(args) and not any(a in ("-l", "--list") for a in args)
    return False

def tester_bash(cmd):
    for _d, sub, args, _ctx in git_calls(cmd, cwd):
        if sub and tester_git_mutates(sub, args):
            deny(f"real-device-tester never changes git state (`git {sub}`); read-only git only (rule 70).")

def resolve(p):
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(p)))

def inside(path, root):
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)

def in_scratch(path):
    parts = path.split(os.sep)
    for prefix in (["", "private", "tmp"], ["", "tmp"]):
        n = len(prefix)
        if parts[:n] == prefix and len(parts) > n + 1 and parts[n].startswith("claude-"):
            return True
    return False

def tester_write(p):
    report = os.environ.get("MDPRO_REPORT_DIR") or os.path.join(os.path.expanduser("~"), ".mdpro-redesign", "dtrack")
    report_real = os.path.realpath(report)
    if p and (inside(resolve(p), report_real) or in_scratch(resolve(p))):
        return
    deny(f"real-device-tester writes only under {report} or the session scratch /tmp/claude-*; got {p or '(no path)'}.")

# ---- dispatch ------------------------------------------------------------

cmd = tin.get("command") or ""
if role == "implementor":
    if tool == "AskUserQuestion":
        deny("implementors do not ask the user; send the question to mdpro-delegator by SendMessage (rule 70).")
    if tool == "Bash" and cmd:
        implementor_bash(cmd)
elif role == "real-device-tester":
    if tool == "Bash" and cmd:
        tester_bash(cmd)
    elif tool in ("Write", "Edit", "NotebookEdit"):
        tester_write(tin.get("notebook_path") if tool == "NotebookEdit" else tin.get("file_path"))
sys.exit(0)
PY
