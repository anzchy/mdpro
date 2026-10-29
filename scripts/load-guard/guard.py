#!/usr/bin/env python3
"""Shared load-guard primitives. Sampler prints '<pressure> <busy> <freeGiB>'.

MDPRO_LOAD_GUARD_SAMPLER overrides sampling; MDPRO_LOAD_GUARD_LOG overrides
~/.cache/load-guard.log; MDPRO_LOAD_GUARD_ACTIVE overrides the registration
directory. Log lines are JSON with event, time, project, cmd, cwd, readings,
reason and topRss. Commands are basename + SHA256 of the entire command; no
arguments or environment values are logged or registered. New logs are mode0600.
Start identities normalise whitespace. Overload continuity allows interval +2s.
"""
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import re
import hashlib
import shlex


# Launchd samples every5s; +2s slack allows ordinary sampler/scheduler overhead.
SAMPLE_GAP_SLACK_SECS = 2
SAMPLE_TOLERANCE_SECS = 5 + SAMPLE_GAP_SLACK_SECS


def sample_is_recent(previous, now, tolerance=SAMPLE_TOLERANCE_SECS):
    return isinstance(previous, (int, float)) and 0 <= now - previous <= tolerance


# Coverage measured at 1358.2 MiB group RSS: +20% = 1.592 GiB, rounded to 2.
# Other budgets remain placeholders until measured (ADR-0153).
BUDGET_GIB = {"vitest-coverage": 2, "cargo-test": 4, "swiftpm-test": 4,
              "app-xctest": 4, "tauri-build": 4, "gui-batch": 4,
              "partial-test": 4}


def job_class(command):
    if "vitest" in command and "coverage" in command:
        return "vitest-coverage"
    if "cargo" in command and "test" in command:
        return "cargo-test"
    if "swift" in command and "test" in command:
        return "swiftpm-test"
    if "xctest" in command:
        return "app-xctest"
    if "tauri" in command and "build" in command:
        return "tauri-build"
    return "partial-test"


def budget(command):
    category = job_class(command)
    override = os.environ.get("MDPRO_LOAD_GUARD_BUDGET_GIB")
    return float(override) if override is not None else BUDGET_GIB[category]


def group_cpu(pgid):
    try:
        rows = run("ps", "-axo", "pgid=,%cpu=").splitlines()
        total = sum(float(parts[1]) for row in rows if len(parts := row.split()) == 2 and int(parts[0]) == pgid)
        return total / (os.cpu_count() or 1)
    except (ValueError, subprocess.CalledProcessError):
        return 0.0


def run(*argv):
    return subprocess.run(argv, capture_output=True, text=True, check=True).stdout


def identity(pid):
    try:
        output = run("ps", "-p", str(pid), "-o", "uid=,lstart=,pgid=").strip().split()
        return {"uid": int(output[0]), "start": normalize_start(" ".join(output[1:-1])), "pgid": int(output[-1])}
    except (ValueError, IndexError, subprocess.CalledProcessError):
        return None


def normalize_start(value):
    return " ".join(value.split())


def safe_command(command):
    """Never persist argv values, even for runners; hash before shortening."""
    digest = hashlib.sha256(command.encode("utf8")).hexdigest()[:16]
    try:
        parts = shlex.split(command)
        executable = pathlib.Path(parts[0]).name if parts else "process"
    except ValueError:
        executable = "process"
    if not re.fullmatch(r"[\w.()+-]{1,80}", executable) or "=" in executable:
        executable = "process"
    return f"{executable} sha256:{digest}"


def snapshot():
    try:
        rows = run("ps", "-axo", "pid,ppid,rss,etime,command").splitlines()[1:]
        values = []
        for row in rows:
            parts = row.strip().split(None, 4)
            if len(parts) == 5:
                values.append({"pid": int(parts[0]), "ppid": int(parts[1]),
                               "rssMiB": round(int(parts[2]) / 1024, 1),
                               "elapsed": parts[3], "command": safe_command(parts[4])})
        return sorted(values, key=lambda item: item["rssMiB"], reverse=True)[:8]
    except (ValueError, subprocess.CalledProcessError):
        return []


def log(event, reason, pressure, busy, command, cwd, available="unreadable", vm_free="unreadable", level="unreadable", project="mdpro", top_rss=None):
    dest = pathlib.Path(os.environ.get("MDPRO_LOAD_GUARD_LOG", pathlib.Path.home() / ".cache/load-guard.log"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    record = {"event": event, "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
              "project": project, "cmd": safe_command(command), "cwd": cwd,
              "readings": {"pressure": pressure, "cpuBusy": busy,
                           "availableGiB": available, "vmStatFreeGiB": vm_free,
                           "memorystatusLevel": level},
              "reason": reason, "topRss": snapshot() if top_rss is None else top_rss}
    if os.environ.get("MDPRO_LOAD_GUARD_RAW_PRESSURE"):
        record["readings"]["rawPressure"] = os.environ["MDPRO_LOAD_GUARD_RAW_PRESSURE"][:80]
    fd = os.open(dest, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")


def sample():
    raw_pressure = "error"
    try:
        raw_pressure = run("sysctl", "-n", "kern.memorystatus_vm_pressure_level").strip()
        pressure = int(raw_pressure)
        lines = [line for line in run("top", "-l", "2", "-n", "0", "-s", "1").splitlines() if "CPU usage:" in line]
        idle = float(lines[-1].split("idle")[0].split(",")[-1].strip().rstrip("%"))
        vm = run("vm_stat")
        page_size = int(re.search(r"page size of (\d+) bytes", vm).group(1))
        values = {key: int(value.replace(".", "")) for key, value in re.findall(
            r"^Pages (free|inactive|purgeable):\s+([\d.]+)", vm, re.MULTILINE)}
        free_gib = sum(values[key] for key in ("free", "inactive", "purgeable")) * page_size / 1024 ** 3
        if pressure not in (1, 2, 4) or not 0 <= idle <= 100 or len(lines) < 2:
            raise ValueError("invalid reading")
        try:
            level = int(run("sysctl", "-n", "kern.memorystatus_level").strip())
            memory_size = int(run("sysctl", "-n", "hw.memsize").strip())
            if not 0 <= level <= 100 or memory_size <= 0:
                raise ValueError("invalid memorystatus level or memory size")
            available = f"{level * memory_size / 100 / 1024 ** 3:.3f}"
            level_text = str(level)
        except (OSError, ValueError, subprocess.CalledProcessError):
            available = "unreadable"
            level_text = "unreadable"
        print(f"{pressure} {100-idle:.2f} {available} {free_gib:.3f} {level_text}")
    except (OSError, ValueError, IndexError, AttributeError, KeyError, subprocess.CalledProcessError):
        print(f"unreadable unreadable unreadable {raw_pressure[:80]}")


def active_dir():
    return pathlib.Path(os.environ.get("MDPRO_LOAD_GUARD_ACTIVE", pathlib.Path.home() / ".cache/load-guard/active"))


def register(pgid, pid, command, cwd):
    info = identity(pid)
    if not info or info["uid"] != os.getuid() or info["pgid"] != pgid:
        return 1
    directory = active_dir()
    directory.mkdir(parents=True, exist_ok=True)
    record = {"pgid": pgid, "pid": pid, "start": info["start"], "uid": info["uid"],
              "project": "mdpro", "cwd": cwd}
    fd, temp = tempfile.mkstemp(dir=directory, prefix=".active-")
    with os.fdopen(fd, "w") as stream:
        json.dump(record, stream)
    os.replace(temp, directory / f"{pgid}.json")
    return 0


def registered():
    live = set()
    directory = active_dir()
    if not directory.exists():
        return live
    for entry in directory.glob("*.json"):
        try:
            record = json.loads(entry.read_text())
            info = identity(record["pid"])
            if info and info["uid"] == record["uid"] and info["start"] == record["start"] and info["pgid"] == record["pgid"]:
                live.add(record["pgid"])
            else:
                entry.unlink(missing_ok=True)
        except (OSError, ValueError, KeyError, TypeError):
            entry.unlink(missing_ok=True)
    return live


def signal_if_same(pgid, pid, start, kind):
    info = identity(pid)
    if info and (info["uid"] != os.getuid() or info["start"] != normalize_start(start) or info["pgid"] != pgid):
        return 1
    if not info:
        # The group leader may have exited on TERM while a descendant ignored
        # it. Re-identify a surviving member twice before signalling the group.
        try:
            members = run("ps", "-axo", "pid=,pgid=").splitlines()
            candidates = [int(parts[0]) for row in members if len(parts := row.split()) == 2 and int(parts[1]) == pgid]
        except (ValueError, subprocess.CalledProcessError):
            return 1
        if not any((first := identity(member)) and first == identity(member)
                   and first["uid"] == os.getuid() and first["pgid"] == pgid for member in candidates):
            return 1
    try:
        os.killpg(pgid, getattr(signal, "SIG" + kind))
        return 0
    except (PermissionError, ProcessLookupError):
        return 1


def signal_pid_if_same(pid, start, kind):
    info = identity(pid)
    if not info or info["uid"] != os.getuid() or info["start"] != normalize_start(start):
        return 1
    try:
        os.kill(pid, getattr(signal, "SIG" + kind))
        return 0
    except (PermissionError, ProcessLookupError):
        return 1


def main(argv):
    command = argv[0]
    if command == "sample":
        sample()
    elif command == "identity":
        print(json.dumps(identity(int(argv[1]))))
    elif command == "budget":
        print(budget(argv[1]))
    elif command == "clock":
        print(time.time())
    elif command == "sample-tolerance":
        print(float(argv[1]) + SAMPLE_GAP_SLACK_SECS)
    elif command == "group-cpu":
        print(group_cpu(int(argv[1])))
    elif command == "register":
        return register(int(argv[1]), int(argv[2]), argv[3], argv[4])
    elif command == "unregister":
        (active_dir() / f"{int(argv[1])}.json").unlink(missing_ok=True)
    elif command == "registered":
        print(json.dumps(sorted(registered())))
    elif command == "signal":
        return signal_if_same(int(argv[1]), int(argv[2]), argv[3], argv[4])
    elif command == "signal-pid":
        return signal_pid_if_same(int(argv[1]), argv[2], argv[3])
    elif command == "log":
        log(*argv[1:10])
    else:
        return 64
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
