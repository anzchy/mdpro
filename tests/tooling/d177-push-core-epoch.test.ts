// @vitest-environment node
/**
 * D177-WI-2: pushCore's epoch, spool_dead and busy-seq-lock behaviour.
 *
 * - The `seq` file is JSON `{ epoch, seq }`. The epoch ([A-Za-z0-9_-]{8,64},
 *   random) is made when the file is first created and kept beside the seq;
 *   a wiped state dir gives a new epoch and seq 1. Every spool entry carries
 *   it as `spool_epoch`.
 * - `spool_dead` is added at send time, not stored in the spool: the number
 *   of dead.jsonl lines (reason "status" or "cap") whose `entry.spool_epoch`
 *   is the epoch of the entry being sent.
 * - If the seq lock is held by a live owner for longer than `lockWaitMs`
 *   (default `SEQ_LOCK_WAIT_MS` = 500), `enqueue` takes no seq: it appends
 *   the payload to orphan.jsonl (0600), logs "seq lock busy" and returns
 *   `{ seq: null, orphaned: true, dropped: 0 }`.
 *
 * Boundaries: as d177-push-core.test.ts (temp dir, injected clock, pid probe
 * and poster).
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EPOCH_RE, hook, useCore } from "../support/d177CoreFixture";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { SEQ_LOCK_WAIT_MS, enqueue, flush, nextSeq } from "../../scripts/device/hooks/pushCore.mjs";

const fx = useCore();

function wipeState() {
  for (const name of fs.readdirSync(fx.dir)) {
    if (name !== "push.json" && name !== "token") fs.rmSync(fx.path(name), { recursive: true, force: true });
  }
}

function deadLine(epoch: string, seq: number, reason = "status") {
  const entry = { spool_source: "dtrack-mini", spool_epoch: epoch, spool_seq: seq, spool_ts: "t" };
  return JSON.stringify(reason === "cap" ? { reason, entry } : { reason, status: 404, entry }) + "\n";
}

describe("D177-WI-2 pushCore epochs", () => {
  it("c1: wiping the state dir gives a new epoch and seq restarts at 1", () => {
    fx.enqueueMany(2);
    const first = fx.seqFile();
    expect(first.seq).toBe(2);
    expect(first.epoch).toMatch(EPOCH_RE);
    expect(fx.spool().map((e) => e.spool_epoch)).toEqual([first.epoch, first.epoch]);
    wipeState();
    const r = enqueue(fx.ctx(), hook(3));
    expect(r.seq).toBe(1);
    const second = fx.seqFile();
    expect(second.seq).toBe(1);
    expect(second.epoch).toMatch(EPOCH_RE);
    expect(second.epoch).not.toBe(first.epoch);
    expect(fx.spool()[0].spool_epoch).toBe(second.epoch);
  });

  it("c2: every POST carries the entry's epoch", async () => {
    fx.enqueueMany(2);
    const { epoch } = fx.seqFile();
    await flush(fx.ctx());
    expect(fx.sent.map((s) => [s.body.spool_epoch, s.body.spool_seq])).toEqual([
      [epoch, 1],
      [epoch, 2],
    ]);
  });
});

describe("D177-WI-2 pushCore spool_dead", () => {
  it("k1: spool_dead is 0 with no dead letters and is not stored in the spool", async () => {
    fx.enqueueMany(1);
    expect(Object.keys(fx.spool()[0])).not.toContain("spool_dead");
    await flush(fx.ctx());
    expect(fx.sent[0].body.spool_dead).toBe(0);
  });

  it("k2: each dead-lettered entry raises spool_dead for the next POSTs", async () => {
    fx.enqueueMany(4);
    fx.replies.push({ status: 404 }, { status: 200 }, { status: 422 }, { status: 200 });
    await flush(fx.ctx());
    expect(fx.sent.map((s) => [s.body.spool_seq, s.body.spool_dead])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
  });

  it("k3: the count is persisted across flushes and only counts this epoch's dead letters, cap included", async () => {
    fx.enqueueMany(1);
    const { epoch } = fx.seqFile();
    fs.writeFileSync(
      fx.path("dead.jsonl"),
      deadLine("oldEpoch0001", 7) + deadLine("oldEpoch0001", 8, "cap") + deadLine(epoch, 90) + deadLine(epoch, 91, "cap"),
    );
    fx.replies.push({ status: 503 });
    await flush(fx.ctx());
    await flush(fx.ctx());
    expect(fx.sent.map((s) => s.body.spool_dead)).toEqual([2, 2]);
  });
});

describe("D177-WI-2 pushCore busy seq lock", () => {
  it("l1: the default wait is 500 ms", () => {
    expect(SEQ_LOCK_WAIT_MS).toBe(500);
  });

  it("l2: a seq lock held by a live owner past the wait orphans the payload without a seq", () => {
    fx.enqueueMany(1);
    const before = fx.seqFile();
    fs.mkdirSync(fx.path("seq.lock"));
    fs.writeFileSync(fx.path("seq.lock/owner"), "555");
    const live = fx.ctx({ isAlive: (p: number) => p === 555, lockWaitMs: 50 });
    const t0 = Date.now();
    const r = enqueue(live, hook(9));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toEqual({ seq: null, orphaned: true, dropped: 0 });
    expect(fx.orphans()).toEqual([expect.objectContaining(hook(9))]);
    expect(Object.keys(fx.orphans()[0])).not.toContain("spool_seq");
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(fx.path("orphan.jsonl")), "fx.path('orphan.jsonl') exists").toBe(true);
    expect(fs.statSync(fx.path("orphan.jsonl")).mode & 0o777).toBe(0o600);
    expect(fx.pushLog()).toMatch(/seq lock busy/);
    expect(fx.spool()).toHaveLength(1);
    expect(fx.seqFile()).toEqual(before);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(fx.path("seq.lock/owner")), "fx.path('seq.lock/owner') exists").toBe(true);
    expect(fs.readFileSync(fx.path("seq.lock/owner"), "utf8")).toBe("555");
  });

  it("l3: nextSeq on a live-held lock does not hand out a seq", () => {
    fs.mkdirSync(fx.path("seq.lock"));
    fs.writeFileSync(fx.path("seq.lock/owner"), "555");
    const live = fx.ctx({ isAlive: (p: number) => p === 555, lockWaitMs: 50 });
    expect(() => nextSeq(live)).toThrow(/seq lock busy/);
  });
});
