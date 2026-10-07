#!/usr/bin/env bash
# Purpose: PreToolUse(Bash) guard — refuse recursive grep/find that would walk
# src-tauri/target (100+ GiB of Rust build output; one unscoped `grep -r .` ran
# for 5+ minutes at ~90% CPU on 2026-10-07).
#
# Blocks `grep -r/-R/--recursive` and `find` when a search root resolves (against
# the call's cwd) to the repo root or `src-tauri`, unless the command
# itself mentions `target` (e.g. `--exclude-dir=target`, `-path '*/target' -prune`).
# Exit 2 + stderr = the call is denied and the message goes back to the model.
# Everything else (rg, the Grep tool, grep on named dirs) passes untouched.
set -euo pipefail

input="$(cat)"
HOOK_INPUT="$input" python3 - <<'PY'
import json, os, re, shlex, sys

try:
    data = json.loads(os.environ["HOOK_INPUT"])
except Exception:
    sys.exit(0)
cmd = data.get("tool_input", {}).get("command", "")
cwd = data.get("cwd") or os.getcwd()
project = os.environ.get("CLAUDE_PROJECT_DIR") or ""
if not cmd or not project or "target" in cmd:
    sys.exit(0)

# Directories whose recursive walk reaches src-tauri/target.
guarded = {os.path.realpath(project), os.path.realpath(os.path.join(project, "src-tauri"))}

def hits(path):
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(path))) in guarded

def deny(what):
    sys.stderr.write(
        f"Blocked: {what} would scan src-tauri/target (100+ GiB of build output).\n"
        "Search named source dirs instead (e.g. `grep -rn PATTERN src tests scripts docs`), "
        "use the Grep tool / `rg` (both honour .gitignore), or add `--exclude-dir=target`.\n"
    )
    sys.exit(2)

for seg in re.split(r"\|\||&&|[|;\n]", cmd):
    try:
        toks = shlex.split(seg)
    except ValueError:
        continue
    if not toks:
        continue
    prog = os.path.basename(toks[0])
    args = toks[1:]
    if prog in ("grep", "egrep", "fgrep", "ggrep"):
        recursive = any(
            a in ("--recursive", "--dereference-recursive")
            or (re.match(r"^-[A-Za-z]+$", a) and ("r" in a or "R" in a))
            for a in args
        )
        if not recursive:
            continue
        operands = [a for a in args if not a.startswith("-")]
        pattern_given = any(a in ("-e", "-f") or a.startswith(("--regexp", "--file")) for a in args)
        paths = operands if pattern_given else operands[1:]
        if any(hits(p) for p in (paths or ["."])):
            deny("recursive grep from the repo root")
    elif prog in ("find", "gfind"):
        paths = []
        for a in args:
            if a.startswith("-") or a in ("(", "!"):
                break
            paths.append(a)
        if any(hits(p) for p in (paths or ["."])):
            deny("find from the repo root")
sys.exit(0)
PY
