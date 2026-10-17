"""Candidate B control client (ADR-0047 WI-007 spike).

Usage:
    ctl.py <run-id> <cmd> [json-args] [--window main] [--id <id>]
    ctl.py --socket <path> --token-file <control.json> <cmd> ...   (tests)
Prints one line: "CTL <cmd> OK <json value>" or "CTL <cmd> ERR <code> <message>". Never prints the token.
Exit 0 on OK, 1 on ERR, 2 on usage or missing run.
"""
import json
import os
import random
import socket
import sys

RUNS = os.path.expanduser("~/Library/Application Support/mdpro-verify/runs")
RECV_LIMIT = 1 << 20
CLIENT_TIMEOUT_S = 35  # above the server's 30 s ceiling, so the server's timeout reply always wins


def load(run_id=None, control_json=None):
    path = control_json or os.path.join(RUNS, run_id, "control.json")
    with open(path) as f:
        cj = json.load(f)
    return cj["socket"], cj["token"]


def call(sock_path, token, cmd, args=None, window="main", rid=None, timeout=CLIENT_TIMEOUT_S):
    req = {"token": token, "id": rid or f"ctl-{random.getrandbits(48):012x}", "cmd": cmd, "window": window,
           "args": args or {}}
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(sock_path)
        s.sendall((json.dumps(req) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n") and len(buf) < RECV_LIMIT:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    finally:
        s.close()
    if not buf:
        return {"id": req["id"], "ok": False, "error": {"code": "no_reply", "message": "connection closed"}}
    return json.loads(buf)


def main(argv):
    window, rid, sock_path, token = "main", None, None, None
    rest = []
    it = iter(argv)
    for a in it:
        if a == "--window":
            window = next(it)
        elif a == "--id":
            rid = next(it)
        elif a == "--socket":
            sock_path = next(it)
        elif a == "--token-file":
            sock_path_tf, token = load(control_json=next(it))
            sock_path = sock_path or sock_path_tf
        else:
            rest.append(a)
    try:
        if token is None:
            run_id, rest = rest[0], rest[1:]
            sock_path, token = load(run_id=run_id)
        cmd = rest[0]
        args = json.loads(rest[1]) if len(rest) > 1 else {}
    except (IndexError, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"usage: ctl.py <run-id> <cmd> [json-args] [--window W] [--id ID] ({type(e).__name__})")
        return 2
    try:
        rep = call(sock_path, token, cmd, args, window, rid)
    except OSError as e:
        print(f"CTL {cmd} ERR transport {e}")
        return 1
    if rep.get("ok"):
        print(f"CTL {cmd} OK {json.dumps(rep.get('value'), ensure_ascii=False)}")
        return 0
    err = rep.get("error", {})
    print(f"CTL {cmd} ERR {err.get('code')} {err.get('message', '')}".rstrip())
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
