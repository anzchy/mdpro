# Purpose: implementor git checks for the rule 70 role guard (.claude/hooks/role-guard.sh,
# D180). The hook parses a Bash command into git calls (shell `-c` in any option
# cluster, `env` options, `cd`, `-C`, `--git-dir`/`--work-tree`, `GIT_DIR=`) and
# hands each to `implementor_git`, which refuses: `git push`; commit / merge /
# rebase / cherry-pick / reset on a protected branch (`master`, `release/*`, and
# `frontend-backend-redesign` until 2026-11-11, ADR-0084); broad staging; and
# moving a protected branch *by name* without switching to it:
# - `branch -f/-d/-D/-m/-M/-c/-C` onto, away from or deleting <P> (`-l/--list` wins);
# - `update-ref [-d] refs/heads/<P>`, `update-ref HEAD` on <P>, any `update-ref --stdin`;
# - fetch/pull refspecs and `--refmap` values whose destination is <P>, `heads/<P>`
#   or `refs/heads/<P>`, or a glob that could expand to one (`*`, `release/0.*`);
# - `checkout -B`, `switch -C/--force-create`, `worktree add -B` <P>;
# - `rebase … <upstream> <P>`, `rebase --root <P>`, `rebase --update-refs`, and
#   `rebase.updateRefs` set for the command (`-c`, `--config-env`, GIT_CONFIG_*) on a
#   rebase or on a pull that may rebase, unless `--no-update-refs` / `--no-rebase`;
# - `symbolic-ref <P> <ref>` and `symbolic-ref -d <P>` (reads allowed).
# Long options are normalized first by role_guard_opts.py (D184): an unambiguous
# prefix is read as the full name, and an ambiguous one naming an inspected option
# is refused. Boolean options are read in order, the last of `--x` / `--no-x` / `-x`
# winning (`last_flag`, audit b91). Broad-staging checks live there too.
# The current branch is read where git will act (`-C`, `--git-dir`, `--work-tree`,
# GIT_DIR/GIT_WORK_TREE); a named git dir whose HEAD cannot be read counts as
# protected (fail closed). In one command chain, `checkout|switch <P>` and
# `worktree add <dir> <P>` make <P> current for that dir (protected names only).
# `heads/<P>` counts only in refspec destinations and symbolic-ref; branch,
# checkout -B and update-ref read it as another name.
# Not covered: `checkout -b`/`switch -c` creating <P>; refspecs, `rebase.updateRefs`
# and `pull.rebase` from git config files; aliases; `git replace`; `export GIT_DIR=…`
# earlier in a chain; raw .git/refs writes.
# Entry: implementor_git(dir, sub, args, ctx, chain, is_protected) → refusal text or
# None; ctx = ([(--git-dir|--work-tree, value)], {GIT_DIR…: path}, conf) with conf as
# in role_guard_opts.rebase_update_refs; chain is per command.
# The hook imports this lazily for every implementor Bash call and refuses the
# call if this module or role_guard_opts.py fails to import (fail closed).
# Regression tests: tests/role-guard-hook.test.ts, tests/d180-role-guard-*.test.ts,
# tests/d180-verifier-probes.test.ts, tests/d184-role-guard-*.test.ts.
import fnmatch, os, subprocess

from role_guard_opts import ambiguous_refusal, last_flag, normalize, pull_rebases, rebase_update_refs, staging

NAMED = ("master", "frontend-backend-redesign")
UNRESOLVED = "an unresolvable HEAD"
TAIL = "that is the delegator's job; move only your own fix/ branch (rule 70)."

def _glob_protected(n, is_protected):
    """True when glob `n` could expand to a protected branch name."""
    prefix = n[:min(n.find(c) for c in "*?[" if c in n)]
    if any(is_protected(s) and fnmatch.fnmatchcase(s, n) for s in NAMED):
        return True
    return is_protected("release/x") and ("release/".startswith(prefix) or prefix.startswith("release/"))

def protected_ref(name, is_protected, bare_is_branch=True, dwim=False):
    """True when `name` (a branch name, `refs/heads/...`, or a glob) names a protected branch.

    `dwim` applies git's refspec-destination expansion: `heads/x` is `refs/heads/x`,
    while `tags/…` and `remotes/…` are not branches."""
    n = name.lstrip("+")
    if dwim and n.startswith(("tags/", "remotes/")):
        return False
    if dwim and n.startswith("heads/"):
        n = n[len("heads/"):]
    elif n.startswith("refs/heads/"):
        n = n[len("refs/heads/"):]
    elif n.startswith("refs/") or not bare_is_branch:
        return False
    if not n:
        return False
    if any(ch in n for ch in "*?["):
        return _glob_protected(n, is_protected)
    return is_protected(n)

def _refusal(what, name):
    return f"`git {what}` moves the protected branch `{name}`; {TAIL}"

def _positionals(args, value_opts=()):
    """Non-option words; `value_opts` consume the next word; everything after `--` counts."""
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a in value_opts:
            i += 1
        elif a == "--":
            return pos + list(args[i:])
        elif not a.startswith("-") or a == "-":
            pos.append(a)
    return pos

# ---- git branch ----------------------------------------------------------

BRANCH_MODES = {"--force": "f", "--delete": "d", "--move": "m", "--copy": "c", "--list": "l"}
BRANCH_VALUE_LONG = {"--set-upstream-to", "--contains", "--no-contains", "--merged", "--no-merged",
                     "--points-at", "--sort", "--format"}

def _branch(args, current_branch, is_protected):
    """git reads these in order: `--no-X` clears what `--X`/`-x` set (bit 1), never `-D/-M/-C` (bit 2)."""
    modes, pos, i, rest = dict.fromkeys("fdmcl", 0), [], 0, False
    while i < len(args):
        a = args[i]
        i += 1
        if rest or not a.startswith("-") or a == "-":
            pos.append(a)
        elif a == "--":
            rest = True
        elif a.startswith("--"):
            if a in BRANCH_MODES:
                modes[BRANCH_MODES[a]] |= 1
            elif a.startswith("--no-") and "--" + a[5:] in BRANCH_MODES:
                modes[BRANCH_MODES["--" + a[5:]]] &= ~1
            elif a in BRANCH_VALUE_LONG:
                i += 1
        else:
            for k, ch in enumerate(a[1:]):
                if ch in "fdDmMcCl":
                    modes[ch.lower()] |= 2 if ch in "DMC" else 1
                elif ch == "u":
                    if k == len(a) - 2:
                        i += 1
                    break
    if modes["l"]:
        return None
    if modes["d"]:
        hit = next((p for p in pos if protected_ref(p, is_protected)), None)
        return _refusal("branch --delete", hit) if hit else None
    if modes["m"]:
        names = pos[:2] if len(pos) >= 2 else pos[:1] + [current_branch()]
        if None in names:
            return _refusal("branch --move", UNRESOLVED)
        hit = next((p for p in names if p and protected_ref(p, is_protected)), None)
        return _refusal("branch --move", hit) if hit else None
    if modes["c"]:
        dst = pos[1] if len(pos) >= 2 else (pos[0] if pos else "")
        return _refusal("branch --copy", dst) if dst and protected_ref(dst, is_protected) else None
    if modes["f"] and pos and protected_ref(pos[0], is_protected):
        return _refusal("branch --force", pos[0])
    return None

# ---- git update-ref / symbolic-ref ---------------------------------------

def _update_ref(args, current_branch, is_protected):
    if last_flag(args, ("--stdin",), ("--no-stdin",)):
        return f"`git update-ref --stdin` takes its refs from stdin, which the guard cannot read; {TAIL}"
    pos = _positionals(args, {"-m"})
    if not pos:
        return None
    if pos[0] == "HEAD":
        b = "" if last_flag(args, ("--no-deref",), ("--deref",)) else current_branch()
        return _refusal("update-ref HEAD", b or UNRESOLVED) if b is None or (b and is_protected(b)) else None
    return _refusal("update-ref", pos[0]) if protected_ref(pos[0], is_protected, bare_is_branch=False) else None

def _symbolic_ref(args, is_protected):
    pos = _positionals(args, {"-m"})
    deleting = last_flag(args, ("--delete",), ("--no-delete",), "d", "m")
    if pos and (deleting or len(pos) > 1) and protected_ref(pos[0], is_protected, dwim=True):
        return _refusal("symbolic-ref " + ("-d " if deleting else "") + pos[0], pos[0])
    return None

# ---- git fetch / pull / rebase -------------------------------------------

FETCH_VALUE_OPTS = {"--depth", "--deepen", "--shallow-since", "--shallow-exclude", "-j", "--jobs", "--refmap",
                    "-o", "--server-option", "--negotiation-tip", "--upload-pack",
                    "--recurse-submodules-default", "-s", "--strategy", "-X", "--strategy-option"}

def _fetch(sub, args, is_protected):
    refmaps = [a[len("--refmap="):] for a in args if a.startswith("--refmap=")]
    refmaps += [args[i + 1] for i, a in enumerate(args[:-1]) if a == "--refmap"]
    pos = [] if last_flag(args, ("--multiple",), ("--no-multiple",)) else _positionals(args, FETCH_VALUE_OPTS)[1:]
    for spec in refmaps + pos:
        if ":" in spec:
            dst = spec.rsplit(":", 1)[1]
            if protected_ref(dst, is_protected, dwim=True):
                return _refusal(f"{sub} … {spec}", dst)
    return None

REBASE_VALUE_OPTS = {"--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"}
UPDATE_REFS_CONFIG = ("`git {}` with rebase.updateRefs set moves every branch inside the rebased range, "
                      "protected ones too; pass {} or drop the setting; " + TAIL)

def _rebase(args, is_protected, conf):
    flags = [a for a in args if a in ("--update-refs", "--no-update-refs")]
    if flags and flags[-1] == "--update-refs":
        return f"`git rebase --update-refs` moves every branch inside the rebased range, protected ones too; {TAIL}"
    if not flags and rebase_update_refs(conf):
        return UPDATE_REFS_CONFIG.format("rebase", "--no-update-refs")
    pos = _positionals(args, REBASE_VALUE_OPTS)
    k = 0 if last_flag(args, ("--root",), ("--no-root",)) else 1  # --root takes no upstream
    branch = pos[k] if len(pos) > k else None
    if branch and protected_ref(branch, is_protected):
        return _refusal(f"rebase … {branch}", branch)
    return None

def _forced_create(args, letter, long_opt=None):
    """The value of `-<letter>` (separate, attached or ending a cluster) or `--long[=]`."""
    for i, a in enumerate(args):
        if a == "--":
            return None
        nxt = args[i + 1] if i + 1 < len(args) else None
        if long_opt and a == long_opt:
            return nxt
        if long_opt and a.startswith(long_opt + "="):
            return a.split("=", 1)[1]
        if a.startswith("-") and not a.startswith("--"):
            k = a.find(letter, 1)
            if k > 0 and not any(c in "bc" for c in a[1:k]):
                return a[k + 1:] or nxt
    return None

def ref_move(sub, args, current_branch, is_protected, conf=([], {})):
    """Refusal text when this git call (long options normalized) moves a protected branch by name."""
    if sub == "pull" and pull_rebases(args) and rebase_update_refs(conf):
        return UPDATE_REFS_CONFIG.format("pull", "--no-rebase")
    if sub == "branch":
        return _branch(args, current_branch, is_protected)
    if sub == "update-ref":
        return _update_ref(args, current_branch, is_protected)
    if sub in ("fetch", "pull"):
        return _fetch(sub, args, is_protected)
    if sub == "rebase":
        return _rebase(args, is_protected, conf)
    if sub == "symbolic-ref":
        return _symbolic_ref(args, is_protected)
    target, what = None, sub
    if sub == "checkout":
        target, what = _forced_create(args, "B"), "checkout -B"
    elif sub == "switch":
        target, what = _forced_create(args, "C", "--force-create"), "switch -C"
    elif sub == "worktree" and args[:1] == ["add"]:
        target, what = _forced_create(args[1:], "B"), "worktree add -B"
    if target and protected_ref(target, is_protected):
        return _refusal(what, target)
    return None

# ---- current branch and the command chain --------------------------------

def resolve_branch(d, ctx):
    """Branch checked out where git will act; "" when detached; None when a named git dir is unreadable."""
    gopts, genv = ctx[:2]
    named = bool(gopts or genv)
    cmd = ["git", "-C", d] + [f"{k}={v}" for k, v in gopts] + ["symbolic-ref", "--short", "-q", "HEAD"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=5, env={**os.environ, **genv})
    except Exception:
        return None if named else ""
    if r.returncode == 0:
        return r.stdout.strip()
    return "" if r.returncode == 1 or not named else None

def _switched_to(d, sub, args):
    """(dir, branch) that checkout / switch / worktree add leaves checked out, else None."""
    if sub in ("checkout", "switch"):
        detach = last_flag(args, ("--detach",), ("--no-detach",), "d" if sub == "switch" else "", "cC")
        if "--" in args or detach:
            return None
        pos = _positionals(args)
        return (d, pos[0]) if pos else None
    if sub == "worktree" and args[:1] == ["add"]:
        rest = args[1:]
        if last_flag(rest, ("--detach",), ("--no-detach",), "d", "bB"):
            return None
        pos = _positionals(rest, {"-b", "-B", "--reason"})
        if not pos:
            return None
        new = next((rest[i + 1] for i, a in enumerate(rest[:-1]) if a in ("-b", "-B")), None)
        return os.path.join(d, pos[0]), new or (pos[1] if len(pos) > 1 else os.path.basename(pos[0]))
    return None

def implementor_git(d, sub, args, ctx, chain, is_protected):
    """Refusal text for one git call of an implementor's Bash command, else None."""
    key = os.path.normpath(d)

    def current():
        return chain[key] if key in chain else resolve_branch(d, ctx)

    if sub == "push":
        return "implementors never run `git push`; the delegator lands commits (rule 70)."
    args, ambiguous = normalize(sub, args)
    if ambiguous:
        return ambiguous_refusal(sub, ambiguous)
    msg = ref_move(sub, args, current, is_protected, ctx[2] if len(ctx) > 2 else ([], {}))
    if msg:
        return msg
    if sub in ("commit", "merge", "rebase", "cherry-pick", "reset"):
        b = current()
        if b is None or is_protected(b):
            return f"`git {sub}` on `{b or UNRESOLVED}` is the delegator's job; work on your own branch in mdpro-wt/ (rule 70)."
    msg = staging(sub, args)
    moved = None if msg else _switched_to(d, sub, args)
    if moved and is_protected(moved[1]):
        chain[os.path.normpath(moved[0])] = moved[1]
    return msg
