#!/usr/bin/env python3
"""Launchd backstop: one sample per invocation, stopping only unwrapped test groups.

Use --once with StartInterval=5. State lives in ~/.cache/load-guard/state.json.
The injected process inventory and root work only with MDPRO_GUARD_TEST=1.
CPU attribution uses each current group identity's last three consecutive hot
samples; interval +2s continuity expires after sleep or clock rollback.
Unrelated machine load warns and never authorises a stop.
"""
import json
import os
import pathlib
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import guard
from policy import allowed_root, allowlisted, authorized_group, support


def state_path():
    return pathlib.Path(os.environ.get("MDPRO_LOAD_GUARD_STATE", pathlib.Path.home() / ".cache/load-guard/state.json"))


def inventory(extra_groups=()):
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
    target_groups.update(extra_groups)
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


def candidate_groups(processes, draining=None):
    groups = {}
    for item in processes:
        groups.setdefault(item["pgid"], []).append(item)
    return {pgid: members for pgid, members in groups.items() if members and
            not covered(pgid, processes) and (authorized_group(members) or
            drain_authorized(members, draining or {}))}


def drain_authorized(members, draining):
    """Retain TERM-time authority only for exact, unchanged surviving members.

    A parent's death may orphan support. Neither a new member nor exec, changed
    argv/cwd/uid/start, or a live registration can inherit that authority.
    """
    if not members:
        return False
    for item in members:
        saved = draining.get(item["pid"])
        if not saved or any(item.get(key) != saved["process"].get(key)
                            for key in ("executable", "command", "cwd", "uid", "pgid")):
            return False
        if guard.identity(item["pid"]) != saved["identity"]:
            return False
    return True


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


def stop(pgid, members, expected):
    # Refresh the whole group immediately before the first signal. A mixed
    # group is never eligible, even when one member looks like a runner.
    fresh = inventory([pgid])
    current = [item for item in fresh if item["pgid"] == pgid]
    if len(current) != len(members) or pgid not in candidate_groups(fresh):
        return False
    leader = next((item for item in current if item["pid"] == pgid), current[0])
    first = guard.identity(leader["pid"])
    if not first or first["uid"] != os.getuid() or first["pgid"] != pgid or first != expected.get(leader["pid"]):
        return False
    draining = {item["pid"]: {"process": item, "identity": guard.identity(item["pid"])} for item in current}
    if {pid: entry["identity"] for pid, entry in draining.items()} != expected or any(
            not entry["identity"] or entry["identity"]["uid"] != os.getuid() for entry in draining.values()):
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
        if pgid not in candidate_groups(inventory([pgid]), draining):
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
    now = time.time()
    recent = guard.sample_is_recent(state.get("memorySampleTime"), now)
    previous_memory = state.get("memory", 0) if recent else 0
    previous_cpu = state.get("cpu", 0) if recent else 0
    state["memory"] = previous_memory + 1 if pressure == 4 else 0
    state["cpu"] = previous_cpu + 1 if busy is not None and busy > 95 else 0
    state["memorySampleTime"] = now
    if pressure is not None and pressure >= 2 and now - state.get("lastSnapshot", 0) >= 60:
        guard.log("snapshot", "pressure", pressure, busy, "backstop", os.getcwd(), available, vm_free, level)
        state["lastSnapshot"] = now
    groups = candidate_groups(inventory())
    histories = {}
    for pgid, members in groups.items():
        leader = next((item for item in members if item["pid"] == pgid), members[0])
        expected = {item["pid"]: guard.identity(item["pid"]) for item in members}
        info = expected[leader["pid"]]
        cpu_stop = False
        if busy is not None and busy > 95 and info and info["uid"] == os.getuid():
            identity = {**info, "pid": leader["pid"]}
            previous = state.get("groups", {}).get(str(pgid), {})
            continuous = previous.get("identity") == identity and guard.sample_is_recent(previous.get("sampleTime"), now)
            readings = previous.get("readings", []) if continuous else []
            readings = (readings + [[busy, guard.group_cpu(pgid)]])[-3:]
            logged = previous.get("logged", False) if continuous else False
            if len(readings) == 3:
                cpu_stop = sum(row[1] for row in readings) > .8 * sum(row[0] for row in readings)
                if not cpu_stop and not logged:
                    guard.log("warn", "cpu", pressure, busy, leader["command"], leader["cwd"], available, vm_free, level)
                    logged = True
            histories[str(pgid)] = {"identity": identity, "readings": readings, "logged": logged, "sampleTime": now}
        if state["memory"] >= 2 or cpu_stop:
            reason = "memory" if state["memory"] >= 2 else "cpu"
            stopped = stop(pgid, members, expected)
            if stopped:
                guard.log("stop", reason, pressure, busy, leader["command"], leader["cwd"], available, vm_free, level, top_rss=stopped["topRss"])
                histories.pop(str(pgid), None)
    state["groups"] = histories
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(once() if sys.argv[1:] == ["--once"] else 64)
