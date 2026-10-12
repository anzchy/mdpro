#!/usr/bin/env python3
"""Purpose: receive the Claude Code hook events the Mac mini's dtrack session pushes
(option 3.2 of docs/reference/20261011-claude-cross-machine-session-control.md; D177).

Pipeline: POST -> X-Mdpro-Token check (401) -> length (413) -> JSON object (400)
  -> receiver_spool.spool_fields: legacy body | spooled body | invalid (400)
  -> spooled: SeqState.plan -> duplicate / stale epoch: 200, nothing stored
  -> append the record to events.jsonl -> commit the seq, save seq-state.json
     and gaps.json -> mirror latest.json (not for a late event). A failed
     write -> 500.

Key decisions:
- Binds to this MacBook's Tailscale IPv4 only (MDPRO_HOOK_BIND overrides, for
  tests). The hook dir is MDPRO_HOOK_DIR, else ~/.mdpro-redesign/hooks.
- A body with no spool_* key is the legacy http-hook payload: stored exactly as
  before, never deduped. A spooled body (push.mjs) also stores its spool_*
  fields (five required, spool_orphans optional); SessionStart's own `source` field is kept apart from spool_source.
- Dedupe, gaps and retired epochs live in receiver_spool.py.
- The seq is committed only after the event is appended (D177-H-2, audit b92
  finding 3). If the append (or a later write) raises, the reply is 500: the
  sender keeps the entry and retries, and the retry is stored, not answered
  "duplicate". latest.json is mirrored last, so a failure there at worst
  turns the retry into a duplicate, never into a second events.jsonl line.
- A seq below the source's floor (receiver_spool.py) is "late": its record
  gains "spool_late": true and is appended but not mirrored to latest.json,
  so last-dtrack keeps showing the newest real event; the log says "late".
  wait-dtrack still returns it and flags it with "late seq N (source)".
- Log hygiene (D177-H-4, audit b95 M3): session, event and type are logged
  only as a str of at most 64 [A-Za-z0-9._-] chars; otherwise as "-" (None),
  "<str>", "<long str>" or "<type name>". The request path follows the same
  rule over [A-Za-z0-9._/-] ("<path>", "<long path>"), on every line,
  including the 401 line written before the token check. A value from the
  request can never inject a line or flood the log.
- The token is never logged, stored or echoed; logs carry statuses, event
  names and spool ids only. stdlib only.
"""
import datetime
import hmac
import json
import os
import re
import subprocess
import sys
import time

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo and the hook dir
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

from receiver_spool import SeqState, spool_fields

HOME = os.path.expanduser("~")
DIR = os.environ.get("MDPRO_HOOK_DIR") or os.path.join(HOME, ".mdpro-redesign", "hooks")
TOKEN_FILE = os.path.join(DIR, "token")
EVENTS = os.path.join(DIR, "events.jsonl")
LATEST = os.path.join(DIR, "latest.json")
LOG = os.path.join(DIR, "receiver.log")
SEQ_STATE = os.path.join(DIR, "seq-state.json")
GAPS = os.path.join(DIR, "gaps.json")
PORT = int(os.environ.get("MDPRO_HOOK_PORT", "8787"))
MAX_BODY = 4 * 1024 * 1024
MAX_LAST_MSG = 2000
FIELDS = ("hook_event_name", "session_id", "cwd", "notification_type", "title",
          "message", "last_assistant_message", "stop_hook_active", "matcher", "source")
WRITE_LOCK = Lock()
LOG_VALUE_MAX = 64
SAFE_VALUE_RE = re.compile(r"[A-Za-z0-9._-]+")
SAFE_PATH_RE = re.compile(r"[A-Za-z0-9._/-]+")
STATE = SeqState()


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def log_value(v):
    """A request value as it may appear in the log: itself if short and plain, else its kind."""
    if v is None:
        return "-"
    if isinstance(v, str):
        if len(v) > LOG_VALUE_MAX:
            return "<long str>"
        return v if SAFE_VALUE_RE.fullmatch(v) else "<str>"
    return f"<{type(v).__name__}>"


def log_path(p):
    if len(p) > LOG_VALUE_MAX:
        return "<long path>"
    return p if SAFE_PATH_RE.fullmatch(p) else "<path>"


def log(line):
    with WRITE_LOCK:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{now_iso()} {line}\n")


def tailscale_ip():
    if os.environ.get("MDPRO_HOOK_BIND"):
        return os.environ["MDPRO_HOOK_BIND"]
    cli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    try:
        out = subprocess.run([cli, "ip", "-4"], capture_output=True, text=True, timeout=10).stdout
        for ln in out.split():
            if ln.startswith("100."):
                return ln.strip()
    except Exception:
        pass
    try:
        out = subprocess.run(["/sbin/ifconfig"], capture_output=True, text=True, timeout=10).stdout
        for ln in out.splitlines():
            parts = ln.split()
            if len(parts) >= 2 and parts[0] == "inet" and parts[1].startswith("100."):
                return parts[1]
    except Exception:
        pass
    return None


def read_token():
    with open(TOKEN_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "mdpro-hook-receiver/1"

    def log_message(self, fmt, *args):  # silence default stderr access log
        pass

    def _reply(self, code, body=b"{}"):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reject_method(self):
        log(f"{self.client_address[0]} {self.command} {log_path(self.path)} -> 405")
        self._reply(405, b'{"error":"method not allowed"}')

    do_GET = do_PUT = do_DELETE = do_PATCH = do_HEAD = _reject_method

    def do_POST(self):
        peer = self.client_address[0]
        try:
            expected = read_token()
        except Exception as e:
            log(f"{peer} POST {log_path(self.path)} -> 500 token file unreadable: {type(e).__name__}")
            return self._reply(500, b'{"error":"server misconfigured"}')
        given = self.headers.get("X-Mdpro-Token", "")
        if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
            log(f"{peer} POST {log_path(self.path)} -> 401 (token {'missing' if not given else 'mismatch'})")
            return self._reply(401, b'{"error":"unauthorized"}')
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            log(f"{peer} POST {log_path(self.path)} -> 413 length={length}")
            return self._reply(413, b'{"error":"bad length"}')
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            if not isinstance(payload, dict):
                raise ValueError("payload is not an object")
        except Exception as e:
            log(f"{peer} POST {log_path(self.path)} -> 400 bad json: {type(e).__name__}")
            return self._reply(400, b'{"error":"bad json"}')
        try:
            spool = spool_fields(payload)
        except ValueError as e:
            log(f"{peer} POST {log_path(self.path)} -> 400 bad {e}")
            return self._reply(400, b'{"error":"bad spool fields"}')
        rec = {"received_at": now_iso(), "remote": peer}
        for k in FIELDS:
            v = payload.get(k)
            if k == "last_assistant_message" and isinstance(v, str) and len(v) > MAX_LAST_MSG:
                v = v[:MAX_LAST_MSG]
            rec[k] = v
        tag = ""
        if spool is not None:
            rec.update(spool)
            tag = f" spool={spool['spool_source']}/{spool['spool_epoch']}#{spool['spool_seq']}"
        try:
            outcome = self._store(spool, rec)
        except Exception as e:  # disk full, EACCES, a directory in the way...
            log(f"{peer} POST {log_path(self.path)} -> 500 write failed: {type(e).__name__}{tag}")
            return self._reply(500, b'{"error":"write failed"}')
        if outcome in ("stale", "duplicate"):
            log(f"{peer} POST {log_path(self.path)} -> 200 {'stale epoch' if outcome == 'stale' else 'duplicate'}{tag}")
            return self._reply(200)
        late = "late " if outcome == "late" else ""
        log(f"{peer} POST {log_path(self.path)} -> 200 {late}event={log_value(rec.get('hook_event_name'))} "
            f"type={log_value(rec.get('notification_type'))} session={log_value(rec.get('session_id'))}{tag}")
        self._reply(200)

    @staticmethod
    def _store(spool, rec):
        """Under WRITE_LOCK: dedupe a spooled event, else append it, then commit its seq.

        Returns the SeqState outcome, or "late" for a new seq below the floor; raises if
        a write fails, with the seq not committed when the append itself failed.
        """
        with WRITE_LOCK:  # log() takes the same lock, so nothing in here logs
            outcome, source, entry, late = STATE.plan(spool) if spool is not None else ("new", None, None, False)
            if outcome == "stale":
                return outcome
            if late:
                rec["spool_late"] = True
            line = json.dumps(rec, ensure_ascii=False)
            if outcome == "new":
                with open(EVENTS, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            if spool is not None:
                STATE.commit(source, entry)
                STATE.save(SEQ_STATE, GAPS)
            if outcome == "new" and not late:
                tmp = LATEST + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(line + "\n")
                os.replace(tmp, LATEST)
            return "late" if late else outcome


def main():
    global STATE
    os.makedirs(DIR, exist_ok=True)
    os.umask(0o077)
    STATE = SeqState.load(SEQ_STATE, log)
    host = None
    for _ in range(30):  # Tailscale may not be up yet at login
        host = tailscale_ip()
        if host:
            break
        time.sleep(2)
    if not host:
        log("startup failed: no Tailscale IPv4 found; refusing to bind")
        sys.exit(1)
    httpd = ThreadingHTTPServer((host, PORT), Handler)
    log(f"listening on {host}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
