// @vitest-environment node
/**
 * D177-WI-4: every spooled POST carries `spool_orphans`.
 *
 * `spool_orphans` is the number of non-empty lines in the sender's
 * orphan.jsonl, read at send time (like `spool_dead`) and never stored in the
 * spool; no orphan.jsonl means 0. Orphans have no seq or epoch, so the count
 * is not per epoch: it is the whole file.
 *
 * Boundaries: real fs in a temp dir; clock, pid probe and poster injected
 * (tests/support/d177CoreFixture.ts).
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { useCore } from "./support/d177CoreFixture";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { enqueue, flush } from "../scripts/device/hooks/pushCore.mjs";

const fx = useCore();
const orphanLine = (n: number) => JSON.stringify({ hook_event_name: "Stop", n, orphan_reason: "seq lock busy" }) + "\n";

describe("D177-WI-4 push spool_orphans", () => {
  it("w1: with no orphan.jsonl every POST carries spool_orphans 0", async () => {
    fx.enqueueMany(2);
    await flush(fx.ctx());
    expect(fx.sent.map((s) => s.body.spool_orphans)).toEqual([0, 0]);
  });

  it("w2: the count is the number of orphan.jsonl lines, and is not stored in the spool", async () => {
    fx.enqueueMany(2);
    fs.writeFileSync(fx.path("orphan.jsonl"), orphanLine(1) + orphanLine(2) + orphanLine(3), { mode: 0o600 });
    expect(Object.keys(fx.spool()[0])).not.toContain("spool_orphans");
    await flush(fx.ctx());
    expect(fx.sent.map((s) => s.body.spool_orphans)).toEqual([3, 3]);
  });

  it("w3: blank lines do not count", async () => {
    fx.enqueueMany(1);
    fs.writeFileSync(fx.path("orphan.jsonl"), orphanLine(1) + "\n\n" + orphanLine(2) + "\n", { mode: 0o600 });
    await flush(fx.ctx());
    expect(fx.sent[0].body.spool_orphans).toBe(2);
  });

  it("w4: an orphan written by a busy lock is counted by the next POST", async () => {
    fx.enqueueMany(2);
    fs.mkdirSync(fx.path("seq.lock"));
    fs.writeFileSync(fx.path("seq.lock/owner"), "555");
    const busy = fx.ctx({ isAlive: (p: number) => p === 555, lockWaitMs: 20 });
    expect(enqueue(busy, { hook_event_name: "Stop", n: 99 }).orphaned).toBe(true);
    await flush(fx.ctx());
    expect(fx.sent.map((s) => s.body.spool_orphans)).toEqual([1, 1]);
  });

  it("w5: the count is read per request, so an orphan added mid-flush shows on the next one", async () => {
    fx.enqueueMany(2);
    let first = true;
    const post = async (req: { body: string }) => {
      fx.sent.push({ url: "", token: "", body: JSON.parse(req.body) });
      if (first) fs.appendFileSync(fx.path("orphan.jsonl"), orphanLine(1), { mode: 0o600 });
      first = false;
      return { status: 200 };
    };
    await flush(fx.ctx({ post }));
    expect(fx.sent.map((s) => s.body.spool_orphans)).toEqual([0, 1]);
  });
});
