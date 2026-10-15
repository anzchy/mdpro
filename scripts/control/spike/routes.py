#!/usr/bin/env python3
"""ADR-0047 WI-006 spike, S1.2: list every route from the pinned router source.
Usage: routes.py <path to server/router.rs>
Prints one "<METHOD> <path> <always|eval>" line per method and path; `eval` marks a
route registered only when `allow_eval` is set. Path parameters are kept as `{name}`.
Exits non-zero if any path string in the file is not accounted for, so a route the
parser misses cannot pass silently."""
import re, sys

src = open(sys.argv[1], encoding="utf-8").read()
split = src.find("if allow_eval")
if split < 0:
    sys.exit("routes.py: no `if allow_eval` block in the router")
code = re.sub(r"//[^\n]*", "", src)  # comments may hold `(` or quoted paths
split = code.find("if allow_eval")
starts = [m.start() for m in re.finditer(r"\.route\(", code)]
pairs, seen = [], set()
for i, s in enumerate(starts):
    end = starts[i + 1] if i + 1 < len(starts) else len(code)
    chunk = code[s:end]
    fb = chunk.find(".fallback(")
    if fb >= 0:
        chunk = chunk[:fb]
    m = re.match(r'\.route\(\s*"([^"]+)"\s*,', chunk)
    if not m:
        sys.exit(f"routes.py: unparsable route at offset {s}")
    path = m.group(1)
    methods = re.findall(r'(?:^|[.\s(,])(get|post|delete|put|patch)\(', chunk[m.end():])
    if not methods:
        sys.exit(f"routes.py: no method found for {path}")
    gate = "eval" if s > split else "always"
    seen.add(path)
    for method in methods:
        pairs.append(f"{method.upper()} {path} {gate}")
missing = set(re.findall(r'"(/[^"]*)"', code)) - seen
if missing:
    sys.exit("routes.py: paths not parsed: " + ", ".join(sorted(missing)))
print("\n".join(pairs))
print(f"# {len(pairs)} method+path pairs on {len(seen)} paths", file=sys.stderr)
