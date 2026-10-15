#!/usr/bin/env python3
"""ADR-0047 WI-006 spike, S1.4 fault proxy. One connection, one fault, then exit.
Usage: faultproxy.py <listen_port> <upstream_port> <mode> [delay_s]
  lost        forward the request, read the whole response, close without sending it
  delay       forward, hold the response for delay_s, then send it (client has timed out by then)
  disconnect  forward the request, give the server 0.3 s to take it, then close both sides at once
              (the server sees the client go while the request is in hand; closing at once lost it before the server read it)
Prints one line to stdout: "upstream <first status line or '-'>"."""
import socket, sys, time

lp, up, mode = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
delay = float(sys.argv[4]) if len(sys.argv) > 4 else 5.0


def content_length(head):
    for line in head.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            return int(line.split(b":")[1])
    return None


srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", lp))
srv.listen(1)
c, _ = srv.accept()
c.settimeout(10)
req = b""
while b"\r\n\r\n" not in req:
    req += c.recv(65536)
head, _, body = req.partition(b"\r\n\r\n")
n = content_length(head) or 0
while len(body) < n:
    body += c.recv(65536)
u = socket.create_connection(("127.0.0.1", up))
u.settimeout(30)
u.sendall(head + b"\r\n\r\n" + body)
if mode == "disconnect":
    time.sleep(0.3)
    u.close()
    c.close()
    print("upstream -")
    sys.exit(0)
resp = b""
try:
    while True:
        chunk = u.recv(65536)
        if not chunk:
            break
        resp += chunk
        if b"\r\n\r\n" in resp:
            h, _, b = resp.partition(b"\r\n\r\n")
            m = content_length(h)
            if m is not None and len(b) >= m:
                break
except socket.timeout:
    pass
print("upstream " + (resp.split(b"\r\n")[0].decode() if resp else "-"))
if mode == "delay":
    time.sleep(delay)
    try:
        c.sendall(resp)
    except OSError:
        pass
c.close()
u.close()
