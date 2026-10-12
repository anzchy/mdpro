# Purpose: real-device-tester checks for the rule 70 role guard (role-guard.sh), moved
# out of the hook in D186.
# - tester_bash(cmd, cwd): refusal text unless every git call in the command is on the
#   read-only ALLOWLIST (delegator ruling, 2026-10-12; fail closed), else None. Calls
#   come from role_guard_shell.git_calls, so `git -C`, global options, `bash -lc '…'`
#   and `env … git …` are seen too. Allowed: the subcommands in PLAIN and the read-only
#   forms in CHECKS (branch / tag listing, `stash list|show`, `worktree list`,
#   `remote [-v] [show|get-url]`, config reads, `symbolic-ref <name>` without -d,
#   reflog without expire / delete / drop, `notes [--ref x] [list|show]`). Anything else,
#   an unknown subcommand or alias included, is refused naming it. Arguments are parsed
#   as git's parse-options does (role_guard_tester_opts.parse: prefixes spelled out,
#   option values never read as options, the last `--x` / `--no-x` wins).
#   Audit b93 (round 2): every allowed call is also refused when a word names an option
#   that writes a file or runs a program (H3: `--output`, `--ext-diff`, `--textconv`,
#   `grep -O`, `help -w/-i`, …), when it passes `-c` / `--config-env` / `--exec-path=` or
#   another unknown global option, or when the command assigns a variable that points git
#   at programs, config or another store (H2: GIT_CONFIG_*, GIT_EXTERNAL_DIFF, GIT_PAGER
#   other than cat/less/more, GIT_SSH_COMMAND, GIT_INDEX_FILE, …), inline, through
#   `env`, `export`, or carried into `bash -c`.
# - tester_write(path, cwd): refusal text unless the resolved path (symlinks followed)
#   is inside $MDPRO_REPORT_DIR (default $HOME/.mdpro-redesign/dtrack) or the session
#   scratch under /tmp/claude-* or /private/tmp/claude-*, else None.
# The hook imports this lazily, only for a real-device-tester Bash / Write / Edit /
# NotebookEdit call, and refuses that call if this module, role_guard_tester_opts.py,
# role_guard_opts.py or role_guard_shell.py fails to import (fail closed). No role and
# the implementor never import it.
# Not covered: programs and stores set in existing git config files (core.pager,
# diff.external, textconv drivers, core.fsmonitor run by default); `status` / `diff`
# refreshing the index (GIT_OPTIONAL_LOCKS=0 avoids it); `remote show` contacting the
# remote; variables set by `read`, `printf -v` or a sourced file; aliases (refused).
# Regression tests: tests/role-guard-hook.test.ts, tests/d180-role-guard-ref-moves-3.test.ts,
# tests/d186-*.test.ts.
import os

from role_guard_shell import SHELLS, git_calls, is_assignment, segments, shell_script
from role_guard_tester_opts import (denied_word, env_denied, flag, global_denied, has, parse, words,
                                    write_item)
from role_guard_opts import ambiguous_refusal

PLAIN = frozenset("""
status log show diff diff-tree diff-files diff-index rev-parse rev-list ls-files ls-tree cat-file blame
describe name-rev show-ref for-each-ref merge-base grep shortlog whatchanged version help var
check-ignore check-attr count-objects verify-commit verify-tag""".split())
FILTERS = frozenset("contains no-contains merged no-merged points-at with without".split())
CONFIG_READS = frozenset("get get-all get-regexp get-urlmatch get-color get-colorbool list".split())
CONFIG_SUBCOMMANDS = frozenset("set unset rename-section remove-section edit".split())

def _branch(items):
    listing = flag(items, ("list",), ("no-list",), "l") or has(items, FILTERS | {"show-current"})
    pos = words(items)
    return pos[0] if pos and not listing else None

def _tag(items):
    listing = flag(items, ("list", "verify"), (), "l") or has(items, FILTERS, "vn")
    pos = words(items)
    return pos[0] if pos and not listing else None

def _config(items):
    pos = words(items)
    if pos[:1] in (["get"], ["list"]) and items[0][0] == "pos":
        return None
    if pos and pos[0] in CONFIG_SUBCOMMANDS and items[0][0] == "pos":
        return pos[0]
    if has(items, CONFIG_READS, "l"):
        return None
    return None if len(pos) == 1 else (pos[1] if pos else "(no name)")

def _symbolic_ref(items):
    if flag(items, ("delete",), ("no-delete",), "d"):
        return "--delete"
    pos = words(items)
    return pos[1] if len(pos) > 1 else None

def _subword(allowed, empty_ok, flags=()):
    """The first word must be in `allowed`; only options named in `flags` may precede it."""
    def check(items):
        for kind, name, _, word in items:
            if kind == "pos":
                return None if name in allowed else name
            if (f"--{name}" if kind == "long" else f"-{name}") not in flags:
                return word
        return None if empty_ok else "(no subcommand)"
    return check

def _reflog(items):
    return next((n for n in words(items) if n in ("expire", "delete", "drop")), None)

CHECKS = {
    "branch": _branch, "tag": _tag, "config": _config, "symbolic-ref": _symbolic_ref, "reflog": _reflog,
    "stash": _subword(("list", "show"), False),
    "worktree": _subword(("list",), False),
    "remote": _subword(("show", "get-url"), True, flags=("-v", "--verbose", "--no-verbose")),
    "notes": _subword(("list", "show"), True, flags=("--ref", "--no-ref")),
}

def _refusal(sub, detail, how="is not on the allowlist"):
    shown = f"git {sub} {detail}" if detail else f"git {sub}"
    return f"real-device-tester runs read-only git only; `{shown}` {how} (rule 70)."

def tester_git(sub, args):
    """Refusal text for one git call's subcommand and arguments, else None."""
    if sub is None:
        return None
    if sub not in PLAIN and sub not in CHECKS:
        return _refusal(sub, "")
    args = list(args)
    if sub in CHECKS:
        items, amb = parse(sub, args)
        if amb:
            return ambiguous_refusal(sub, amb)
        detail = write_item(sub, items) or CHECKS[sub](items)
        if detail:
            return _refusal(sub, detail)
    bad = denied_word(sub, args)
    return _refusal(sub, bad, "writes a file or runs a program") if bad else None

def _context(sub, ctx):
    """Refusal for `-c`, `--config-env`, other global options or environment the tester may not use."""
    cfg, assigns = ctx[2]
    shown = sub or ""
    if cfg:
        return _refusal(shown, "", f"with `{cfg[0][0]} {cfg[0][1]}` is not on the allowlist")
    for w in (ctx[3] if len(ctx) > 3 else []):
        if global_denied(w):
            return _refusal(shown, "", f"with `{w}` is not on the allowlist")
    for name, value in assigns.items():
        if env_denied(name, value):
            return _refusal(shown, "", f"with `{name}=…` is not on the allowlist")
    return None

def _assigned(cmd, depth=0):
    """Every NAME=value word in the command (`export`, prefixes, nested `bash -c` included)."""
    for seg in segments(cmd):
        for j, t in enumerate(seg):
            if is_assignment(t):
                yield t.split("=", 1)
            elif os.path.basename(t) in SHELLS and depth < 3:
                script = shell_script(seg[j + 1:])
                if script is not None:
                    yield from _assigned(script, depth + 1)

def tester_bash(cmd, cwd):
    calls = list(git_calls(cmd, cwd))
    for _d, sub, args, ctx in calls:
        msg = tester_git(sub, args) or _context(sub, ctx)
        if msg:
            return msg
    if calls:
        for name, value in _assigned(cmd):
            if env_denied(name, value):
                return _refusal(calls[0][1] or "", "", f"after `{name}=…` is not on the allowlist")
    return None

def _resolve(p, cwd):
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(p)))

def _inside(path, root):
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)

def _in_scratch(path):
    parts = path.split(os.sep)
    for prefix in (["", "private", "tmp"], ["", "tmp"]):
        n = len(prefix)
        if parts[:n] == prefix and len(parts) > n + 1 and parts[n].startswith("claude-"):
            return True
    return False

def tester_write(p, cwd):
    report = os.environ.get("MDPRO_REPORT_DIR") or os.path.join(os.path.expanduser("~"), ".mdpro-redesign", "dtrack")
    report_real = os.path.realpath(report)
    if p and (_inside(_resolve(p, cwd), report_real) or _in_scratch(_resolve(p, cwd))):
        return None
    return f"real-device-tester writes only under {report} or the session scratch /tmp/claude-*; got {p or '(no path)'}."
