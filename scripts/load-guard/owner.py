#!/usr/bin/env python3
"""Argument-free owner summaries and identity-only diagnostics for heavy-lock.

The keeper UUID is an ownership identity, retained in the existing cmd prefix;
its ready path is omitted. Foreign owner files are read-only and cmd is never
shown, even when it appears to contain a safe-summary prefix.
"""
import pathlib
import sys

from guard import safe_command


def summary(command, keeper, label):
    safe = safe_command(command)
    return f"--keeper {label} {safe.split()[-1]}" if keeper == "1" else safe


def describe(filename):
    try:
        lines = pathlib.Path(filename).read_text().splitlines()
    except OSError:
        return "(no owner file)"
    header = []
    for line in lines:
        key = line.partition("=")[0]
        # cmd is the final header: newlines in its raw foreign argv cannot
        # create additional trusted identity fields. Never parse that payload.
        if key == "cmd":
            break
        if key in ("pid", "started", "process_start", "cwd"):
            header.append(line)
    return " ".join(header)


if __name__ == "__main__":
    if sys.argv[1] == "summary":
        print(summary(*sys.argv[2:]))
    elif sys.argv[1] == "describe":
        print(describe(sys.argv[2]))
    else:
        sys.exit(64)
