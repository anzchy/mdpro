// @vitest-environment node
/**
 * D177-WI-4: the receiver keeps the sender's orphan count.
 *
 * Wire: a spooled body may carry `spool_orphans`, an integer ≥ 0 (the number
 * of lines in the sender's orphan.jsonl). Absent is allowed and means 0, so a
 * WI-1..3 sender keeps working; present but invalid → 400, nothing stored.
 * When present it is stored in the event record like the other spool fields.
 *
 * gaps.json: `orphans` is the highest `spool_orphans` seen in the source's
 * current epoch, duplicates included, exactly like `dead`. The key is written
 * only while it is > 0, so a source whose sender never orphaned anything keeps
 * the WI-1..3 shape `{ epoch, max, missing, dead }` byte for byte.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import { describe, expect, it } from "vitest";
import { fakeToken } from "./support/d177Hooks";
import { EPOCH_A, EPOCH_B, spooled, useReceiver } from "./support/d177ReceiverFixture";

const fx = useReceiver();
const orph = (n: unknown, extra: Record<string, unknown> = {}) => ({ spool_orphans: n, ...extra });

describe("D177-WI-4 receiver spool_orphans", () => {
  it("o1: spool_orphans is stored in the record and as orphans in gaps.json", async () => {
    await fx.sendSeqs("dtrack-mini", [1], orph(3));
    const [rec] = fx.events();
    expect(rec.spool_orphans).toBe(3);
    expect(fx.gaps()).toEqual({ "dtrack-mini": { epoch: EPOCH_A, max: 1, missing: [], dead: 0, orphans: 3 } });
  });

  it("o2: orphans is the highest value seen in the epoch, duplicates included", async () => {
    await fx.sendSeqs("dtrack-mini", [1], orph(2));
    await fx.sendSeqs("dtrack-mini", [2], orph(1));
    expect(fx.gaps()?.["dtrack-mini"].orphans).toBe(2);
    expect((await fx.post(spooled(1, "dtrack-mini", orph(6)))).status).toBe(200);
    expect(fx.events()).toHaveLength(2);
    expect(fx.gaps()?.["dtrack-mini"].orphans).toBe(6);
  });

  it("o3: a body without spool_orphans is accepted and leaves the WI-1..3 gaps shape", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 3]);
    expect(Object.keys(fx.events()[0])).not.toContain("spool_orphans");
    expect(fx.gaps()).toEqual({ "dtrack-mini": { epoch: EPOCH_A, max: 3, missing: [2], dead: 0 } });
  });

  it("o4: spool_orphans 0 keeps the key out of gaps.json; a later absent value does not lower a count", async () => {
    await fx.sendSeqs("dtrack-mini", [1], orph(0));
    expect(Object.keys(fx.gaps()?.["dtrack-mini"] ?? {})).not.toContain("orphans");
    await fx.sendSeqs("dtrack-mini", [2], orph(4));
    await fx.sendSeqs("dtrack-mini", [3]);
    expect(fx.gaps()?.["dtrack-mini"].orphans).toBe(4);
  });

  it.each([
    ["negative", -1],
    ["non-integer", 1.5],
    ["a string", "2"],
    ["a bool", true],
    ["null", null],
  ])("o5: spool_orphans %s → 400, nothing appended", async (_n, value) => {
    const res = await fx.post(spooled(1, "dtrack-mini", orph(value)));
    expect(res.status).toBe(400);
    expect(fx.events()).toHaveLength(0);
  });

  it("o6: a new epoch restarts orphans; a stale epoch or a 401 never moves it", async () => {
    await fx.sendSeqs("dtrack-mini", [1], orph(5));
    await fx.sendSeqs("dtrack-mini", [1], { spool_epoch: EPOCH_B, ...orph(1) });
    expect(fx.gaps()?.["dtrack-mini"]).toEqual({ epoch: EPOCH_B, max: 1, missing: [], dead: 0, orphans: 1 });
    expect((await fx.post(spooled(2, "dtrack-mini", orph(40)))).status).toBe(200);
    expect((await fx.post(spooled(2, "dtrack-mini", { spool_epoch: EPOCH_B, ...orph(50) }), fakeToken())).status).toBe(401);
    expect(fx.gaps()?.["dtrack-mini"].orphans).toBe(1);
  });

  it("o7: orphans survives a restart", async () => {
    await fx.sendSeqs("dtrack-mini", [1], orph(2));
    await fx.restart();
    await fx.sendSeqs("dtrack-mini", [2], orph(0));
    expect(fx.gaps()?.["dtrack-mini"]).toEqual({ epoch: EPOCH_A, max: 2, missing: [], dead: 0, orphans: 2 });
  });
});
