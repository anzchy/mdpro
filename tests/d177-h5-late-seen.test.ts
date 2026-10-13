// @vitest-environment node
/**
 * D177-H5-WI-1 (audit b96 M1): a late seq is stored once, not once per retry.
 *
 * Per source and epoch the receiver keeps `late_seen`, the below-floor seqs it
 * has already stored, oldest first, at most `MAX_LATE_SEEN` (1024; the oldest
 * is dropped first). A below-floor seq already in it is "duplicate" (200, not
 * stored); one not in it is late, stored and added. It persists in
 * seq-state.json; older state without it loads as empty. Accepted limit: once
 * a late seq is evicted from the bounded set, a retry of it is stored again
 * (pinned by k3).
 *
 * NOTE: recorded test g4 (tests/d177-h4-gap-floor.test.ts) expects
 * `[apply(1), apply(1)]` below the floor to be `["new", "new"]`, which is the
 * behaviour M1 removes; see the D177-H5-WI-1 report.
 *
 * Setup throughout: seq 1, then a jump to 1 000 000, so the floor is 990 000.
 * Boundaries: receiver_spool.py in a python child; a real receiver.py child on
 * 127.0.0.1 for the end-to-end cases.
 */
import { describe, expect, it } from "vitest";
import { pySpool } from "./support/d177H4Py";
import { spooled, useReceiver } from "./support/d177ReceiverFixture";

const MAX_LATE_SEEN = 1024;
const SETUP = `
st = rs.SeqState()
st.apply(ev(1)); st.apply(ev(1000000))
def late(seq):
    outcome, source, entry, is_late = st.plan(ev(seq))
    st.commit(source, entry)
    return [outcome, is_late]
`;

describe("D177-H5 late_seen in SeqState (python)", () => {
  it("k1: a retry of the same late seq is late once, then duplicate", () => {
    expect(pySpool(`${SETUP}\nprint(json.dumps([late(5), late(5), late(5)]))`)).toEqual([
      ["new", true],
      ["duplicate", false],
      ["duplicate", false],
    ]);
  });

  it("k2: two different late seqs are both late and stored", () => {
    expect(pySpool(`${SETUP}\nprint(json.dumps([late(5), late(6), late(6), late(5)]))`)).toEqual([
      ["new", true],
      ["new", true],
      ["duplicate", false],
      ["duplicate", false],
    ]);
  });

  it("k3: the cap evicts the oldest, so a re-sent evicted seq is stored again (the accepted limit)", () => {
    const out = pySpool(`${SETUP}
first = [late(s)[0] for s in range(1, ${MAX_LATE_SEEN + 2})]
print(json.dumps({"cap": getattr(rs, "MAX_LATE_SEEN", None), "all_new": all(o == "new" for o in first),
                  "kept": len(st.sources["s"].get("late_seen", [])),
                  "again": [late(1), late(${MAX_LATE_SEEN + 1}), late(3)]}))
`);
    expect(out).toEqual({
      cap: MAX_LATE_SEEN,
      all_new: true,
      kept: MAX_LATE_SEEN,
      again: [
        ["new", true],
        ["duplicate", false],
        ["duplicate", false],
      ],
    });
  });

  it("k4: late_seen persists across save and load; older state without it loads as empty", () => {
    const out = pySpool(`${SETUP}
d = tempfile.mkdtemp()
sp, gp = os.path.join(d, "seq-state.json"), os.path.join(d, "gaps.json")
late(5)
st.save(sp, gp)
st = rs.SeqState.load(sp, lambda m: None)
after_load = late(5)
old = {"s": {"epoch": "epochAAAA1111", "max": 1000000, "missing": [], "dead": 0, "orphans": 0,
             "floor": 990000, "retired": []}}
json.dump(old, open(sp, "w"))
logs = []
st = rs.SeqState.load(sp, logs.append)
print(json.dumps({"after_load": after_load, "old_logs": logs, "old_first": late(5), "old_again": late(5),
                  "gaps_keys": sorted(json.load(open(gp))["s"].keys())}))
`);
    expect(out).toEqual({
      after_load: ["duplicate", false],
      old_logs: [],
      old_first: ["new", true],
      old_again: ["duplicate", false],
      gaps_keys: ["dead", "epoch", "floor", "max", "missing"],
    });
  });

  it("k5: a new epoch starts with an empty late_seen", () => {
    const out = pySpool(`${SETUP}
late(5)
st.apply(ev(1, epoch="epochBBBB2222")); st.apply(ev(1000000, epoch="epochBBBB2222"))
o, s, e, l = st.plan(ev(5, epoch="epochBBBB2222"))
print(json.dumps([o, l]))
`);
    expect(out).toEqual(["new", true]);
  });
});

describe("D177-H5 late_seen end to end", () => {
  const fx = useReceiver();
  const JUMP = 2 + 10_000 + 50;

  it("k6: a sender retrying one old seq stores it once; a second old seq is stored too", async () => {
    await fx.sendSeqs("dtrack-mini", [2, JUMP]);
    for (let i = 0; i < 4; i++) expect((await fx.post(spooled(1))).status).toBe(200);
    expect((await fx.post(spooled(3))).status).toBe(200);
    expect(fx.events().map((r) => r.spool_seq)).toEqual([2, JUMP, 1, 3]);
    expect(fx.log()).toMatch(/-> 200 duplicate .*#1\b/);
  });

  it("k7: after a restart the same late seq is still a duplicate", async () => {
    await fx.sendSeqs("dtrack-mini", [2, JUMP]);
    expect((await fx.post(spooled(1))).status).toBe(200);
    await fx.restart();
    expect((await fx.post(spooled(1))).status).toBe(200);
    expect(fx.events().map((r) => r.spool_seq)).toEqual([2, JUMP, 1]);
  });
});
