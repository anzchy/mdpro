// @vitest-environment node
/**
 * D177-H-4 (audit b95 M2): the gap cap must not turn a retry into "duplicate".
 *
 * Per source and epoch the receiver keeps `floor`, the lowest seq it can still
 * judge. Whenever the MAX_MISSING cap discards history the floor rises: on a
 * trim to the lowest retained missing seq, on a capped jump to that jump's
 * `low`. A seq below the floor is unknown: accepted, stored, "new", never
 * "duplicate"; it does not enter `missing` and `max` does not move. Accepted
 * cost: a genuine duplicate below the floor is stored twice. At or above the
 * floor nothing changes. `floor` persists in seq-state.json (older state
 * without it loads as floor 1) and shows in gaps.json only while > 1.
 *
 * Boundaries: receiver_spool.py in a python child for the large cases; one
 * real receiver.py child on 127.0.0.1 for the end-to-end retry.
 */
import { describe, expect, it } from "vitest";
import { pySpool } from "./support/d177H4Py";
import { EPOCH_A, spooled, useReceiver } from "./support/d177ReceiverFixture";

const CAP = 10_000;

describe("D177-H4 floor in SeqState (python)", () => {
  it("g1: seq 1 retried after a trim (more than MAX_MISSING newer gaps) is new, the floor is the lowest retained gap", () => {
    const out = pySpool(`
st = rs.SeqState()
outs = [st.apply(ev(s)) for s in (2, 6002, 12002)]
e = st.sources["s"]
floor, n, low = e.get("floor"), len(e["missing"]), e["missing"][0]
outs += [st.apply(ev(1)), st.apply(ev(1500))]
e = st.sources["s"]
print(json.dumps({"cap": rs.MAX_MISSING, "outs": outs, "floor": floor, "n": n, "lowest": low,
                  "max": e["max"], "has1": 1 in e["missing"], "n_after": len(e["missing"])}))
`);
    expect(out).toEqual({
      cap: CAP,
      outs: ["new", "new", "new", "new", "new"],
      floor: 2001,
      n: CAP,
      lowest: 2001,
      max: 12002,
      has1: false,
      n_after: CAP,
    });
  });

  it("g2: after one huge jump a seq below `low` is new; max, missing and floor stay put", () => {
    const out = pySpool(`
st = rs.SeqState()
st.apply(ev(1))
st.apply(ev(1000000))
before = dict(st.sources["s"], missing=list(st.sources["s"]["missing"]))
outs = [st.apply(ev(5)), st.apply(ev(989999))]
e = st.sources["s"]
print(json.dumps({"floor": before.get("floor"), "outs": outs, "max": e["max"],
                  "same_missing": e["missing"] == before["missing"], "floor_after": e.get("floor")}))
`);
    expect(out).toEqual({ floor: 990_000, outs: ["new", "new"], max: 1_000_000, same_missing: true, floor_after: 990_000 });
  });

  it("g3: at or above the floor a received seq is still duplicate and a missing one is new and leaves missing", () => {
    const out = pySpool(`
st = rs.SeqState()
st.apply(ev(1))
st.apply(ev(1000000))
outs = [st.apply(ev(1000000)), st.apply(ev(990000)), st.apply(ev(990000)), st.apply(ev(995000))]
e = st.sources["s"]
print(json.dumps({"outs": outs, "has990000": 990000 in e["missing"], "has995000": 995000 in e["missing"],
                  "n": len(e["missing"])}))
`);
    expect(out).toEqual({ outs: ["duplicate", "new", "duplicate", "new"], has990000: false, has995000: false, n: CAP - 2 });
  });

  it("g4: the accepted cost — a received seq below the floor is new again (stored twice, never lost)", () => {
    const out = pySpool(`
st = rs.SeqState()
st.apply(ev(1))
st.apply(ev(1000000))
print(json.dumps([st.apply(ev(1)), st.apply(ev(1))]))
`);
    expect(out).toEqual(["new", "new"]);
  });

  it("g5: the floor persists across save and load, and shows in gaps.json only while above 1", () => {
    const out = pySpool(`
d = tempfile.mkdtemp()
sp, gp = os.path.join(d, "seq-state.json"), os.path.join(d, "gaps.json")
st = rs.SeqState()
st.apply(ev(1)); st.apply(ev(3, source="t"))
st.apply(ev(1000000))
st.save(sp, gp)
gaps = json.load(open(gp))
st2 = rs.SeqState.load(sp, lambda m: None)
print(json.dumps({"floor": st2.sources["s"].get("floor"), "out": st2.apply(ev(7)),
                  "gaps_s_floor": gaps["s"].get("floor"), "gaps_t": gaps["t"]}))
`);
    expect(out).toEqual({
      floor: 990_000,
      out: "new",
      gaps_s_floor: 990_000,
      gaps_t: { epoch: "epochAAAA1111", max: 3, missing: [1, 2], dead: 0 },
    });
  });

  it("g6: state written before the floor existed loads as floor 1 and judges as before", () => {
    const out = pySpool(`
d = tempfile.mkdtemp()
sp = os.path.join(d, "seq-state.json")
json.dump({"s": {"epoch": "epochAAAA1111", "max": 5, "missing": [3], "dead": 0, "orphans": 0, "retired": []}}, open(sp, "w"))
logs = []
st = rs.SeqState.load(sp, logs.append)
print(json.dumps({"logs": logs, "outs": [st.apply(ev(2)), st.apply(ev(3)), st.apply(ev(3))],
                  "floor": st.sources["s"].get("floor", 1), "aside": sorted(os.listdir(d))}))
`);
    expect(out).toEqual({ logs: [], outs: ["duplicate", "new", "duplicate"], floor: 1, aside: ["seq-state.json"] });
  });

  it("g7: a new epoch starts again at floor 1", () => {
    const out = pySpool(`
st = rs.SeqState()
st.apply(ev(1)); st.apply(ev(1000000))
st.apply(ev(1, epoch="epochBBBB2222"))
print(json.dumps({"floor": st.sources["s"].get("floor", 1), "dup": st.apply(ev(1, epoch="epochBBBB2222"))}))
`);
    expect(out).toEqual({ floor: 1, dup: "duplicate" });
  });
});

describe("D177-H4 floor end to end", () => {
  const fx = useReceiver();

  it("g8: a seq dropped from missing by a capped jump is stored on retry, exactly once", async () => {
    await fx.sendSeqs("dtrack-mini", [2, 2 + CAP + 50]);
    const floor = 2 + CAP + 50 - CAP;
    expect(fx.gaps()?.["dtrack-mini"]).toMatchObject({ epoch: EPOCH_A, max: 2 + CAP + 50, floor });
    expect((await fx.post(spooled(1))).status).toBe(200);
    expect(fx.events().map((r) => r.spool_seq)).toEqual([2, 2 + CAP + 50, 1]);
    expect(fx.gaps()?.["dtrack-mini"].missing).not.toContain(1);
  });
});
