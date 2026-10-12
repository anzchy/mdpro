// @vitest-environment node
/**
 * D177 hardening H-3 (audit b92): the receiver commits seq state only after
 * the event is on disk.
 *
 * If appending to events.jsonl raises, the reply is 5xx (the sender keeps the
 * entry and retries), seq-state.json / gaps.json and the in-memory dedupe state
 * are unchanged, and latest.json is not touched. A retry after the fault
 * clears is stored as new, exactly once.
 *
 * The fault: events.jsonl is made a directory, so the append raises
 * IsADirectoryError on macOS (no ENOENT text), without any test-only hook in
 * receiver.py. A reply that never comes (the unfixed handler dies mid-request)
 * is read as status -1, so it fails as an assertion.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EPOCH_A, spooled, useReceiver } from "./support/d177ReceiverFixture";

const fx = useReceiver();

async function statusOf(body: unknown): Promise<number> {
  try {
    return (await fx.post(body)).status;
  } catch {
    return -1;
  }
}

const breakEvents = () => fs.mkdirSync(fx.file("events.jsonl"));
const healEvents = () => fs.rmdirSync(fx.file("events.jsonl"));
const exists = (name: string) => fs.existsSync(fx.file(name));

describe("D177-H3 receiver write failure", () => {
  it("h3a: a failed append answers 5xx; the retry after the fault clears is stored exactly once", async () => {
    breakEvents();
    const failed = await statusOf(spooled(1));
    expect(failed).toBeGreaterThanOrEqual(500);
    expect(failed).toBeLessThan(600);
    expect(exists("latest.json"), "latest.json untouched").toBe(false);
    healEvents();
    expect(await statusOf(spooled(1))).toBe(200);
    const recs = fx.events();
    expect(recs.map((r) => r.spool_seq)).toEqual([1]);
    expect(fx.gaps()).toEqual({ "dtrack-mini": { epoch: EPOCH_A, max: 1, missing: [], dead: 0 } });
  });

  it("h3b: a failed append leaves the persisted state as it was", async () => {
    await fx.sendSeqs("dtrack-mini", [1]);
    expect(exists("seq-state.json"), "seq-state.json written").toBe(true);
    const stateBefore = fs.readFileSync(fx.file("seq-state.json"), "utf8");
    const gapsBefore = fs.readFileSync(fx.file("gaps.json"), "utf8");
    fs.renameSync(fx.file("events.jsonl"), fx.file("events.keep"));
    breakEvents();
    expect(await statusOf(spooled(2))).toBeGreaterThanOrEqual(500);
    expect(fs.readFileSync(fx.file("seq-state.json"), "utf8")).toBe(stateBefore);
    expect(fs.readFileSync(fx.file("gaps.json"), "utf8")).toBe(gapsBefore);
  });

  it("h3c: a seq that failed is still missing when a later one lands, and fills the gap on retry", async () => {
    breakEvents();
    expect(await statusOf(spooled(1))).toBeGreaterThanOrEqual(500);
    healEvents();
    expect(await statusOf(spooled(2))).toBe(200);
    expect(fx.gaps()?.["dtrack-mini"]).toEqual({ epoch: EPOCH_A, max: 2, missing: [1], dead: 0 });
    expect(await statusOf(spooled(1))).toBe(200);
    expect(fx.events().map((r) => r.spool_seq)).toEqual([2, 1]);
    expect(fx.gaps()?.["dtrack-mini"]).toEqual({ epoch: EPOCH_A, max: 2, missing: [], dead: 0 });
  });

  it("h3d: the receiver keeps serving after a failed append", async () => {
    breakEvents();
    await statusOf(spooled(1));
    healEvents();
    expect(await statusOf({ hook_event_name: "Stop", session_id: "legacy" })).toBe(200);
    expect(fx.events()).toHaveLength(1);
  });
});
