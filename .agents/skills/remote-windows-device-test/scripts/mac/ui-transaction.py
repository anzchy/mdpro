#!/usr/bin/env python3
"""Bound native launch; load large payloads in the child, preserve status, never replay."""
import base64
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid


def budget(name, default, minimum, maximum):
    value = os.environ.get(name, str(default))
    if not re.fullmatch(r"[0-9]+", value) or not minimum <= int(value) <= maximum:
        raise ValueError("UI_BUDGET_INVALID " + name)
    return int(value)


def invoke(mode, command, timeout_ms):
    common = str(Path(__file__).with_name("common.sh"))
    process = subprocess.Popen(["bash", "-c", 'source "$1"; "$2" "$3"', "ui-phase", common, mode, command],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = process.communicate(timeout=max(0.001, timeout_ms / 1000))
        if err:
            sys.stderr.buffer.write(err)
        return process.returncode, out.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        # Do not await inherited pipes after losing transport. Never replay a mutation.
        process.wait(timeout=1)
        return 124, ""


def main():
    start = time.monotonic()
    phase = budget("MDPRO_UI_PHASE_MS", 5000, 10, 5000)
    transaction = budget("MDPRO_UI_TRANSACTION_MS", 30000, 50, 85000)
    outer = budget("MDPRO_UI_OUTER_MS", 90000, 100, 90000)
    cleanup = budget("MDPRO_UI_CLEANUP_MS", 5000, 10, 5000)
    poll = budget("MDPRO_UI_POLL_MS", 25, 1, 1000)
    if not phase < transaction < outer or cleanup >= transaction or phase + cleanup > transaction:
        raise ValueError("UI_BUDGET_INVALID ordering/cleanup reservation")
    deadline = int(time.time() * 1000) + transaction
    run_id = uuid.uuid4().hex
    raw = sys.argv[1]
    if len(raw.encode("utf-8")) > 65536:
        raise ValueError("UI_STEPS_TOO_LARGE")
    steps = json.loads(raw)
    operations = {"windows", "focus", "max", "menuinfo", "visible", "showall", "restore", "layout", "setLayout",
                  "chord", "physicalChord", "menus", "shot", "wait", "filedialog", "clickat", "menuat", "menuclick", "open", "run", "tree"}
    if not isinstance(steps, list) or len(steps) > 1000 or any(
        not isinstance(s, dict) or "_identity" in s or s.get("op") not in operations or
        ("window" in s and (not isinstance(s["window"], str) or not s["window"])) for s in steps
    ):
        raise ValueError("UI_STEPS_INVALID")
    labels = [s["window"] for s in steps if "window" in s and "receipt" not in s]
    remaining = lambda: transaction - int((time.monotonic() - start) * 1000)
    win_dir = os.environ.get("WIN_DIR", r"C:\Users\jack\mdpro-audit")
    if not re.fullmatch(r"[A-Za-z]:\\[A-Za-z0-9 ._\\-]*", win_dir) or ".." in win_dir:
        raise ValueError("UI_WINDOWS_PATH_INVALID")
    if labels:
        status, answer = invoke("win_read", "cd '" + win_dir + "'; node cdp.mjs identity-native", min(phase, remaining() - cleanup))
        if status:
            if status == 124:
                print(json.dumps({"runId": run_id, "phase": "identity-read", "status": "timeout", "inputOutcome": "none", "heldInput": "released", "cleanup": "not-started"}))
            return status
        try:
            records = json.loads(answer)
            if not isinstance(records, list) or not records:
                raise ValueError()
            names = [r["label"] for r in records]
            if len(set(names)) != len(names):
                raise ValueError()
            for record in records:
                rect = record["rect"]
                if not isinstance(record["label"], str) or not record["label"] or not isinstance(rect, list) or len(rect) != 4 or any(type(n) is not int for n in rect) or rect[2] <= rect[0] or rect[3] <= rect[1]:
                    raise ValueError()
            for step in steps:
                if "window" in step and "receipt" not in step:
                    if step["window"] not in names:
                        raise ValueError()
                    step["_identity"] = records
        except (ValueError, TypeError, KeyError):
            raise ValueError("IDENTITY_INVALID: CDP answer cannot authorize native input")
    if remaining() <= cleanup:
        print(json.dumps({"runId": run_id, "phase": "preflight", "status": "timeout", "inputOutcome": "none", "cleanup": "not-started"}))
        return 124
    encoded = base64.b64encode(json.dumps(steps, separators=(",", ":")).encode()).decode()
    payload_path = win_dir + "\\ui-payload-" + run_id + ".b64"
    if len(encoded) > 4096:
        # Keep each SSH exec request below Windows' command-line limit. A lost
        # append is uncertain, so stop without retrying or dispatching a prefix.
        for offset in range(0, len(encoded), 4096):
            if remaining() <= cleanup:
                print(json.dumps({"runId": run_id, "phase": "payload-upload", "status": "timeout", "inputOutcome": "none", "cleanup": "unproved"}))
                return 124
            method = "WriteAllText" if offset == 0 else "AppendAllText"
            upload = "[IO.File]::" + method + "('" + payload_path + "','" + encoded[offset:offset + 4096] + "')"
            status, _ = invoke("win", upload, min(phase, remaining() - cleanup))
            if status:
                return status
        argument = "([IO.File]::ReadAllText('" + payload_path + "'))"
    else:
        argument = encoded
    options = f" -RunId {run_id} -PhaseMs {phase} -CleanupMs {cleanup} -PollMs {poll} -DeadlineMs {deadline} -TimeoutSec {outer / 1000:g}"
    command = "powershell -NoProfile -ExecutionPolicy Bypass -File '" + win_dir + "\\ui-run.ps1' -StepsB64 " + argument + options
    if len(encoded) > 4096:
        # Expand the file contents only inside the child PowerShell, so its
        # Windows command line remains short and ui-run retains validation.
        child_script = "& '" + win_dir + "\\ui-run.ps1' -StepsB64 " + argument + options
        child_script += "; exit $LASTEXITCODE"
        command = "powershell -NoProfile -ExecutionPolicy Bypass -Command '" + child_script.replace("'", "''") + "'"
        # Cleanup changes $?, so preserve the native status before it and exit
        # explicitly past ps_wrap; SSH must never truncate a Windows NTSTATUS.
        command = "$ErrorActionPreference='Stop'; try { " + command + "; $mdproUiRc=$LASTEXITCODE } finally { [IO.File]::Delete('" + payload_path + "') }; if ($mdproUiRc -lt 0 -or $mdproUiRc -gt 255) { exit 70 }; exit $mdproUiRc"
    status, answer = invoke("win", command, remaining())
    if status == 3:
        return 3
    if status == 124 and not answer.strip():
        print(json.dumps({"runId": run_id, "phase": "native-transport", "status": "timeout", "inputOutcome": "unknown", "heldInput": "uncertain", "cleanup": "unproved", "replay": False}))
        return 124
    if answer.strip():
        try:
            value = json.loads(base64.b64decode(answer.strip()).decode("utf-8-sig"))
            for line in value if isinstance(value, list) else [value]:
                print(line if isinstance(line, str) else json.dumps(line))
        except (ValueError, UnicodeError):
            print("UI_RESULT_INVALID: reconcile state before continuing", file=sys.stderr)
            return 1
    elif status == 0:
        print("NO OUTPUT from Windows UI transaction", file=sys.stderr)
        return 1
    return status


try:
    sys.exit(main())
except (ValueError, TypeError, KeyError, IndexError) as error:
    print(str(error) or "UI_STEPS_INVALID", file=sys.stderr)
    sys.exit(2)
