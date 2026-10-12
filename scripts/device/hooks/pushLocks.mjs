/**
 * Purpose: The three cross-process locks of the dtrack hook push pipeline
 * (D177-WI-2): `spool.lock`, `seq.lock` and `flush.lock` in the hook dir.
 *
 * Pipeline: `acquireLock(ctx, path, deadline)` → mkdir (atomic) → write
 *   `owner` = our pid → held | EEXIST → owner dead (`isAlive` false) →
 *   reclaim (rename aside, re-check, remove) and retry | owner alive or not
 *   yet written, or a reclaim that failed → poll every `LOCK_POLL_MS` until
 *   `deadline` → not held.
 *   `releaseLock` removes the dir only while its owner is still us.
 *
 * Key decisions:
 * - Synchronous throughout (`Atomics.wait` sleeps), so a hook's fast path is
 *   one straight-line run with a hard deadline.
 * - Liveness is by pid only (`kill -0`; EPERM counts as alive). A lock dir
 *   whose owner file is still missing after `OWNERLESS_STALE_MS` is a crash
 *   between mkdir and write, and is reclaimed too.
 * - A reclaim renames the stale dir to a unique name first, so two
 *   reclaimers cannot both delete it; if the renamed dir turns out to hold a
 *   different owner than the one judged dead, it is put back.
 * - A failed reclaim (the rename throws, or the dir aside held another owner)
 *   is treated like a live holder: it uses up the deadline and sleeps
 *   `LOCK_POLL_MS`, so a stale lock that cannot be removed never spins the
 *   CPU (D177-H-1, audit b92 finding 1). Only a reclaim that removed the dir
 *   retries at once.
 *
 * @module scripts/device/hooks/pushLocks
 * @coordinates-with scripts/device/hooks/pushCore.mjs (lock order spool → seq; flush alone)
 */
import crypto from "node:crypto";

export const LOCK_POLL_MS = 10;
export const OWNERLESS_STALE_MS = 2000;

const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
export const sleepSync = (ms) => Atomics.wait(SLEEPER, 0, 0, Math.max(0, ms));

/** Default liveness probe: `kill(pid, 0)`; EPERM means alive but not ours. */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

function readOwner(fs, lockPath) {
  try {
    const n = Number(fs.readFileSync(`${lockPath}/owner`, "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** True when the lock dir's holder is gone (dead pid, or never wrote an owner). */
function isStale(ctx, lockPath, owner) {
  if (owner !== null) return !ctx.isAlive(owner);
  try {
    return Date.now() - ctx.fs.statSync(lockPath).mtimeMs > OWNERLESS_STALE_MS;
  } catch {
    return false;
  }
}

/** True only when the stale dir was moved aside and removed. */
function reclaim(ctx, lockPath, owner) {
  const { fs } = ctx;
  const aside = `${lockPath}.stale-${ctx.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return false; // released or reclaimed by someone else, or the rename itself fails
  }
  if (readOwner(fs, aside) !== owner) {
    try {
      fs.renameSync(aside, lockPath); // a live lock slipped in; give it back
    } catch {
      /* the name is taken again; the slipped-in holder lost its dir, nothing safer to do */
    }
    return false;
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return true;
}

/** Tries until `deadline` (ms epoch) to take the lock; true when held. */
export function acquireLock(ctx, lockPath, deadline) {
  const { fs } = ctx;
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(`${lockPath}/owner`, String(ctx.pid), { mode: 0o600 });
      return true;
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
    }
    const owner = readOwner(fs, lockPath);
    if (isStale(ctx, lockPath, owner) && reclaim(ctx, lockPath, owner)) continue;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    sleepSync(Math.min(LOCK_POLL_MS, left));
  }
}

/** Removes the lock dir, but only while we still own it. */
export function releaseLock(ctx, lockPath) {
  if (readOwner(ctx.fs, lockPath) === ctx.pid) ctx.fs.rmSync(lockPath, { recursive: true, force: true });
}
