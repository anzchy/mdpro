# Purpose: ref-move checks for the rule 70 role guard (.claude/hooks/role-guard.sh,
# D180). The hook's current-branch checks only see the branch that is checked
# out; this module finds git invocations that move a protected branch *by name*
# without switching to it, so an implementor cannot move `master`, `release/*`
# (or `frontend-backend-redesign` until 2026-11-11, ADR-0084) from a feature
# branch or a detached HEAD.
#
# Covered (implementor only; the hook decides the role):
# - `branch -f/--force <P>`, `-d/-D/--delete ... <P> ...`, `-m/-M/--move` onto or
#   away from <P> (one-name form: the checked-out branch), `-c/-C/--copy` onto <P>;
# - `update-ref [-d] refs/heads/<P>`, `update-ref HEAD` (without `--no-deref`)
#   while <P> is checked out, and `update-ref --stdin` in any form (unparseable);
# - `fetch` / `pull` refspecs whose destination is <P>, `heads/<P>` (git expands
#   it to `refs/heads/<P>`) or `refs/heads/<P>`, with or without `+`, including
#   globs such as `refs/heads/*:refs/heads/*`;
# - `checkout -B <P>`, `switch -C/--force-create[=]<P>`, `worktree add -B <P>`;
# - `rebase [opts] <upstream> <P>` and `rebase --root <P>`, which check out and
#   rewrite <P> whatever was checked out before (value options skipped: `--onto`,
#   `-s/--strategy`, `-X/--strategy-option`, `-x/--exec`);
# - `symbolic-ref <P> <ref>` (makes <P> an alias) and `symbolic-ref -d <P>`, with
#   <P> bare, `heads/<P>` or `refs/heads/<P>`; reading one is allowed.
# `heads/<P>` counts only where git expands it (refspec destinations) and for
# symbolic-ref by ruling; `branch`, `checkout -B` and `update-ref` take it as a
# different name (`refs/heads/heads/<P>`, `$GIT_DIR/heads/<P>`).
# Not covered: `checkout -b` / `switch -c` creating <P> (moves no existing ref),
# git aliases from config, `git replace`, and raw writes under .git/refs.
#
# Entry point: ref_move(sub, args, current_branch, is_protected) returns the
# refusal text (without the `Blocked by role-guard (<role>): ` prefix the hook
# adds) or None. `current_branch` is a zero-argument callable, so the branch is
# only resolved for the forms that depend on it.
# The hook imports this lazily for implementor Bash calls; if the import fails
# for any reason it refuses the call (fail closed).
# Regression tests: tests/d180-role-guard-ref-moves.test.ts, tests/d180-role-guard-ref-moves-2.test.ts,
# tests/d180-role-guard-fail-closed.test.ts.
import fnmatch

GLOB_SAMPLES = ("master", "frontend-backend-redesign", "release/x")
TAIL = "that is the delegator's job; move only your own fix/ branch (rule 70)."


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
        return any(is_protected(s) and fnmatch.fnmatchcase(s, n) for s in GLOB_SAMPLES)
    return is_protected(n)


def _refusal(what, name):
    return f"`git {what}` moves the protected branch `{name}`; {TAIL}"


# ---- git branch ----------------------------------------------------------

BRANCH_MODES = {"--force": "f", "--delete": "d", "--move": "m", "--copy": "c"}
BRANCH_VALUE_LONG = {"--set-upstream-to", "--contains", "--no-contains", "--merged", "--no-merged",
                     "--points-at", "--sort", "--format"}


def _branch(args, current_branch, is_protected):
    modes, pos, i, rest = set(), [], 0, False
    while i < len(args):
        a = args[i]
        i += 1
        if rest or not a.startswith("-") or a == "-":
            pos.append(a)
        elif a == "--":
            rest = True
        elif a.startswith("--"):
            if a in BRANCH_MODES:
                modes.add(BRANCH_MODES[a])
            elif a in BRANCH_VALUE_LONG:
                i += 1
        else:
            for k, ch in enumerate(a[1:]):
                if ch in "fdDmMcC":
                    modes.add(ch.lower())
                    if ch in "DMC":
                        modes.add("f")
                elif ch == "u":
                    if k == len(a) - 2:
                        i += 1
                    break
    if "d" in modes:
        hit = next((p for p in pos if protected_ref(p, is_protected)), None)
        return _refusal("branch --delete", hit) if hit else None
    if "m" in modes:
        names = pos[:2] if len(pos) >= 2 else pos[:1] + [current_branch()]
        hit = next((p for p in names if p and protected_ref(p, is_protected)), None)
        return _refusal("branch --move", hit) if hit else None
    if "c" in modes:
        dst = pos[1] if len(pos) >= 2 else (pos[0] if pos else "")
        return _refusal("branch --copy", dst) if dst and protected_ref(dst, is_protected) else None
    if "f" in modes and pos and protected_ref(pos[0], is_protected):
        return _refusal("branch --force", pos[0])
    return None


# ---- git update-ref ------------------------------------------------------

def _update_ref(args, current_branch, is_protected):
    if "--stdin" in args:
        return f"`git update-ref --stdin` takes its refs from stdin, which the guard cannot read; {TAIL}"
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a == "-m":
            i += 1
        elif not a.startswith("-"):
            pos.append(a)
    if not pos:
        return None
    ref = pos[0]
    if ref == "HEAD":
        b = "" if "--no-deref" in args else current_branch()
        return _refusal("update-ref HEAD", b) if b and is_protected(b) else None
    return _refusal("update-ref", ref) if protected_ref(ref, is_protected, bare_is_branch=False) else None


# ---- git fetch / pull ----------------------------------------------------

FETCH_VALUE_OPTS = {"--depth", "--deepen", "--shallow-since", "--shallow-exclude", "-j", "--jobs", "--refmap",
                    "-o", "--server-option", "--negotiation-tip", "--upload-pack",
                    "--recurse-submodules-default", "-s", "--strategy", "-X", "--strategy-option"}


def _fetch(sub, args, is_protected):
    if "--multiple" in args:
        return None
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a in FETCH_VALUE_OPTS:
            i += 1
        elif a == "--":
            pos.extend(args[i:])
            break
        elif not a.startswith("-"):
            pos.append(a)
    for spec in pos[1:]:
        if ":" in spec:
            dst = spec.rsplit(":", 1)[1]
            if protected_ref(dst, is_protected, dwim=True):
                return _refusal(f"{sub} … {spec}", dst)
    return None


# ---- git rebase <upstream> <branch> --------------------------------------

REBASE_VALUE_OPTS = {"--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"}


def _rebase(args, is_protected):
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a in REBASE_VALUE_OPTS:
            i += 1
        elif a == "--":
            pos.extend(args[i:])
            break
        elif not a.startswith("-"):
            pos.append(a)
    k = 0 if "--root" in args else 1  # --root takes no upstream
    branch = pos[k] if len(pos) > k else None
    if branch and protected_ref(branch, is_protected):
        return _refusal(f"rebase … {branch}", branch)
    return None


# ---- git symbolic-ref ----------------------------------------------------

def _symbolic_ref(args, is_protected):
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a == "-m":
            i += 1
        elif not a.startswith("-"):
            pos.append(a)
    deleting = any(a in ("-d", "--delete") for a in args)
    if pos and (deleting or len(pos) > 1) and protected_ref(pos[0], is_protected, dwim=True):
        return _refusal("symbolic-ref " + ("-d " if deleting else "") + pos[0], pos[0])
    return None


# ---- checkout -B / switch -C / worktree add -B ---------------------------

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


def ref_move(sub, args, current_branch, is_protected):
    if sub == "branch":
        return _branch(args, current_branch, is_protected)
    if sub == "update-ref":
        return _update_ref(args, current_branch, is_protected)
    if sub in ("fetch", "pull"):
        return _fetch(sub, args, is_protected)
    if sub == "rebase":
        return _rebase(args, is_protected)
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
