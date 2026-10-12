#!/usr/bin/env python3
"""Purpose: receive the Claude Code hook events the Mac mini's dtrack session pushes
(option 3.2 of docs/reference/20261011-claude-cross-machine-session-control.md; D177).

Pipeline: POST -> X-Mdpro-Token check (401) -> length (413) -> JSON object (400)
  -> receiver_spool.spool_fields: legacy body | spooled body | invalid (400)
  -> spooled: SeqState.apply -> duplicate / stale epoch: 200, nothing stored
  -> append the record to events.jsonl, mirror latest.json, save seq-state.json
     and gaps.json.

Key decisions:
- Binds to this MacBook's Tailscale IPv4 only (MDPRO_HOOK_BIND overrides, for
  tests). The hook dir is MDPRO_HOOK_DIR, else ~/.mdpro-redesign/hooks.
- A body with no spool_* key is the legacy http-hook payload: stored exactly as
  before, never deduped. A spooled body (push.mjs) also stores its spool_*
  fields (five required, spool_orphans optional); SessionStart's own `source` field is kept apart from spool_source.
- Dedupe, gaps and retired epochs live in receiver_spool.py.
- The token is never logged, stored or echoed; logs carry statuses, event
  names and spool ids only. stdlib only.
"""
import datetime
import hmac
import json
import os
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
STATE = SeqState()


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


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
        log(f"{self.client_address[0]} {self.command} {self.path} -> 405")
        self._reply(405, b'{"error":"method not allowed"}')

    do_GET = do_PUT = do_DELETE = do_PATCH = do_HEAD = _reject_method

    def do_POST(self):
        peer = self.client_address[0]
        try:
            expected = read_token()
        except Exception as e:
            log(f"{peer} POST {self.path} -> 500 token file unreadable: {type(e).__name__}")
            return self._reply(500, b'{"error":"server misconfigured"}')
        given = self.headers.get("X-Mdpro-Token", "")
        if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
            log(f"{peer} POST {self.path} -> 401 (token {'missing' if not given else 'mismatch'})")
            return self._reply(401, b'{"error":"unauthorized"}')
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            log(f"{peer} POST {self.path} -> 413 length={length}")
            return self._reply(413, b'{"error":"bad length"}')
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            if not isinstance(payload, dict):
                raise ValueError("payload is not an object")
        except Exception as e:
            log(f"{peer} POST {self.path} -> 400 bad json: {type(e).__name__}")
            return self._reply(400, b'{"error":"bad json"}')
        try:
            spool = spool_fields(payload)
        except ValueError as e:
            log(f"{peer} POST {self.path} -> 400 bad {e}")
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
        line = json.dumps(rec, ensure_ascii=False)
        outcome = self._store(spool, line)
        if outcome != "new":
            log(f"{peer} POST {self.path} -> 200 {'stale epoch' if outcome == 'stale' else 'duplicate'}{tag}")
            return self._reply(200)
        log(f"{peer} POST {self.path} -> 200 event={rec.get('hook_event_name')} "
            f"type={rec.get('notification_type')} session={rec.get('session_id')}{tag}")
        self._reply(200)

    @staticmethod
    def _store(spool, line):
        """Under WRITE_LOCK: dedupe a spooled event, else append it; returns the SeqState outcome."""
        with WRITE_LOCK:  # log() takes the same lock, so nothing in here logs
            outcome = STATE.apply(spool) if spool is not None else "new"
            if outcome == "stale":
                return outcome
            if outcome == "duplicate":
                STATE.save(SEQ_STATE, GAPS)
                return outcome
            with open(EVENTS, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            tmp = LATEST + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(line + "\n")
            os.replace(tmp, LATEST)
            if spool is not None:
                STATE.save(SEQ_STATE, GAPS)
            return outcome


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
