#!/usr/bin/env python3
"""Purpose: print the receiver's gaps.json as one line per problem (D177-WI-3),
for last-dtrack.sh (stdout) and wait-dtrack.sh (stderr).

Pipeline: gaps.json {"<source>": {epoch, max, missing, dead}} -> per source, in
file order: "missing seq A..B (source)" per run of consecutive missing seqs
("missing seq A (source)" for a run of one), then "dead N (source)" and
"orphans N (source)" when N > 0 (orphans: D177-WI-4).

Key decisions:
- An absent, empty or unreadable gaps.json prints nothing and exits 0: a gap
  report must never stop the caller from showing the event itself.
- The epoch is not printed; only the current epoch is in gaps.json anyway.
stdlib only.
"""
import json
import sys


def runs(seqs):
    out = []
    for s in sorted(set(x for x in seqs if isinstance(x, int) and not isinstance(x, bool))):
        if out and s == out[-1][1] + 1:
            out[-1][1] = s
        else:
            out.append([s, s])
    return out


def lines(gaps):
    for source, g in gaps.items():
        if not isinstance(g, dict):
            continue
        for a, b in runs(g.get("missing") or []):
            yield f"missing seq {a}..{b} ({source})" if a != b else f"missing seq {a} ({source})"
        dead = g.get("dead")
        if isinstance(dead, int) and not isinstance(dead, bool) and dead > 0:
            yield f"dead {dead} ({source})"
        orphans = g.get("orphans")
        if isinstance(orphans, int) and not isinstance(orphans, bool) and orphans > 0:
            yield f"orphans {orphans} ({source})"


def main(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            gaps = json.load(f)
    except Exception:
        return
    if isinstance(gaps, dict):
        for line in lines(gaps):
            print(line)


if __name__ == "__main__":
    main(sys.argv[1])
