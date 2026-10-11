/**
 * Purpose: The launcher's one-run lock (ADR-0047 WI-003 WI-4):
 * `<runs parent>/.lock`, created atomically with `wx` at mode 0600, holding
 * `{ run, nonceDigest }`. At most one verify run holds it at a time.
 *
 * Pipeline: `acquireLock(parent, { run, nonce }, { mutexWaitMs })` → `.lock`;
 *   `readLock(parent)` → absent | held(run) | corrupt;
 *   `releaseLock(parent, { run, nonce }, { mutexWaitMs })` → "released" |
 *   "absent" | `released; tomb kept: <tomb>`;
 *   `checkLockOwner(parent, { run, nonce })` → "held" | "absent" (no change);
 *   `releaseOrphanLock(parent, run, { mutexWaitMs })` → as `releaseLock`.
 *   Acquire and both releases run inside `withLockMutex` (`.lock.mutex`,
 *   lockMutex.mjs; `mutexWaitMs` bounds the wait, default `MUTEX_WAIT_MS`).
 *   Acquire: any tomb → `lock interrupted: …` → `wx` create.
 *   Both releases: pre-check `.lock` → rename it to a tomb → check the tomb's
 *   bytes → unlink the tomb (ours) | `linkSync` it back, unlink the tomb, throw
 *   (both unlinks best-effort). Tomb helpers live in lockTomb.mjs.
 *
 * Key decisions:
 * - Acquire and release are serialised by one outside mutex (D105-WI-2,
 *   lockMutex.mjs). The tomb protocol alone let an acquire land between a
 *   release's rename and its restore: the restore then hit EEXIST and two
 *   runs believed they held the lock (D105 ①). Now no in-protocol acquire or
 *   release can run inside another's section; a busy mutex throws
 *   `lock busy: …` before anything is read or moved. `readLock` and
 *   `checkLockOwner` stay unlocked reads. The tomb protocol is kept as the
 *   guard against writers that ignore the mutex (scripts from an older
 *   checkout sharing the runs parent).
 * - Acquire is the `wx` open itself, never exists-then-write (TOCTOU); a
 *   losing caller learns the holder's run name, never its nonce.
 * - Any tomb refuses acquire, checked first under the mutex, before the held
 *   check (D105-WI-3): `lock interrupted: kept <tomb> (run <run>|unreadable)`.
 *   A tomb is a release that did not finish: a crash between the rename and
 *   the restore leaves the record there and `.lock` absent, which used to let
 *   the next launch take the lock silently. Nothing is auto-restored (D2); a
 *   human removes the tomb. The cost: a leftover tomb blocks every launch.
 * - The file stores `sha256(nonce)` as hex, never the plaintext nonce, so
 *   reading the lock reveals no credential.
 * - Release removes only a lock whose `run` and `nonceDigest` both match the
 *   caller; any mismatch throws and leaves the file byte-identical. Release
 *   of an absent lock is a no-op ("absent"), so `clean` stays idempotent.
 * - Release is atomic (D82-WI-1, the tomb protocol). A check followed by a
 *   separate `unlinkSync` let two removers both pass the check and the second
 *   delete a lock a third run took in between. Now the lock is first moved
 *   aside with `renameSync(.lock → .lock.<pid>-<random hex>.tomb)`, which only
 *   one remover can win, and ownership is judged on the tomb's bytes. Ours:
 *   the tomb is unlinked. Not ours (another run, another nonce, or bytes that
 *   read corrupt, e.g. a newcomer still writing): it is put back with
 *   `linkSync(tomb, .lock)`, which keeps the inode (bytes, mtime, a writer's
 *   open fd) and fails on EEXIST like `wx`, then the tomb name is unlinked and
 *   the usual mismatch error is thrown. Never `renameSync` back: that would
 *   overwrite a newcomer.
 * - The tomb name is unique per call (pid plus random bytes), never derived
 *   from the nonce, so two removers in one process never share a tomb.
 * - `ENOENT` on the rename means another remover won: "absent". Any other
 *   rename error (e.g. EACCES) is rethrown with nothing moved.
 * - If the restore hits EEXIST (yet another run took `.lock` while the record
 *   was in the tomb), the newcomer is kept, the tomb is kept for diagnosis and
 *   `lock displaced: kept <tomb basename>` is thrown. Nothing auto-cleans a
 *   tomb, and its name fails the run-name grammar, so `doctor` skips it.
 * - Error paths keep the primary outcome (D82-WI-9). Every failed restore
 *   `linkSync` names the tomb: EEXIST as above, any other code appended, e.g.
 *   `lock displaced: kept <tomb basename> (EPERM)`, never a raw error that
 *   leaves the record in an unnamed tomb. Unlinking a tomb is best-effort:
 *   ours still released (the leftover holds only our record) but is no
 *   longer silent (D105-WI-3): the result is `released; tomb kept: <tomb
 *   basename>` (`keptTomb` parses it), callers print `[warn] lock tomb kept:
 *   <tomb basename>`, and the tomb refuses the next acquire. A restore still
 *   throws its mismatch, with `; tomb kept: <tomb basename>` appended so
 *   `quit`'s prefix match holds.
 * - A non-mutating pre-check (`readRecord`) still refuses an absent, corrupt,
 *   directory or plainly foreign lock before any rename: a directory `.lock`
 *   could be renamed but never `linkSync`-ed back (K-R3).
 * - An unparsable lock is `corrupt`: acquire and release both refuse with
 *   `lock unreadable`. Nothing auto-takes or auto-cleans a lock (D2).
 * - `releaseOrphanLock` is for a lock whose run dir is already gone, so the
 *   nonce went with it: it matches on `run` only. Any other holder, or a
 *   corrupt lock, throws and the bytes stay.
 * - Callers release the lock only on launch failure cleanup, a
 *   confirmed-dead `quit`, or `clean` of the run it names (its orphan lock
 *   included, once `clean` has proved no verify binary may be running).
 *   `checkLockOwner` stays for callers that check before an irreversible step.
 *
 * @module scripts/control/lock
 * @coordinates-with scripts/control/lockMutex.mjs (withLockMutex: every acquire and release section)
 * @coordinates-with scripts/control/lockTomb.mjs (tomb names, the acquire refusal, the kept-tomb result)
 * @coordinates-with scripts/control/runDir.mjs (layout().lock is this path)
 * @coordinates-with scripts/control/ownership.mjs (cleanVerdict lockNamesThisRun)
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withLockMutex } from "./lockMutex.mjs";
import { firstTomb, newTombPath, tombKeptResult, unlinkTomb } from "./lockTomb.mjs";

export { keptTomb } from "./lockTomb.mjs";

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
 * Take the lock for `run`, or throw naming the current holder. Runs inside
 * `.lock.mutex`; a busy mutex throws `lock busy: …` and writes nothing. Any
 * tomb in `parent` throws `lock interrupted: kept <tomb> (run <run>|unreadable)`
 * first, and writes nothing.
 * @param {string} parent the runs parent (must exist)
 * @param {{ run: string, nonce: string }} owner
 * @param {MutexOpts} [opts]
 * @returns {{ run: string }}
 */
export function acquireLock(parent, { run, nonce }, opts = {}) {
  const body = JSON.stringify({ run, nonceDigest: digest(nonce) });
  return withLockMutex(
    parent,
    () => {
      refuseOnTomb(parent);
      try {
        fs.writeFileSync(lockPath(parent), body, { flag: "wx", mode: LOCK_MODE });
      } catch (error) {
        if (!(error instanceof Error) || /** @type {any} */ (error).code !== "EEXIST") throw error;
        const held = readRecord(parent);
        throw new Error(held.state === "held" ? `lock held by run ${held.run}` : UNREADABLE);
      }
      return { run };
    },
    { waitMs: opts.mutexWaitMs },
  );
}

/** Throw `lock interrupted: …` when any tomb is in `parent` (D105-WI-3). */
function refuseOnTomb(parent) {
  const tomb = firstTomb(parent);
  if (tomb === null) return;
  const rec = readRecordAt(path.join(parent, tomb));
  throw new Error(`lock interrupted: kept ${tomb} (${rec.state === "held" ? `run ${rec.run}` : "unreadable"})`);
}

/** @typedef {"released" | "absent" | `released; tomb kept: ${string}`} ReleaseResult */
/** @typedef {{ mutexWaitMs?: number }} MutexOpts how long to wait for `.lock.mutex` (default `MUTEX_WAIT_MS`) */

/**
 * Release the lock if, and only if, `{ run, nonce }` wrote it.
 * @param {string} parent the runs parent
 * @param {{ run: string, nonce: string }} owner
 * @param {MutexOpts} [opts]
 * @returns {ReleaseResult}
 */
export function releaseLock(parent, owner, opts = {}) {
  return releaseAtomically(parent, (rec) => ownerMismatch(rec, owner), opts);
}

/**
 * Would `releaseLock(parent, owner)` succeed? Throws exactly what it would
 * throw, and changes nothing, so a caller can check before an irreversible step.
 * @param {string} parent the runs parent
 * @param {{ run: string, nonce: string }} owner
 * @returns {"held" | "absent"}
 */
export function checkLockOwner(parent, owner) {
  const held = readRecord(parent);
  if (held.state === "absent") return "absent";
  const mismatch = ownerMismatch(held, owner);
  if (mismatch) throw new Error(mismatch);
  return "held";
}

/** @returns {string | null} why `rec` is not the lock of `run`, or null if it is */
function runMismatch(rec, run) {
  if (rec.state !== "held") return UNREADABLE;
  return rec.run === run ? null : `lock names run ${rec.run}, not ${run}`;
}

/** @returns {string | null} why `rec` is not `{ run, nonce }`'s lock, or null if it is */
function ownerMismatch(rec, { run, nonce }) {
  const byRun = runMismatch(rec, run);
  if (byRun) return byRun;
  return rec.nonceDigest === digest(nonce) ? null : `lock for run ${rec.run} holds another nonce`;
}

/**
 * The tomb protocol (see Key decisions), inside `.lock.mutex`: pre-check,
 * move aside, judge the tomb, then unlink it (ours) or restore it and throw.
 * @param {string} parent
 * @param {(rec: ReturnType<typeof readRecord>) => string | null} mismatchOf
 * @param {MutexOpts} opts
 * @returns {ReleaseResult}
 */
function releaseAtomically(parent, mismatchOf, opts) {
  return withLockMutex(parent, () => releaseSection(parent, mismatchOf), { waitMs: opts.mutexWaitMs });
}

/** The release section itself; the caller holds `.lock.mutex`. */
function releaseSection(parent, mismatchOf) {
  const pre = readRecord(parent);
  if (pre.state === "absent") return "absent";
  const refused = mismatchOf(pre);
  if (refused) throw new Error(refused);
  const tomb = newTombPath(parent);
  try {
    fs.renameSync(lockPath(parent), tomb);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "absent";
    throw error;
  }
  const mismatch = mismatchOf(readRecordAt(tomb));
  if (!mismatch) return unlinkTomb(tomb) ? "released" : tombKeptResult(tomb);
  try {
    fs.linkSync(tomb, lockPath(parent));
  } catch (error) {
    const code = errorCode(error);
    throw new Error(`lock displaced: kept ${path.basename(tomb)}${code === "EEXIST" ? "" : ` (${String(code)})`}`);
  }
  throw new Error(unlinkTomb(tomb) ? mismatch : `${mismatch}; tomb kept: ${path.basename(tomb)}`);
}

/** @param {unknown} error @returns {unknown} */
function errorCode(error) {
  return error instanceof Error ? /** @type {any} */ (error).code : undefined;
}

/**
 * Release the lock of a run whose run dir is gone, if, and only if, the lock
 * still names `run`. The caller must already have proved nothing is running.
 * @param {string} parent the runs parent
 * @param {string} run
 * @param {MutexOpts} [opts]
 * @returns {ReleaseResult}
 */
export function releaseOrphanLock(parent, run, opts = {}) {
  return releaseAtomically(parent, (rec) => runMismatch(rec, run), opts);
}

/** @returns {{ state: "absent" } | { state: "corrupt" } | { state: "held", run: string, nonceDigest: string }} */
function readRecord(parent) {
  return readRecordAt(lockPath(parent));
}

/** @param {string} file @returns {ReturnType<typeof readRecord>} */
function readRecordAt(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { state: "absent" } : { state: "corrupt" };
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
