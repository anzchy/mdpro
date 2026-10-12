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
#   `frontend-backend-redesign` stays protected until 2026-11-11 (ADR-0084); no broad staging
#   (`git add -A/--all/./-u`, `git commit -a/--all`) and no staging of
#   `.claude/tdd-guardian/state.json`.
# - real-device-tester: no git subcommand that changes state (read-only git
#   passes); Write / Edit / NotebookEdit only inside $MDPRO_REPORT_DIR (default
#   $HOME/.mdpro-redesign/dtrack) or the session scratch under /tmp/claude-*.
#
# Bash commands are tokenised with shlex (quotes respected, so a commit message
# saying "push" is not a push) and split on `&&`, `||`, `|`, `;`, newlines and
# `$(`. Leading `VAR=x`, `env`, `command`, `time`, `nohup`, `exec` are skipped,
# `bash|sh|zsh -c '…'` is checked recursively, `cd DIR` and `git -C DIR` move the
# directory the branch is resolved in (`git symbolic-ref --short -q HEAD`).
# Not covered: backticks, `eval`, scripts that run git, and Bash writing files.
#
# Input: Claude Code's hook JSON on stdin (`tool_name`, `tool_input.command` /
# `file_path` / `notebook_path`, `cwd`).
# Exit 2 + one stderr line = the call is denied and the line goes to the model.
# Exit 0 = allowed. Malformed JSON exits 0 (fail open, like block-target-scan.sh):
# a guard that crashes on input it cannot read would block every tool call in
# every session, which costs more than the one call it might have caught.
# Regression tests: tests/role-guard-hook.test.ts.
set -euo pipefail

role="${MDPRO_ROLE:-}"
case "$role" in
  implementor|real-device-tester) ;;
  *) exit 0 ;;
esac

input="$(cat)"
HOOK_INPUT="$input" python3 - <<'PY'
import json, os, shlex, subprocess, sys

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

def strip_prefix(seg):
    i = 0
    while i < len(seg):
        t = seg[i]
        if is_assignment(t) or t in WRAPPERS:
            i += 1
        elif t == "env":
            i += 1
            while i < len(seg) and (is_assignment(seg[i]) or seg[i].startswith("-")):
                i += 1
        else:
            break
    return seg[i:]

GIT_OPT_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix", "--exec-path"}

def parse_git(args, here):
    """Return (dir, subcommand, sub_args) for `git <global opts> sub ...`."""
    d = here
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-C" and i + 1 < len(args):
            d = os.path.join(d, os.path.expanduser(args[i + 1]))
            i += 2
        elif a in GIT_OPT_ARG:
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            return d, a, args[i + 1:]
    return d, None, []

def branch_of(d):
    try:
        r = subprocess.run(["git", "-C", d, "symbolic-ref", "--short", "-q", "HEAD"],
                           capture_output=True, text=True, timeout=5)
        return r.stdout.strip()
    except Exception:
        return ""

def git_calls(cmd, here, depth=0):
    """Yield (dir, sub, args) for every git invocation in a Bash command."""
    for seg in segments(cmd):
        seg = strip_prefix(seg)
        if not seg:
            continue
        prog = os.path.basename(seg[0])
        if prog == "cd":
            target = seg[1] if len(seg) > 1 else os.path.expanduser("~")
            here = os.path.join(here, os.path.expanduser(target))
        elif prog in SHELLS and depth < 3 and "-c" in seg[1:]:
            k = seg.index("-c", 1)
            if k + 1 < len(seg):
                yield from git_calls(seg[k + 1], here, depth + 1)
        elif prog == "git":
            yield parse_git(seg[1:], here)

# ---- implementor ---------------------------------------------------------

def short_cluster_has(arg, letter, value_letters=""):
    """True when a `-xyz` cluster sets `letter` before any value-taking letter."""
    if not arg.startswith("-") or arg.startswith("--") or len(arg) < 2:
        return False
    for ch in arg[1:]:
        if ch == letter:
            return True
        if ch in value_letters:
            return False
    return False

def names_state_json(arg):
    p = os.path.normpath(arg)
    return p.endswith(os.path.join(".claude", "tdd-guardian", "state.json")) or \
        p.endswith(os.path.join(".claude", "tdd-guardian"))

def implementor_bash(cmd):
    for d, sub, args in git_calls(cmd, cwd):
        if sub == "push":
            deny("implementors never run `git push`; the delegator lands commits (rule 70).")
        if sub in ("commit", "merge", "rebase", "cherry-pick", "reset"):
            b = branch_of(d)
            if is_protected(b):
                deny(f"`git {sub}` on `{b}` is the delegator's job; work on your own branch in mdpro-wt/ (rule 70).")
        if sub == "add":
            for a in args:
                if a in ("-A", "--all", ".", "./", "-u", "--update") or \
                        short_cluster_has(a, "A") or short_cluster_has(a, "u"):
                    deny(f"`git add {a}` stages files you did not name; stage named paths only (rule 70).")
                if not a.startswith("-") and names_state_json(a):
                    deny("never stage .claude/tdd-guardian/state.json; it is per-worktree gate state.")
        if sub == "commit":
            for a in args:
                if a == "--":
                    break
                if a == "--all" or short_cluster_has(a, "a", "mFCctS"):
                    deny("`git commit -a/--all` stages files you did not name; `git add` named paths first (rule 70).")

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
    for _d, sub, args in git_calls(cmd, cwd):
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
