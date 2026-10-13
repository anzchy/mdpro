// @vitest-environment node
/**
 * D177-H5-WI-1 (audit b96 L3): `floor` (and `late_seen`) are validated on load.
 *
 * A loaded floor that is not a safe integer >= 1 makes the whole
 * seq-state.json corrupt, via the existing corrupt path, which as of 54d33c9
 * does this: the file is renamed to `seq-state.json.corrupt-<YYYYmmddTHHMMSS>`,
 * one line "seq-state.json unreadable (<ExcName>); moved to <name>, starting
 * empty" is logged, and the state starts empty. No clamping. Likewise a
 * `late_seen` that is not a list of safe integers >= 1. A valid floor, or no
 * floor at all, loads as it is.
 *
 * Boundary: receiver_spool.py in a python child, a temp dir.
 */
import { describe, expect, it } from "vitest";
import { pySpool } from "./support/d177H4Py";

function load(entryExtra: string): unknown {
  return pySpool(`
d = tempfile.mkdtemp()
sp = os.path.join(d, "seq-state.json")
entry = {"epoch": "epochAAAA1111", "max": 7, "missing": [], "dead": 0, "orphans": 0, "retired": []}
entry.update(${entryExtra})
raw = json.dumps({"s": entry})
open(sp, "w").write(raw)
logs = []
st = rs.SeqState.load(sp, logs.append)
names = sorted(os.listdir(d))
aside = [n for n in names if n.startswith("seq-state.json.corrupt-")]
print(json.dumps({"sources": sorted(st.sources), "floor": st.sources.get("s", {}).get("floor"),
                  "names": ["seq-state.json" if n == "seq-state.json" else n.rsplit("-", 1)[0] + "-<stamp>" for n in names],
                  "aside_same": bool(aside) and open(os.path.join(d, aside[0])).read() == raw,
                  "logs": [l.split(";")[0] for l in logs], "moved_to": bool(logs) and aside[0] in logs[0] if aside else None}))
`);
}

const CORRUPT = {
  sources: [],
  floor: null,
  names: ["seq-state.json.corrupt-<stamp>"],
  aside_same: true,
  logs: ["seq-state.json unreadable (ValueError)"],
  moved_to: true,
};

describe("D177-H5 floor validated on load", () => {
  it.each([
    ["0", "{'floor': 0}"],
    ["negative", "{'floor': -3}"],
    ["a float", "{'floor': 1.5}"],
    ["a string", "{'floor': '2'}"],
    ["a bool", "{'floor': True}"],
    ["above 2^53 - 1", "{'floor': 2**53}"],
    ["late_seen not a list", "{'floor': 2, 'late_seen': 'x'}"],
    ["late_seen with a 0", "{'floor': 2, 'late_seen': [1, 0]}"],
    ["late_seen with a string", "{'floor': 2, 'late_seen': ['1']}"],
  ])("f1: a floor/late_seen that is %s takes the corrupt path", (_n, extra) => {
    expect(load(extra)).toEqual(CORRUPT);
  });

  it.each([
    ["absent", "{}", 1],
    ["1", "{'floor': 1}", 1],
    ["5 with a valid late_seen", "{'floor': 5, 'late_seen': [1, 3]}", 5],
  ])("f2: a floor that is %s loads as it is", (_n, extra, floor) => {
    const out = load(extra) as { sources: string[]; floor: number | null; names: string[]; logs: string[] };
    expect(out.sources).toEqual(["s"]);
    expect(out.floor ?? 1).toBe(floor);
    expect(out.names).toEqual(["seq-state.json"]);
    expect(out.logs).toEqual([]);
  });
});
