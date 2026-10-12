// @vitest-environment node
/**
 * D177-WI-1: the receiver keys dedupe and gaps on (source, epoch), and keeps
 * the sender's dead-letter count.
 *
 * A source arriving with an epoch it has never sent restarts that source's
 * tracking: gaps.json holds only the current epoch per source. An epoch the
 * source has already left (retired, remembered in seq-state.json) is stale:
 * 200, not appended, logged. `dead` in gaps.json is the highest `spool_dead`
 * seen in the current epoch, duplicates included; a stale or unauthorised
 * body never moves it.
 *
 * seq-state.json keeps, per source, `retired`: the epochs the source has
 * left, oldest first, at most 64 (`MAX_RETIRED_EPOCHS`). Past that the oldest
 * is dropped, and a replay from a dropped epoch then looks like a new epoch:
 * an accepted limit, documented in receiver.py, not tested.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeToken } from "./support/d177Hooks";
import { EPOCH_A, EPOCH_B, spooled, useReceiver } from "./support/d177ReceiverFixture";

const fx = useReceiver();
const inB = { spool_epoch: EPOCH_B };

describe("D177-WI-1 receiver epochs", () => {
  it("e1: after epoch A seqs 1..3, epoch B seq 1 is accepted, not deduped", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 2, 3]);
    expect((await fx.post(spooled(1, "dtrack-mini", inB))).status).toBe(200);
    const recs = fx.events();
    expect(recs).toHaveLength(4);
    expect([recs[3].spool_epoch, recs[3].spool_seq]).toEqual([EPOCH_B, 1]);
  });

  it("e2: B's gaps start empty, and A's are dropped from gaps.json", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 2, 5]);
    expect(fx.gaps()).toEqual({ "dtrack-mini": { epoch: EPOCH_A, max: 5, missing: [3, 4], dead: 0 } });
    await fx.sendSeqs("dtrack-mini", [1], inB);
    expect(fx.gaps()).toEqual({ "dtrack-mini": { epoch: EPOCH_B, max: 1, missing: [], dead: 0 } });
    await fx.sendSeqs("dtrack-mini", [3], inB);
    expect(fx.gaps()).toEqual({ "dtrack-mini": { epoch: EPOCH_B, max: 3, missing: [2], dead: 0 } });
  });

  it("e3: a replay of an epoch-A seq after B started is 200, not appended, and logged as stale", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 2]);
    await fx.sendSeqs("dtrack-mini", [1], inB);
    const before = fx.gaps();
    for (const seq of [2, 3]) {
      const res = await fx.post(spooled(seq, "dtrack-mini", { spool_dead: 9 }));
      expect(res.status).toBe(200);
    }
    expect(fx.events()).toHaveLength(3);
    expect(fx.gaps()).toEqual(before);
    expect(fx.log()).toMatch(/stale epoch/);
  });

  it("e4: a retired epoch stays stale across a restart", async () => {
    await fx.sendSeqs("dtrack-mini", [1]);
    await fx.sendSeqs("dtrack-mini", [1], inB);
    await fx.restart();
    expect((await fx.post(spooled(2))).status).toBe(200);
    expect(fx.events()).toHaveLength(2);
    expect(fx.gaps()?.["dtrack-mini"].epoch).toBe(EPOCH_B);
  });

  it("e5: epochs are per source — B for one source leaves another source on A", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 3]);
    await fx.sendSeqs("other.src", [1, 2]);
    await fx.sendSeqs("dtrack-mini", [1], inB);
    await fx.sendSeqs("other.src", [3]);
    expect(fx.gaps()).toEqual({
      "dtrack-mini": { epoch: EPOCH_B, max: 1, missing: [], dead: 0 },
      "other.src": { epoch: EPOCH_A, max: 3, missing: [], dead: 0 },
    });
  });

  it("d1: dead is the highest spool_dead seen in the epoch, duplicates included", async () => {
    await fx.sendSeqs("dtrack-mini", [1], { spool_dead: 0 });
    await fx.sendSeqs("dtrack-mini", [2], { spool_dead: 3 });
    await fx.sendSeqs("dtrack-mini", [3], { spool_dead: 1 });
    expect(fx.gaps()?.["dtrack-mini"].dead).toBe(3);
    expect((await fx.post(spooled(2, "dtrack-mini", { spool_dead: 5 }))).status).toBe(200);
    expect(fx.events()).toHaveLength(3);
    expect(fx.gaps()?.["dtrack-mini"].dead).toBe(5);
  });

  it("d2: a new epoch restarts dead at its own count; a stale or unauthorised body never moves it", async () => {
    await fx.sendSeqs("dtrack-mini", [1], { spool_dead: 4 });
    await fx.sendSeqs("dtrack-mini", [1], { ...inB, spool_dead: 1 });
    expect(fx.gaps()?.["dtrack-mini"]).toEqual({ epoch: EPOCH_B, max: 1, missing: [], dead: 1 });
    expect((await fx.post(spooled(2, "dtrack-mini", { spool_dead: 50 }))).status).toBe(200);
    expect((await fx.post(spooled(2, "dtrack-mini", { ...inB, spool_dead: 60 }), fakeToken())).status).toBe(401);
    expect(fx.gaps()?.["dtrack-mini"].dead).toBe(1);
  });

  it("d3: dead survives a restart", async () => {
    await fx.sendSeqs("dtrack-mini", [1], { spool_dead: 2 });
    await fx.restart();
    await fx.sendSeqs("dtrack-mini", [2], { spool_dead: 0 });
    expect(fx.gaps()?.["dtrack-mini"]).toEqual({ epoch: EPOCH_A, max: 2, missing: [], dead: 2 });
  });

  it("r9: at most 64 retired epochs are kept per source, oldest dropped first", async () => {
    const epochs = Array.from({ length: 67 }, (_, i) => `epoch-${String(i).padStart(4, "0")}`);
    for (const e of epochs) await fx.sendSeqs("dtrack-mini", [1], { spool_epoch: e });
    // Assert existence first: a raw read of a missing file fails with ENOENT text,
    // which the receipt CLI misreads as a missing runner.
    const statePath = fx.file("seq-state.json");
    expect(fs.existsSync(statePath), "seq-state.json written").toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const retired = state["dtrack-mini"].retired as string[];
    expect(retired).toEqual(epochs.slice(2, 66));
    expect(retired).toHaveLength(64);
    expect(fx.gaps()?.["dtrack-mini"].epoch).toBe(epochs[66]);
    expect((await fx.post(spooled(2, "dtrack-mini", { spool_epoch: epochs[2] }))).status).toBe(200);
    expect(fx.events()).toHaveLength(67);
    expect(fx.gaps()?.["dtrack-mini"].epoch).toBe(epochs[66]);
  }, 15_000);
});
