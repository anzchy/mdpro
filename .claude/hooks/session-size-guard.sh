#!/usr/bin/env bash
# Purpose: PostToolUse hook that tells a long-running session it is time to
# write a handoff and be /clear-ed or replaced (rule 70 § Session rotation,
# .claude/rules/70-multi-session-coordination.md). It counts from the session
# transcript so the model never has to count for itself.
#
# Metrics, read from `transcript_path` (JSONL):
# - compactions: lines with "type":"system" and "subtype":"compact_boundary".
# - human turns: "type":"user" lines whose message.content is a string or a
#   list holding a `text` item, excluding isMeta and isCompactSummary. Tool
#   results (lists of `tool_result`) do not count.
# - bytes: the transcript's size.
# Levels: 1 (soft) at SOFT_COMPACTIONS; 2 (strong) at STRONG_COMPACTIONS or
# STRONG_BYTES. Each level is announced once per session_id: the hook prints
# only when the level rises above the last level it warned about.
#
# State: ${MDPRO_SESSION_GUARD_STATE_DIR:-$HOME/.mdpro-redesign/session-guard}/
# <session_id>.json holds the byte offset already parsed, the running counts and
# the last level warned, so each call parses only the bytes appended since the
# last one (a transcript of ~80 MB is re-read in full only on the first call).
# A file smaller than the stored offset is a new or truncated transcript and is
# re-parsed from 0. A trailing line without its newline waits for the next call.
# session_id must match ^[A-Za-z0-9_-]+$ or the hook does nothing.
#
# Input: Claude Code's hook JSON on stdin (`session_id`, `transcript_path`).
# Output on a warning: exit 0 and one JSON object on stdout, `systemMessage` for
# the user (Chinese) and `hookSpecificOutput.additionalContext` for the model.
# Otherwise exit 0 with no output. Every error path (malformed stdin, missing or
# unreadable transcript, bad JSON lines, corrupt state) exits 0 silently: this
# runs after every tool call, and a warning is never worth breaking one.
# Env overrides for tests: MDPRO_SESSION_SOFT_COMPACTIONS,
# MDPRO_SESSION_STRONG_COMPACTIONS, MDPRO_SESSION_STRONG_BYTES.
# Regression tests: tests/tooling/session-size-guard-hook.test.ts.
set -uo pipefail

SOFT_COMPACTIONS="${MDPRO_SESSION_SOFT_COMPACTIONS:-5}"
STRONG_COMPACTIONS="${MDPRO_SESSION_STRONG_COMPACTIONS:-10}"
STRONG_BYTES="${MDPRO_SESSION_STRONG_BYTES:-26214400}" # 25 MiB
STATE_DIR="${MDPRO_SESSION_GUARD_STATE_DIR:-$HOME/.mdpro-redesign/session-guard}"

input="$(cat 2>/dev/null)" || exit 0
HOOK_INPUT="$input" SOFT_COMPACTIONS="$SOFT_COMPACTIONS" STRONG_COMPACTIONS="$STRONG_COMPACTIONS" \
  STRONG_BYTES="$STRONG_BYTES" STATE_DIR="$STATE_DIR" python3 - <<'PY' 2>/dev/null
import json, os, re, sys

def main():
    try:
        data = json.loads(os.environ["HOOK_INPUT"])
    except Exception:
        return
    if not isinstance(data, dict):
        return
    sid = data.get("session_id")
    tpath = data.get("transcript_path")
    if not isinstance(sid, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", sid):
        return
    if not isinstance(tpath, str) or not tpath:
        return
    try:
        soft = int(os.environ["SOFT_COMPACTIONS"])
        strong = int(os.environ["STRONG_COMPACTIONS"])
        strong_bytes = int(os.environ["STRONG_BYTES"])
    except Exception:
        return

    state_dir = os.environ["STATE_DIR"]
    state_path = os.path.join(state_dir, sid + ".json")
    state = {"offset": 0, "compactions": 0, "human": 0, "warned": 0}
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict) and all(isinstance(loaded.get(k), int) for k in state):
            state = {k: loaded[k] for k in state}
    except Exception:
        pass

    try:
        f = open(tpath, "rb")
    except Exception:
        return
    with f:
        size = os.fstat(f.fileno()).st_size
        if size < state["offset"]:
            state = {"offset": 0, "compactions": 0, "human": 0, "warned": 0}
        f.seek(state["offset"])
        chunk = f.read(size - state["offset"])

    end = chunk.rfind(b"\n")
    complete = chunk[: end + 1] if end >= 0 else b""
    compactions, human = state["compactions"], state["human"]
    for line in complete.splitlines():
        # Cheap substring tests first: most lines are neither kind, and json
        # parsing every line of an 80 MB transcript is the slow path.
        is_compact = b"compact_boundary" in line
        is_user = b'"user"' in line
        if not (is_compact or is_user):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        kind = obj.get("type")
        if kind == "system" and obj.get("subtype") == "compact_boundary":
            compactions += 1
        elif kind == "user" and not obj.get("isMeta") and not obj.get("isCompactSummary"):
            msg = obj.get("message")
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, str) or (
                isinstance(content, list)
                and any(isinstance(i, dict) and i.get("type") == "text" for i in content)
            ):
                human += 1

    state.update(offset=state["offset"] + len(complete), compactions=compactions, human=human)

    level = 0
    if compactions >= strong or size >= strong_bytes:
        level = 2
    elif compactions >= soft:
        level = 1

    warn = level > state["warned"]
    if warn:
        state["warned"] = level

    try:
        os.makedirs(state_dir, exist_ok=True)
        tmp = state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as out:
            json.dump(state, out)
        os.replace(tmp, state_path)
    except Exception:
        return  # without state we would repeat the warning on every call

    if not warn:
        return

    mb = f"{size / 1048576:.1f}"
    metrics_zh = f"会话已压缩 {compactions} 次（{mb} MB，你的发言 {human} 轮）。"
    if level == 1:
        user_text = metrics_zh + "建议在下一个 WI 边界写交接后 /clear 或换新会话（rule 70 § 会话轮换）"
        when = "At the next safe point (the next WI boundary)"
    else:
        user_text = metrics_zh + "建议做完当前步骤就写交接并轮换（rule 70 § 会话轮换）"
        when = "As soon as the current step is done"
    model_text = (
        f"This session is long: {compactions} compactions, {mb} MB transcript, "
        f"{human} human turns. Per rule 70 \"Session rotation\": {when}, write a handoff to "
        "~/.mdpro-redesign/handoff/<alias>-<YYYYMMDD-HHMM>.md (<alias> = your session alias) "
        "covering the current WI/D, branch and HEAD, uncommitted state, next step, "
        "ADR/D numbers held, and open questions; tell mdpro-delegator its path (unless you "
        "are the delegator); then tell the user it is ready for /clear."
    )
    sys.stdout.write(json.dumps({
        "systemMessage": user_text,
        "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": model_text},
    }, ensure_ascii=False))

try:
    main()
except Exception:
    pass
PY
exit 0
