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
#   set by `-c` / `--config-env` / GIT_CONFIG_*); if either, or role_guard_shell.py,
#   is missing or fails to import, every implementor Bash call is refused (fail
#   closed). Other tools and roles do not import them. A missing python3 still
#   fails open (the hook exits non-2, a non-blocking error).
# - real-device-tester: git only from a read-only allowlist (D186: fixed read-only
#   subcommands plus the read-only forms of branch / tag / stash / worktree / remote /
#   config / symbolic-ref / reflog / notes; anything else, unknown subcommands
#   included, is refused); Write / Edit / NotebookEdit only inside $MDPRO_REPORT_DIR
#   (default $HOME/.mdpro-redesign/dtrack) or the session scratch under /tmp/claude-*.
#   These checks live in role_guard_tester.py with its option tables in
#   role_guard_tester_opts.py; if either, role_guard_opts.py or role_guard_shell.py is
#   missing or fails to import, every such tester call is refused (fail closed).
#
# Bash commands are parsed into git calls by role_guard_shell.py (quotes, `&&` /
# `|` / `;` / `$(` splitting, `VAR=x` / `env` / wrapper prefixes, nested
# `bash|sh|zsh|dash -c`, `cd`, `git -C`, `--git-dir`, `--work-tree`, GIT_DIR, `-c`,
# `--config-env`); the implementor path imports it too, under the same fail-closed
# rule. Not covered: backticks, `eval`, scripts that run git, and Bash writing files.
#
# Input: Claude Code's hook JSON on stdin (`tool_name`, `tool_input.command` /
# `file_path` / `notebook_path`, `cwd`).
# Exit 2 + one stderr line = the call is denied and the line goes to the model. Any
# exception while checking a role's call (parsing included) is denied the same way,
# naming the exception class (audit b93 H4), so a crash never exits 1 and lets it through.
# Exit 0 = allowed. Malformed JSON exits 0 (fail open, like block-target-scan.sh):
# a guard that crashes on input it cannot read would block every tool call in
# every session, which costs more than the one call it might have caught.
# Regression tests: tests/role-guard-hook.test.ts, tests/d180-role-guard-*.test.ts,
# tests/d180-verifier-probes.test.ts, tests/d184-role-guard-*.test.ts,
# tests/d186-*.test.ts.
set -euo pipefail

role="${MDPRO_ROLE:-}"
case "$role" in
  implementor|real-device-tester) ;;
  *) exit 0 ;;
esac

input="$(cat)"
HOOK_INPUT="$input" ROLE_GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" python3 - <<'PY'
import json, os, sys

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

# ---- implementor ---------------------------------------------------------

def load_checks(cmd):
    """D180 checks, imported lazily; a missing or broken module refuses the call (fail closed)."""
    try:
        from role_guard_shell import git_calls
        from role_guard_refs import implementor_git
        return git_calls, implementor_git
    except BaseException:  # incl. SystemExit from a module that exits on import
        deny(f"role-guard: refs module missing or broken, refusing {cmd}; fix .claude/hooks/role_guard_refs.py, "
             "role_guard_opts.py or role_guard_shell.py")

def implementor_bash(cmd):
    (git_calls, check), chain = load_checks(cmd), {}
    for d, sub, args, ctx in git_calls(cmd, cwd):
        msg = check(d, sub, args, ctx, chain, is_protected)
        if msg:
            deny(msg)

# ---- real-device-tester --------------------------------------------------

def load_tester(what):
    """D186 tester checks, imported lazily; a missing or broken module refuses the call (fail closed)."""
    try:
        import role_guard_tester
        return role_guard_tester
    except BaseException:  # incl. SystemExit from a module that exits on import
        deny(f"role-guard: tester module missing or broken, refusing {what}; fix .claude/hooks/role_guard_tester.py, "
             "role_guard_tester_opts.py, role_guard_opts.py or role_guard_shell.py")

# ---- dispatch ------------------------------------------------------------

def check_call():
    if role == "implementor":
        if tool == "AskUserQuestion":
            deny("implementors do not ask the user; send the question to mdpro-delegator by SendMessage (rule 70).")
        if tool == "Bash" and cmd:
            implementor_bash(cmd)
    elif role == "real-device-tester":
        msg = None
        if tool == "Bash" and cmd:
            msg = load_tester(cmd).tester_bash(cmd, cwd)
        elif tool in ("Write", "Edit", "NotebookEdit"):
            p = tin.get("notebook_path") if tool == "NotebookEdit" else tin.get("file_path")
            msg = load_tester(f"{tool} {p or '(no path)'}").tester_write(p, cwd)
        if msg:
            deny(msg)

cmd = tin.get("command") or ""
try:
    check_call()
except Exception as e:  # audit b93 H4: a crash exits 1, which Claude Code lets through; deny() is SystemExit
    what = " ".join(str(cmd or tool).split())[:120]
    deny(f"role-guard: internal error ({type(e).__name__}) while checking {what}; refusing")
sys.exit(0)
PY
