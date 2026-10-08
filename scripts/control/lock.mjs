/**
 * Purpose: The launcher's one-run lock (ADR-0047 WI-003 WI-4):
 * `<runs parent>/.lock`, created atomically with `wx` at mode 0600, holding
 * `{ run, nonceDigest }`. At most one verify run holds it at a time.
 *
 * Pipeline: `acquireLock(parent, { run, nonce })` → `.lock`;
 *   `readLock(parent)` → absent | held(run) | corrupt;
 *   `releaseLock(parent, { run, nonce })` → "released" | "absent";
 *   `checkLockOwner(parent, { run, nonce })` → "held" | "absent" (no change);
 *   `releaseOrphanLock(parent, run)` → "released" | "absent".
 *
 * Key decisions:
 * - Acquire is the `wx` open itself, never exists-then-write (TOCTOU); a
 *   losing caller learns the holder's run name, never its nonce.
 * - The file stores `sha256(nonce)` as hex, never the plaintext nonce, so
 *   reading the lock reveals no credential.
 * - Release removes only a lock whose `run` and `nonceDigest` both match the
 *   caller; any mismatch throws and leaves the file byte-identical. Release
 *   of an absent lock is a no-op ("absent"), so `clean` stays idempotent.
 * - An unparsable lock is `corrupt`: acquire and release both refuse with
 *   `lock unreadable`. Nothing auto-takes or auto-cleans a lock (D2).
 * - `releaseOrphanLock` is for a lock whose run dir is already gone, so the
 *   nonce went with it: it re-reads the lock and matches on `run` only. Any
 *   other holder, or a corrupt lock, throws and the bytes stay.
 * - Callers release the lock only on launch failure cleanup, a
 *   confirmed-dead `quit`, or `clean` of the run it names (its orphan lock
 *   included, once `clean` has proved no verify binary may be running).
 *
 * @module scripts/control/lock
 * @coordinates-with scripts/control/runDir.mjs (layout().lock is this path)
 * @coordinates-with scripts/control/ownership.mjs (cleanVerdict lockNamesThisRun)
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOCK_NAME = ".lock";
const LOCK_MODE = 0o600;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const UNREADABLE = "lock unreadable";

const lockPath = (parent) => path.join(parent, LOCK_NAME);
const digest = (nonce) => createHash("sha256").update(String(nonce)).digest("hex");

/**
 * Read the lock as a fact.
 * @param {string} parent the runs parent
 * @returns {{ state: "absent" } | { state: "held", run: string } | { state: "corrupt" }}
 */
export function readLock(parent) {
  const rec = readRecord(parent);
  return rec.state === "held" ? { state: "held", run: rec.run } : rec;
}

/**
 * Take the lock for `run`, or throw naming the current holder.
 * @param {string} parent the runs parent (must exist)
 * @param {{ run: string, nonce: string }} owner
 * @returns {{ run: string }}
 */
export function acquireLock(parent, { run, nonce }) {
  const body = JSON.stringify({ run, nonceDigest: digest(nonce) });
  try {
    fs.writeFileSync(lockPath(parent), body, { flag: "wx", mode: LOCK_MODE });
  } catch (error) {
    if (!(error instanceof Error) || /** @type {any} */ (error).code !== "EEXIST") throw error;
    const held = readRecord(parent);
    throw new Error(held.state === "held" ? `lock held by run ${held.run}` : UNREADABLE);
  }
  return { run };
}

/**
 * Release the lock if, and only if, `{ run, nonce }` wrote it.
 * @param {string} parent the runs parent
 * @param {{ run: string, nonce: string }} owner
 * @returns {"released" | "absent"}
 */
export function releaseLock(parent, owner) {
  if (checkLockOwner(parent, owner) === "absent") return "absent";
  fs.unlinkSync(lockPath(parent));
  return "released";
}

/**
 * Would `releaseLock(parent, owner)` succeed? Throws exactly what it would
 * throw, and changes nothing, so a caller can check before an irreversible step.
 * @param {string} parent the runs parent
 * @param {{ run: string, nonce: string }} owner
 * @returns {"held" | "absent"}
 */
export function checkLockOwner(parent, { run, nonce }) {
  const held = readRecord(parent);
  if (held.state === "absent") return "absent";
  if (held.state === "corrupt") throw new Error(UNREADABLE);
  if (held.run !== run) throw new Error(`lock names run ${held.run}, not ${run}`);
  if (held.nonceDigest !== digest(nonce)) {
    throw new Error(`lock for run ${held.run} holds another nonce`);
  }
  return "held";
}

/**
 * Release the lock of a run whose run dir is gone, if, and only if, the lock
 * still names `run`. The caller must already have proved nothing is running.
 * @param {string} parent the runs parent
 * @param {string} run
 * @returns {"released" | "absent"}
 */
export function releaseOrphanLock(parent, run) {
  const held = readRecord(parent);
  if (held.state === "absent") return "absent";
  if (held.state === "corrupt") throw new Error(UNREADABLE);
  if (held.run !== run) throw new Error(`lock names run ${held.run}, not ${run}`);
  fs.unlinkSync(lockPath(parent));
  return "released";
}

/** @returns {{ state: "absent" } | { state: "corrupt" } | { state: "held", run: string, nonceDigest: string }} */
function readRecord(parent) {
  let text;
  try {
    text = fs.readFileSync(lockPath(parent), "utf8");
  } catch (error) {
    if (error instanceof Error && /** @type {any} */ (error).code === "ENOENT") {
      return { state: "absent" };
    }
    return { state: "corrupt" };
  }
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    return { state: "corrupt" };
  }
  const ok =
    rec !== null &&
    typeof rec === "object" &&
    typeof rec.run === "string" &&
    rec.run.length > 0 &&
    typeof rec.nonceDigest === "string" &&
    DIGEST_RE.test(rec.nonceDigest);
  return ok ? { state: "held", run: rec.run, nonceDigest: rec.nonceDigest } : { state: "corrupt" };
}
