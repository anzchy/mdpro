// @vitest-environment node
/**
 * D177-WI-2: pushCore's spool lock and corrupt-seq recovery.
 *
 * - One `spool.lock` guards every read-modify-write of spool.jsonl: the
 *   enqueue append and cap trim, and flush's removal of a sent or dead entry.
 *   Flush holds it only around each rewrite, never across a request, so a
 *   hook appending during a slow flush neither waits for the POST nor loses
 *   or duplicates an entry.
 * - Lock order is spool.lock, then seq.lock. A spool.lock held by a live
 *   owner past `lockWaitMs` sends the payload to orphan.jsonl ("seq lock
 *   busy" path's twin, logged "spool lock busy") and consumes no seq, so it
 *   leaves no gap at the receiver.
 * - A corrupt `seq` file (not JSON, not an object, missing fields, a bad
 *   epoch, a seq that is not an integer ≥ 0) is renamed to
 *   `seq.corrupt-<timestamp>`, logged "seq state corrupt", and a new epoch
 *   starts at seq 1; the event is spooled normally.
 *
 * Boundaries: real fs in a temp dir; clock, pid probe and poster injected.
 * Flusher and hook use different pids, as the real processes do.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EPOCH_RE, hook, seqsOf, useCore } from "./support/d177CoreFixture";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { enqueue, flush, nextSeq } from "../scripts/device/hooks/pushCore.mjs";

const fx = useCore();
const FLUSHER = 1001;
const HOOK = 1002;
const alive = (p: number) => p === FLUSHER || p === HOOK;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("D177-WI-2 pushCore spool lock", () => {
  it("q1: hooks appending during a slow flush lose and duplicate nothing, and never wait for a POST", async () => {
    for (let i = 1; i <= 5; i++) enqueue(fx.ctx({ pid: HOOK, isAlive: alive }), hook(i));
    const posted: number[] = [];
    const slowPost = async (req: { body: string }) => {
      await sleep(200);
      posted.push(JSON.parse(req.body).spool_seq as number);
      return { status: 200 };
    };
    const running = flush(fx.ctx({ pid: FLUSHER, isAlive: alive, post: slowPost }));
    const enqueueMs: number[] = [];
    for (let i = 6; i <= 10; i++) {
      await sleep(90);
      const t0 = Date.now();
      const r = enqueue(fx.ctx({ pid: HOOK, isAlive: alive }), hook(i));
      enqueueMs.push(Date.now() - t0);
      expect(r.seq).toBe(i);
    }
    await running;
    expect(Math.max(...enqueueMs)).toBeLessThan(300);
    const left = seqsOf(fx.spool()) as number[];
    expect(new Set(posted).size).toBe(posted.length);
    expect(posted.filter((s) => left.includes(s))).toEqual([]);
    expect([...posted, ...left].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(posted.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(fx.orphans()).toEqual([]);
    expect(fx.dead()).toEqual([]);
    expect(fs.existsSync(fx.path("spool.lock"))).toBe(false);
  }, 10_000);

  it("q2: a spool lock held by a live owner past the wait orphans the payload and consumes no seq", () => {
    fx.enqueueMany(1);
    const before = fx.seqFile();
    fs.mkdirSync(fx.path("spool.lock"));
    fs.writeFileSync(fx.path("spool.lock/owner"), "555");
    const r = enqueue(fx.ctx({ isAlive: (p: number) => p === 555, lockWaitMs: 50 }), hook(2));
    expect(r).toEqual({ seq: null, orphaned: true, dropped: 0 });
    expect(fx.orphans()).toEqual([expect.objectContaining(hook(2))]);
    expect(fx.pushLog()).toMatch(/spool lock busy/);
    expect(fx.seqFile()).toEqual(before);
    expect(seqsOf(fx.spool())).toEqual([1]);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(fx.path("spool.lock/owner")), "fx.path('spool.lock/owner') exists").toBe(true);
    expect(fs.readFileSync(fx.path("spool.lock/owner"), "utf8")).toBe("555");
  });

  it("q3: a spool lock left by a dead owner is reclaimed", () => {
    fs.mkdirSync(fx.path("spool.lock"));
    fs.writeFileSync(fx.path("spool.lock/owner"), "99999");
    expect(enqueue(fx.ctx(), hook(1)).seq).toBe(1);
    expect(fs.existsSync(fx.path("spool.lock"))).toBe(false);
  });
});

const OLD_EPOCH = "goodEpoch01";
const corrupt: [string, string][] = [
  ["not JSON", "{garbage"],
  ["a bare number", "5"],
  ["an empty object", "{}"],
  ["epoch missing", JSON.stringify({ seq: 3 })],
  ["seq missing", JSON.stringify({ epoch: OLD_EPOCH })],
  ["epoch too short", JSON.stringify({ epoch: "short", seq: 3 })],
  ["epoch with a dot", JSON.stringify({ epoch: "bad.epoch.01", seq: 3 })],
  ["seq negative", JSON.stringify({ epoch: OLD_EPOCH, seq: -1 })],
  ["seq non-integer", JSON.stringify({ epoch: OLD_EPOCH, seq: 1.5 })],
  ["seq a string", JSON.stringify({ epoch: OLD_EPOCH, seq: "3" })],
];

describe("D177-WI-2 pushCore corrupt seq file", () => {
  it.each(corrupt)("k%#: %s → renamed aside, logged, new epoch at seq 1, event spooled", (_n, content) => {
    fs.writeFileSync(fx.path("seq"), content);
    const r = enqueue(fx.ctx(), hook(1));
    expect(r.seq).toBe(1);
    const now = fx.seqFile();
    expect(now.seq).toBe(1);
    expect(now.epoch).toMatch(EPOCH_RE);
    expect(now.epoch).not.toBe(OLD_EPOCH);
    expect(fx.spool()).toEqual([expect.objectContaining({ spool_epoch: now.epoch, spool_seq: 1, n: 1 })]);
    const aside = fs.readdirSync(fx.dir).filter((n) => n.startsWith("seq.corrupt-"));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(fx.path(aside[0]), "utf8")).toBe(content);
    expect(fx.pushLog()).toMatch(/seq state corrupt/);
  });

  it("a seq of 0 with a valid epoch is not corrupt: the next seq is 1 in that epoch", () => {
    fs.writeFileSync(fx.path("seq"), JSON.stringify({ epoch: OLD_EPOCH, seq: 0 }));
    expect(nextSeq(fx.ctx())).toEqual({ epoch: OLD_EPOCH, seq: 1 });
    expect(fs.readdirSync(fx.dir).filter((n) => n.startsWith("seq.corrupt-"))).toEqual([]);
    expect(fx.pushLog()).not.toMatch(/seq state corrupt/);
  });
});
