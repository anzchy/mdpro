// @vitest-environment node
/**
 * D177 hardening H-1 (audit b92): a stale lock that cannot be reclaimed must
 * not spin, and a flush must not run forever.
 *
 * - `acquireLock`: a failed reclaim (renameSync throws, or the renamed dir
 *   turns out to hold another owner and is put back) counts against the
 *   deadline and sleeps `LOCK_POLL_MS` like a live holder; once the deadline
 *   passes it returns false. So renameSync is called about
 *   deadline / LOCK_POLL_MS times, not thousands.
 * - `flush`: an overall wall-clock cap (`FLUSH_MAX_MS` = 60 s, `ctx.flushMaxMs`
 *   in tests) after which it stops with `{ seq, reason: "deadline" }`, keeps
 *   every unsent entry, logs it and releases flush.lock, even while a request
 *   is still in flight.
 *
 * The injected fs gives up failing after `SPIN_GUARD` renames, so the
 * unfixed spin ends in an assertion failure instead of hanging the worker.
 * Boundaries: real fs in a temp dir behind that wrapper; pid probe and
 * poster injected.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTemp, rmTemp } from "./support/d177Hooks";
import { seqsOf, useCore } from "./support/d177CoreFixture";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { LOCK_POLL_MS, acquireLock } from "../scripts/device/hooks/pushLocks.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { FLUSH_MAX_MS, flush } from "../scripts/device/hooks/pushCore.mjs";

const SPIN_GUARD = 1000;
const DEADLINE_MS = 100;
const SLACK_MS = 300;
const STALE_OWNER = "99999";
const SELF = 4242;

describe("D177-H1 acquireLock on a stale lock it cannot reclaim", () => {
  let dir: string;
  let lock: string;
  beforeEach(() => {
    dir = makeTemp("h1");
    lock = path.join(dir, "seq.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner"), STALE_OWNER);
  });
  afterEach(() => rmTemp(dir));

  const maxRenames = Math.ceil(DEADLINE_MS / LOCK_POLL_MS) + 2;
  const ctxWith = (overrides: Record<string, unknown>) => ({
    fs: Object.assign(Object.create(fs), overrides),
    pid: SELF,
    isAlive: (p: number) => p === SELF,
  });

  it("h1a: renameSync always throwing EBUSY → false by the deadline, with a bounded number of attempts", () => {
    let renames = 0;
    const ctx = ctxWith({
      renameSync: (from: string, to: string) => {
        renames++;
        if (renames > SPIN_GUARD) return fs.renameSync(from, to);
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      },
    });
    const t0 = Date.now();
    const held = acquireLock(ctx, lock, t0 + DEADLINE_MS);
    const elapsed = Date.now() - t0;
    expect(renames).toBeLessThanOrEqual(maxRenames);
    expect(held).toBe(false);
    expect(elapsed).toBeLessThan(DEADLINE_MS + SLACK_MS);
    expect(fs.readFileSync(path.join(lock, "owner"), "utf8")).toBe(STALE_OWNER);
  });

  it("h1b: a reclaim that keeps finding another owner aside (and puts it back) also stops at the deadline", () => {
    let renames = 0;
    const ctx = ctxWith({
      renameSync: (from: string, to: string) => {
        renames++;
        return fs.renameSync(from, to);
      },
      readFileSync: (file: string, enc: BufferEncoding) =>
        renames <= SPIN_GUARD && String(file).includes(".stale-") ? "88888" : fs.readFileSync(file, enc),
    });
    const t0 = Date.now();
    const held = acquireLock(ctx, lock, t0 + DEADLINE_MS);
    const elapsed = Date.now() - t0;
    expect(renames).toBeLessThanOrEqual(2 * maxRenames);
    expect(held).toBe(false);
    expect(elapsed).toBeLessThan(DEADLINE_MS + SLACK_MS);
    expect(fs.existsSync(path.join(lock, "owner")), "the stale lock is put back").toBe(true);
  });

  it("h1c: control — a reclaim that works still takes the lock at once", () => {
    const ctx = ctxWith({});
    expect(acquireLock(ctx, lock, Date.now() + DEADLINE_MS)).toBe(true);
    expect(fs.readFileSync(path.join(lock, "owner"), "utf8")).toBe(String(SELF));
  });
});

describe("D177-H1 flush wall-clock cap", () => {
  const fx = useCore();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const STILL_RUNNING = "still running";

  it("h1d: the cap is 60 s", () => {
    expect(FLUSH_MAX_MS).toBe(60_000);
  });

  it("h1e: a post that never resolves is abandoned at the cap; every entry is kept and the lock released", async () => {
    fx.enqueueMany(3);
    const never = () => new Promise(() => undefined);
    const out = await Promise.race([flush(fx.ctx({ flushMaxMs: 200, post: never })), sleep(2000).then(() => STILL_RUNNING)]);
    expect(out).not.toBe(STILL_RUNNING);
    expect((out as { stopped: unknown }).stopped).toEqual({ seq: 1, reason: "deadline" });
    expect(seqsOf(fx.spool())).toEqual([1, 2, 3]);
    expect(fx.pushLog()).toMatch(/deadline/);
    expect(fs.existsSync(fx.path("flush.lock"))).toBe(false);
  }, 10_000);

  it("h1f: slow but answering posts stop at the cap; sent and kept add up to every seq once", async () => {
    fx.enqueueMany(6);
    const posted: number[] = [];
    const slow = async (req: { body: string }) => {
      await sleep(100);
      posted.push(JSON.parse(req.body).spool_seq as number);
      return { status: 200 };
    };
    const out = await Promise.race([flush(fx.ctx({ flushMaxMs: 250, post: slow })), sleep(3000).then(() => STILL_RUNNING)]);
    expect(out).not.toBe(STILL_RUNNING);
    const res = out as { sent: number[]; stopped: { reason: string } | null };
    expect(res.stopped?.reason).toBe("deadline");
    expect(res.sent.length).toBeGreaterThanOrEqual(1);
    expect(res.sent.length).toBeLessThanOrEqual(4);
    const kept = seqsOf(fx.spool()) as number[];
    expect([...res.sent, ...kept].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  }, 10_000);
});
