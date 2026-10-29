#!/usr/bin/env python3
"""Launchd backstop: one sample per invocation, stopping only unwrapped test groups.

Use --once with StartInterval=5. State lives in ~/.cache/load-guard/state.json.
The injected process inventory and root work only with MDPRO_GUARD_TEST=1.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import guard


def state_path():
    return pathlib.Path(os.environ.get("MDPRO_LOAD_GUARD_STATE", pathlib.Path.home() / ".cache/load-guard/state.json"))


def inventory():
    injected = os.environ.get("MDPRO_LOAD_GUARD_PROCESSES")
    if os.environ.get("MDPRO_GUARD_TEST") == "1" and injected:
        return json.loads(pathlib.Path(injected).read_text())
    rows = guard.run("ps", "-axo", "pid=,ppid=,pgid=,uid=,command=").splitlines()
    parsed = []
    for row in rows:
        parts = row.split(None, 4)
        if len(parts) != 5:
            continue
        try:
            pid, ppid, pgid, uid = map(int, parts[:4])
        except ValueError:
            continue
        parsed.append({"pid": pid, "ppid": ppid, "pgid": pgid, "uid": uid, "command": parts[4]})
    target_groups = {item["pgid"] for item in parsed if any(word in item["command"] for word in
                     ("vitest", "xctest", "swiftpm-testing-helper", "/target/"))}
    result = []
    for item in parsed:
        if item["pgid"] not in target_groups:
            # Keep ancestry for registrations covering descendants in a new
            # group; an empty cwd makes these context-only rows ineligible.
            result.append({**item, "cwd": ""})
            continue
        pid = item["pid"]
        try:
            cwd_lines = guard.run("lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn").splitlines()
            cwd = next(line[1:] for line in cwd_lines if line.startswith("n"))
        except (subprocess.CalledProcessError, StopIteration):
            cwd = ""
        try:
            txt = guard.run("lsof", "-a", "-p", str(pid), "-d", "txt", "-Fn").splitlines()
            executable = next(line[1:] for line in txt if line.startswith("n"))
        except (subprocess.CalledProcessError, StopIteration):
            executable = ""
        result.append({**item, "cwd": cwd, "executable": executable})
    return result


def allowed_root(cwd):
    if not cwd:
        return False
    home = pathlib.Path.home() / "Documents/mac-app"
    roots = [home / "mdpro", home / "mdpro-wt", home / "picsee", home / "picsee-wt"]
    if os.environ.get("MDPRO_GUARD_TEST") == "1" and os.environ.get("MDPRO_LOAD_GUARD_TEST_ROOT"):
        roots.append(pathlib.Path(os.environ["MDPRO_LOAD_GUARD_TEST_ROOT"]))
    candidate = pathlib.Path(cwd).resolve()
    return any(candidate == root.resolve() or root.resolve() in candidate.parents for root in roots)


def allowlisted(process):
    command = process["command"]
    if not command:
        return False
    executable = process.get("executable") or command.split(None, 1)[0]
    if not allowed_root(process["cwd"]):
        return False
    if "Picsee.app" in command or any(name in executable.lower() for name in ("codex", "claude", "kimi", "xcodebuild", "codesign")):
        return False
    if executable == "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest" or \
            (executable == "/usr/bin/xcrun" and command.startswith("/usr/bin/xcrun xctest ")):
        match = re.search(r"(/\S+/(?:PicseeKitPackageTests|PicseeAppTests)\.xctest)(?:/|\s|$)", command)
        return bool(match and allowed_root(match.group(1)))
    if executable == "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/libexec/swift/pm/swiftpm-testing-helper":
        match = re.search(r"--test-bundle-path\s+(/\S+/PicseeKitPackageTests\.xctest)(?:/|\s|$)", command)
        return bool(match and allowed_root(match.group(1)))
    if executable.endswith("/node") or executable.endswith("/nodejs"):
        trusted = [shutil.which("node"), "/opt/homebrew/bin/node", "/usr/local/bin/node",
                   str(pathlib.Path.home() / ".local/bin/node")]
        if not any(item and pathlib.Path(executable).resolve() == pathlib.Path(item).resolve() for item in trusted):
            return False
        if process.get("executable") and re.fullmatch(r"node \(vitest(?: \d+)?\)\s*", command):
            return True
        if process.get("executable") and re.fullmatch(r"node /\S*/pnpm(?:\.c?js)? exec vitest run(?: .*)?", command):
            return True
        worker = re.search(r"(/\S+/node_modules/(?:\.pnpm/\S+/node_modules/)?vitest/\S*(?:/forks|forks\.js)\S*)", command)
        return bool(worker and allowed_root(worker.group(1)))
    if "/target/" in executable and "/deps/" in executable:
        return allowed_root(executable) and bool(re.search(r"/target/(?:debug|release)/deps/[A-Za-z0-9_.-]+$", executable))
    return False


def covered(group, processes):
    entries = guard.registered()
    if group in entries:
        return True
    by_pid = {item["pid"]: item for item in processes}
    for item in processes:
        if item["pgid"] != group:
            continue
        seen = set()
        ancestor = item
        while ancestor and ancestor["pid"] not in seen:
            seen.add(ancestor["pid"])
            if ancestor["pgid"] in entries:
                return True
            ancestor = by_pid.get(ancestor["ppid"])
    return False


def candidate_groups(processes):
    groups = {}
    for item in processes:
        groups.setdefault(item["pgid"], []).append(item)
    return {pgid: members for pgid, members in groups.items() if members and
            not covered(pgid, processes) and all(allowlisted(member) for member in members)}


def sample():
    sampler = os.environ.get("MDPRO_LOAD_GUARD_SAMPLER")
    try:
        output = guard.run(sampler) if sampler else guard.run(sys.executable, str(pathlib.Path(guard.__file__)), "sample")
        parts = output.strip().split()
        pressure, busy = parts[:2]
        available, vm_free, level = (parts[2:5] if len(parts) >= 5 else ["unreadable"] * 3)
        return int(pressure), float(busy), available, vm_free, level
    except (OSError, IndexError, ValueError, subprocess.CalledProcessError):
        return None, None, "unreadable", "unreadable", "unreadable"


def load_state():
    try:
        return json.loads(state_path().read_text())
    except (OSError, ValueError):
        return {"memory": 0, "cpu": 0, "lastSnapshot": 0}


def save_state(value):
    dest = state_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + f".{os.getpid()}.tmp")
    temp.write_text(json.dumps(value))
    os.replace(temp, dest)


def stop(pgid, members):
    # Refresh the whole group immediately before the first signal. A mixed
    # group is never eligible, even when one member looks like a runner.
    fresh = inventory()
    current = [item for item in fresh if item["pgid"] == pgid]
    if len(current) != len(members) or pgid not in candidate_groups(fresh):
        return False
    leader = next((item for item in current if item["pid"] == pgid), current[0])
    first = guard.identity(leader["pid"])
    if not first or first["uid"] != os.getuid() or first["pgid"] != pgid:
        return False
    top_rss = guard.snapshot()
    if guard.signal_if_same(pgid, leader["pid"], first["start"], "TERM") != 0:
        return False
    grace = float(os.environ.get("MDPRO_LOAD_GUARD_KILL_GRACE_SECS", "10"))
    deadline = time.time() + grace
    while time.time() < deadline:
        if not any(live_member(item["pid"]) for item in current):
            break
        time.sleep(.1)
    else:
        # TERM handlers can exec a protected tool, add a protected member, or
        # register a wrapper during grace. Identity alone cannot authorize KILL.
        if pgid not in candidate_groups(inventory()):
            return False
        guard.signal_if_same(pgid, leader["pid"], first["start"], "KILL")
    return {"topRss": top_rss}


def live_member(pid):
    if not guard.identity(pid):
        return False
    try:
        return not guard.run("ps", "-p", str(pid), "-o", "stat=").strip().startswith("Z")
    except subprocess.CalledProcessError:
        return False


def once():
    pressure, busy, available, vm_free, level = sample()
    state = load_state()
    state["memory"] = state.get("memory", 0) + 1 if pressure == 4 else 0
    state["cpu"] = state.get("cpu", 0) + 1 if busy is not None and busy > 95 else 0
    now = time.time()
    if pressure is not None and pressure >= 2 and now - state.get("lastSnapshot", 0) >= 60:
        guard.log("snapshot", "pressure", pressure, busy, "backstop", os.getcwd(), available, vm_free, level)
        state["lastSnapshot"] = now
    save_state(state)
    if state["memory"] < 2 and state["cpu"] < 3:
        return 0
    reason = "memory" if state["memory"] >= 2 else "cpu"
    groups = candidate_groups(inventory())
    for pgid, members in groups.items():
        stopped = stop(pgid, members)
        if stopped:
            guard.log("stop", reason, pressure, busy, members[0]["command"], members[0]["cwd"], available, vm_free, level, top_rss=stopped["topRss"])
    return 0


if __name__ == "__main__":
    sys.exit(once() if sys.argv[1:] == ["--once"] else 64)
