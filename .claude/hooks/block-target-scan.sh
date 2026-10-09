#!/usr/bin/env bash
# Purpose: PreToolUse(Bash) guard — refuse recursive grep/find that would walk
# src-tauri/target (100+ GiB of Rust build output; one unscoped `grep -r .` ran
# for 5+ minutes at ~90% CPU on 2026-10-07).
#
# Blocks `grep -r/-R/--recursive` and `find` when a search root resolves (against
# the call's cwd) to the repo root or `src-tauri`, unless that same command
# really skips target: grep `--exclude-dir` whose glob matches `target`, or find
# `-prune` with a `-name`/`-path` test that matches it. Merely mentioning the
# word (`grep -rn "e.target" .`) or filtering output (`find . -not -path
# '*/target/*'`, which still walks it) does not count (D75).
# grep options that take an argument (`-e PAT`, `-f FILE`, `-A 3`, …) are
# consumed, so their values are never paths; no path left means `.`.
# Input: Claude Code's hook JSON on stdin (`tool_input.command`, `cwd`).
# Exit 2 + stderr = the call is denied and the message goes back to the model.
# Everything else (rg, the Grep tool, grep on named dirs) passes untouched.
# Regression tests: tests/block-target-scan-hook.test.ts.
set -euo pipefail

input="$(cat)"
HOOK_INPUT="$input" python3 - <<'PY'
import fnmatch, json, os, re, shlex, sys

try:
    data = json.loads(os.environ["HOOK_INPUT"])
except Exception:
    sys.exit(0)
cmd = data.get("tool_input", {}).get("command", "")
cwd = data.get("cwd") or os.getcwd()
project = os.environ.get("CLAUDE_PROJECT_DIR") or ""
if not cmd or not project:
    sys.exit(0)

# Directories whose recursive walk reaches src-tauri/target.
guarded = {os.path.realpath(project), os.path.realpath(os.path.join(project, "src-tauri"))}

def hits(path):
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(path))) in guarded

def deny(what):
    sys.stderr.write(
        f"Blocked: {what} would scan src-tauri/target (100+ GiB of build output).\n"
        "Search named source dirs instead (e.g. `grep -rn PATTERN src tests scripts docs`), "
        "use the Grep tool / `rg` (both honour .gitignore), or add `--exclude-dir=target` "
        "(find: `-path ./src-tauri/target -prune -o ...`).\n"
    )
    sys.exit(2)

def braces(glob):
    """`{a,b}` alternatives (the shell expands them; shlex does not)."""
    m = re.search(r"\{([^{}]*)\}", glob)
    if not m:
        return [glob]
    return [x for alt in m.group(1).split(",") for x in braces(glob[: m.start()] + alt + glob[m.end():])]

def skips_target(glob):
    return any(fnmatch.fnmatchcase("target", g) for g in braces(glob))

# grep options whose value is the next token (or the rest of a short cluster).
GREP_SHORT_ARG = set("efABCmdD")
GREP_LONG_ARG = {
    "--regexp", "--file", "--after-context", "--before-context", "--context",
    "--max-count", "--directories", "--devices", "--exclude", "--include",
    "--exclude-dir", "--include-dir", "--exclude-from", "--label", "--binary-files",
}

def check_grep(args):
    recursive = pattern_given = excluded = False
    operands = []
    i = 0
    while i < len(args):
        a = args[i]
        i += 1
        if a == "--":
            operands.extend(args[i:])
            break
        if a.startswith("--"):
            name, eq, val = a.partition("=")
            if name in ("--recursive", "--dereference-recursive"):
                recursive = True
            if name in GREP_LONG_ARG and not eq:
                val = args[i] if i < len(args) else ""
                i += 1
            if name in ("--regexp", "--file"):
                pattern_given = True
            if name == "--exclude-dir" and skips_target(val):
                excluded = True
            continue
        if a.startswith("-") and len(a) > 1:
            for k, ch in enumerate(a[1:], start=1):
                if ch in "rR":
                    recursive = True
                if ch in GREP_SHORT_ARG:
                    if ch in "ef":
                        pattern_given = True
                    if k == len(a) - 1:
                        i += 1  # value is the next token
                    break  # the rest of the cluster is the value
            continue
        operands.append(a)
    if not recursive or excluded:
        return
    paths = operands if pattern_given else operands[1:]
    if any(hits(p) for p in (paths or ["."])):
        deny("recursive grep from the repo root")

def check_find(args):
    paths = []
    for a in args:
        if a.startswith("-") or a in ("(", "!"):
            break
        paths.append(a)
    roots = paths or ["."]
    if not any(hits(p) for p in roots):
        return
    expr = args[len(paths):]
    if "-prune" in expr:
        for k, a in enumerate(expr[:-1]):
            v = expr[k + 1]
            if a in ("-name", "-iname") and skips_target(v):
                return
            if a in ("-path", "-ipath", "-wholename", "-iwholename") and any(
                fnmatch.fnmatchcase(os.path.join(r, "src-tauri", "target"), v)
                or fnmatch.fnmatchcase(os.path.join(r, "target"), v)
                for r in roots
            ):
                return
    deny("find from the repo root")

for seg in re.split(r"\|\||&&|[|;\n]", cmd):
    try:
        toks = shlex.split(seg)
    except ValueError:
        continue
    if not toks:
        continue
    prog = os.path.basename(toks[0])
    if prog in ("grep", "egrep", "fgrep", "ggrep"):
        check_grep(toks[1:])
    elif prog in ("find", "gfind"):
        check_find(toks[1:])
sys.exit(0)
PY
