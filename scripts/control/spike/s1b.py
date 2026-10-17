"""ADR-0047 WI-007 spike, candidate B: S1.1-S1.5 in one driver-only run (no dtrack, no user).

Usage, on the mini from the B head verify worktree, after its `control:build --profile verify
--features control-channel,devtools`:
    python3 -I s1b.py <feature-off worktree>     (e.g. ../verify-9940be9-wi005-base)
Prints one "CASE <id> PASS|FAIL|INFO <detail>" line per check and "FAILS <n>". Never prints the token.
Exit 0 only with no FAIL. Every app it starts is quit on exit.
"""
import json
import os
import re
import socket
import stat
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ctl  # noqa: E402

RUNS = os.path.expanduser("~/Library/Application Support/mdpro-verify/runs")
COMMANDS = ["ping", "windows", "find", "count", "probe", "activate", "key", "type", "click", "eval", "nosuch"]
CLIENT_TIMEOUT_S = 2.0
fails = 0
open_runs = []


def say(case, verdict, detail):
    global fails
    print(f"CASE {case} {verdict} {detail}", flush=True)
    fails += verdict == "FAIL"


def launch(cwd, env=None):
    out = subprocess.run(["pnpm", "-s", "control:launch"], cwd=cwd, env=dict(os.environ, **(env or {})),
                         capture_output=True, text=True, timeout=180)
    sys.stderr.write(out.stdout + out.stderr)
    m = re.search(r"^ready: L1 run (\S+) pid (\d+)", out.stdout, re.M)
    if not m:
        return None, None
    open_runs.append((cwd, m.group(1)))
    return m.group(1), int(m.group(2))


def quit_all():
    while open_runs:
        cwd, run = open_runs.pop()
        subprocess.run(["pnpm", "-s", "control:quit", run], cwd=cwd, capture_output=True, timeout=60)


def tcp_listeners(pid):
    out = subprocess.run(["lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN"], capture_output=True, text=True)
    return sorted({line.split()[8] for line in out.stdout.splitlines()[1:] if len(line.split()) > 8})


def log_lines(run):
    try:
        with open(os.path.join(RUNS, run, ".mdpro", "mdpro.log")) as f:
            return f.read().splitlines()
    except FileNotFoundError:
        return []


def settle(run):
    """The app logs its start-up for a moment after ready; wait until the log is still for 2 s."""
    n = len(log_lines(run))
    for _ in range(30):
        time.sleep(2)
        m = len(log_lines(run))
        if m == n:
            return
        n = m


def wait_handoff(run):
    cj = os.path.join(RUNS, run, "control.json")
    for _ in range(40):
        if os.path.exists(cj) and os.path.getsize(cj) > 0:
            return cj
        time.sleep(0.25)
    return None


class Ch:
    def __init__(self, run):
        self.sock, self.token = ctl.load(run_id=run)
        self.n = 0

    def call(self, cmd, args=None, token=None, rid=None, window="main", sock=None, timeout=10):
        self.n += 1
        return ctl.call(sock or self.sock, self.token if token is None else token, cmd, args, window,
                        rid or f"s1b-{cmd}-{self.n}-{time.time_ns() % 10**9}", timeout=timeout)


def code(rep):
    return "OK" if rep.get("ok") else rep.get("error", {}).get("code")


def prefs_starts(run):
    return sum(1 for line in log_lines(run) if '"preferences.set"' in line and '"start"' in line.lower())


def checkbox(ch):
    return ch.call("probe", {"kind": "dialog"}).get("value", {}).get("checkbox")


def fault_proxy(target, mode, path):
    """One connection: lost = forward, drop the reply; delay = hold the reply past the client timeout;
    disconnect = read the request, close the client, then forward after 0.3 s and discard the reply."""
    srv = socket.socket(socket.AF_UNIX)
    srv.bind(path)
    srv.listen(1)

    def run():
        c, _ = srv.accept()
        req = c.makefile("rb").readline()
        if mode == "disconnect":
            c.close()
            time.sleep(0.3)
        up = socket.socket(socket.AF_UNIX)
        up.connect(target)
        up.sendall(req)
        reply = up.makefile("rb").readline()
        up.close()
        if mode == "delay":
            time.sleep(CLIENT_TIMEOUT_S + 1.5)
            try:
                c.sendall(reply)
            except OSError:
                pass
        if mode != "disconnect":
            c.close()
        srv.close()
        os.unlink(path)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


def s1_off(off_wt):
    run, pid = launch(off_wt)
    if not pid:
        return say("a0", "FAIL", "feature-off launch failed")
    time.sleep(3)
    rd = os.path.join(RUNS, run)
    files = [f for f in ("c.sock", "control.json") if os.path.exists(os.path.join(rd, f))]
    tcp = tcp_listeners(pid)
    ok = not files and len(tcp) <= 1
    say("a0", "PASS" if ok else "FAIL", f"feature-off: channel files {files or 'none'}, TCP listeners {tcp}")
    quit_all()


def s1_on_eval_off(on_wt):
    run, pid = launch(on_wt)
    cj = wait_handoff(run) if pid else None
    if not cj:
        say("a1", "FAIL", "no control.json")
        return None
    rd = os.path.join(RUNS, run)
    ch = Ch(run)
    sock_mode = stat.S_IMODE(os.stat(ch.sock).st_mode)
    cj_mode = stat.S_IMODE(os.stat(cj).st_mode)
    inside = os.path.dirname(os.path.realpath(ch.sock)) == os.path.realpath(rd)
    ok = sock_mode == cj_mode == 0o600 and inside and os.stat(ch.sock).st_uid == os.getuid()
    say("a1", "PASS" if ok else "FAIL", f"c.sock {oct(sock_mode)}, control.json {oct(cj_mode)}, in run dir {inside}")
    tcp = tcp_listeners(pid)
    say("a2", "PASS" if len(tcp) <= 1 else "FAIL", f"TCP listeners {tcp} (MCP only expected)")
    settle(run)
    before = log_lines(run)
    bad = []
    for cmd in COMMANDS:
        for label, tok in (("none", ""), ("wrong", ch.token[::-1]), ("short", ch.token[:8])):
            c = code(ch.call(cmd, {"key": "a", "text": "a", "x": 1, "y": 1, "script": "return 1"}, token=tok))
            if c != "unauthorized":
                bad.append(f"{cmd}/{label}={c}")
    after = log_lines(run)
    new = after[len(before):]
    only_rejects = all('"control.reject"' in line for line in new)
    say("a3", "PASS" if not bad and only_rejects else "FAIL",
        f"{len(COMMANDS)} commands x 3 bad tokens all unauthorized; new log lines {len(new)}, all control.reject {only_rejects}" + (f"; bad {bad}" if bad else ""))
    c = code(ch.call("eval", {"script": "document.title='pwned'; return 1"}))
    title = ch.call("find", {"using": "css", "value": "title"}).get("value", {}).get("text")
    say("a5", "PASS" if c == "eval_disabled" and title != "pwned" else "FAIL", f"eval off → {c}; title untouched {title != 'pwned'}")
    r = [code(ch.call("windows")), code(ch.call("find", {"using": "css", "value": "body"})), code(ch.call("probe", {"kind": "tabs"}))]
    say("a6", "PASS" if r == ["OK"] * 3 else "FAIL", f"fixed commands with eval off: windows/find/probe → {r}")
    n0 = len(log_lines(run))
    inj = [ch.call("find", {"using": "css", "value": "'); document.title='pwned'; ('"}),
           ch.call("find", {"using": "xpath", "value": "//*[1]\"));document.title='pwned';((\""}),
           ch.call("type", {"text": "</script>"})]
    title = ch.call("find", {"using": "css", "value": "title"}).get("value", {}).get("text")
    dialogs = ch.call("probe", {"kind": "dialog"}).get("value", {}).get("dialog")
    say("a7", "PASS" if title != "pwned" and not dialogs else "FAIL",
        f"injection via arguments → {[code(x) for x in inj]}; title untouched {title != 'pwned'}; log +{len(log_lines(run)) - n0}")
    r = [code(ch.call("key", {"key": "a"}, rid="")), code(ch.call("key", {"key": "a"}, rid="bad id!"))]
    say("a8", "PASS" if r == ["bad_request"] * 2 else "FAIL", f"mutation without id / bad id → {r}")
    return run, ch


def s14(run, ch):
    ch.call("activate")
    ch.call("key", {"key": ",", "mods": ["cmd"]})
    time.sleep(1)
    nav = ch.call("click", {"using": "xpath", "value": "//button[contains(@class,'settings-category-btn') and contains(., 'Markdown')]"})
    time.sleep(1)
    if checkbox(ch) is None:
        return say("setup", "FAIL", f"settings/Markdown page not reached ({code(nav)})")
    say("setup", "PASS", "settings open on the Markdown page, checkbox found")
    target = {"using": "css", "value": "#md-auto-pair"}
    fp = os.path.join(RUNS, run, "f.sock")
    for case, mode in (("f1-lost", "lost"), ("f2-delay", "delay"), ("f3-disconnect", "disconnect")):
        x0, s0, rid = checkbox(ch), prefs_starts(run), f"s1b-{case}-{time.time_ns() % 10**9}"
        t = fault_proxy(ch.sock, mode, fp)
        try:
            first = code(ch.call("click", target, rid=rid, sock=fp, timeout=CLIENT_TIMEOUT_S))
        except OSError as e:
            first = f"client:{type(e).__name__}"
        t.join(10)
        time.sleep(1)
        retry = code(ch.call("click", target, rid=rid))
        time.sleep(1)
        x1, ran = checkbox(ch), prefs_starts(run) - s0
        ok = retry == "duplicate" and ran == 1 and x0 != x1
        say(case, "PASS" if ok else "FAIL", f"first={first} retry={retry} ran={ran} checkbox {x0}→{x1}")
    x0, s0, rid, res = checkbox(ch), prefs_starts(run), f"s1b-f4-{time.time_ns() % 10**9}", []
    ts = [threading.Thread(target=lambda: res.append(code(ch.call("click", target, rid=rid)))) for _ in range(2)]
    [t.start() for t in ts]
    [t.join(15) for t in ts]
    time.sleep(1)
    ran = prefs_starts(run) - s0
    say("f4-dup", "PASS" if sorted(res) == ["OK", "duplicate"] and ran == 1 else "FAIL", f"codes {sorted(res)} ran={ran} checkbox {x0}→{checkbox(ch)}")
    s0 = prefs_starts(run)
    ch.call("click", target)
    time.sleep(1)
    ran = prefs_starts(run) - s0
    say("f5-fresh", "PASS" if ran == 1 else "FAIL", f"new id ran={ran}")
    rep = ch.call("ping", rid="corr-1234")
    say("c1-corr", "PASS" if rep.get("id") == "corr-1234" else "FAIL", f"reply id {rep.get('id')}")
    rep = ch.call("click", {"using": "css", "value": "#no-such-node-s1b"})
    ok = rep.get("ok") is False and rep["error"]["code"] == "no_such_element" and rep["error"].get("message")
    say("c2-envelope", "PASS" if ok else "FAIL", json.dumps(rep.get("error")))


def s15_eval_on(on_wt, stale_token):
    run, pid = launch(on_wt, {"MDPRO_CONTROL_EVAL": "1"})
    if not (pid and wait_handoff(run)):
        return say("e0", "FAIL", "eval-on launch failed")
    ch = Ch(run)
    with open(os.path.join(RUNS, run, "control.json")) as f:
        say("e0", "PASS" if json.load(f)["eval"] is True else "FAIL", "eval flag in control.json")
    say("a4", "PASS" if code(ch.call("ping", token=stale_token)) == "unauthorized" else "FAIL", "previous run's token refused")
    rep = ch.call("eval", {"script": "return new Promise(r => setTimeout(() => r(41 + 1), 300));"})
    say("c3-promise", "PASS" if rep.get("value") == 42 else "FAIL", f"Promise awaited → {rep.get('value', code(rep))}")
    rep = ch.call("eval", {"script": "return new Promise(r => setTimeout(() => r('late'), 2500));", "timeoutMs": 1000})
    ok = code(rep) == "timeout" and rep.get("outcome") == "unknown"
    say("c4-timeout", "PASS" if ok else "FAIL", f"{code(rep)} outcome={rep.get('outcome')}")
    time.sleep(2.5)
    fresh = ch.call("eval", {"script": "return 'fresh';"}).get("value")
    left = ch.call("eval", {"script": "return Object.keys(window.__mdproCtl || {}).filter(k => k !== '__dead').length;"}).get("value")
    say("c5-late", "PASS" if fresh == "fresh" and left == 0 else "FAIL", f"next call got {fresh!r}; unread results left in the page {left}")
    lines = log_lines(run)
    say("tok", "FAIL" if any(ch.token in line for line in lines) else "PASS", "token absent from mdpro.log")
    quit_all()


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    on_wt = os.getcwd()
    try:
        s1_off(argv[0])
        got = s1_on_eval_off(on_wt)
        stale = None
        if got:
            run, ch = got
            stale = ch.token
            s14(run, ch)
            say("tok0", "FAIL" if any(ch.token in line for line in log_lines(run)) else "PASS", "token absent from mdpro.log (eval off)")
            quit_all()
        s15_eval_on(on_wt, stale or "0" * 64)
    finally:
        quit_all()
    print(f"FAILS {fails}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
