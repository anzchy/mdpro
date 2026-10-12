/**
 * Purpose: The per-run clean claim of the launcher's `clean <run>` (D148-WI-2):
 * `<runs parent>/.clean.<run>`, holding `{ pid, token }`, says one cleaner is
 * between its first mutation of R (the run dir, the socket, the lock) and its
 * exit. A second `clean R` meanwhile refuses instead of judging R's lock an
 * orphan and releasing it under the first cleaner.
 *
 * Pipeline: `claimClean(parent, run, { mutexWaitMs })` → inside `.lock.mutex`:
 *   read `.clean.<run>` → absent, or held by an ESRCH pid → write ours
 *   (whole, via a temp and a link) → token | alive, EPERM or this pid → throw `run <run> is being cleaned
 *   (cleaner pid <n>, .clean.<run>)` | unparsable → throw `clean marker
 *   unreadable (.clean.<run>)`.
 *   `dropClean(parent, run, token, { mutexWaitMs })` → inside `.lock.mutex`:
 *   unlink only when the token is ours → whether it was removed.
 *   `underClaim(d, rep, parent, run, body)` → claim (a refusal is `verdict:
 *   driver failure — <message>`) → `await body()` → drop in `finally`.
 *
 * Key decisions:
 * - Every create, replace and remove of the marker is one synchronous
 *   `withLockMutex` section (ADR-0077). The marker is held across `clean`'s
 *   awaits (scan, probe, re-probe), but no await is ever inside a section.
 *   Because the mutex serialises the read-then-replace, a dead holder's
 *   marker is replaced in place with no break file.
 * - The marker is never seen incomplete (D148-WI-3): the body goes to a
 *   unique `.clean.<run>.<pid>-<hex>.tmp` first, which is then linked onto the
 *   marker name (`writeWhole.mjs`), so an existing marker still refuses with EEXIST (a rename
 *   would replace it). The temp is removed in `finally`. A cleaner killed
 *   mid-claim leaves at most a temp, which nothing reads; an empty marker
 *   from older code still refuses as unreadable.
 * - Liveness is `kill(pid, 0)` only, fail-closed: only ESRCH frees a marker.
 *   A reused pid reads as alive, so `clean R` refuses until a human removes
 *   the file the message names. No age rule.
 * - This process's own pid counts as alive: in one process it is another
 *   async `clean` of the same run, which must refuse like a second process.
 * - The marker carries only `{ pid, token }`, never a nonce or digest. Its
 *   name fails the run-name grammar, so `doctor` never takes it for a run
 *   dir (it lists it as a lock leftover, D174), and it is not a
 *   tomb (`.lock.*.tomb`), so it never refuses an acquire.
 * - `dropClean` never removes a marker it does not hold (another token, or
 *   unreadable); it reports false and leaves it. `underClaim` reports a drop
 *   that failed or found no marker of ours as `[warn] clean marker kept:
 *   .clean.<run> (<why>)` on stderr, after the verdict; the verdict stands.
 *   A marker left by a cleaner that has exited is freed by the next claim.
 *
 * @module scripts/control/cleanClaim
 * @coordinates-with scripts/control/clean.mjs (the present-run path claims before removing R)
 * @coordinates-with scripts/control/cleanSocket.mjs (the orphan path claims before the socket step)
 * @coordinates-with scripts/control/lockMutex.mjs (withLockMutex: every section here)
 * @coordinates-with scripts/control/writeWhole.mjs (writeWhole: the temp-and-link create of the marker)
 * @coordinates-with scripts/control/doctorLeftovers.mjs (readMarker: doctor's `.clean.<run>` line, D174)
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { errMessage } from "./launchCore.mjs";
import { withLockMutex } from "./lockMutex.mjs";
import { writeWhole } from "./writeWhole.mjs";

const FILE_MODE = 0o600;
const TOKEN_BYTES = 8;
const TOKEN_RE = /^[0-9a-f]{16}$/;

/** @param {string} run @returns {string} the marker's file name */
export const markerName = (run) => `.clean.${run}`;

/**
 * Claim the clean of `run`, or throw naming who holds it.
 * @param {string} parent the runs parent (must exist)
 * @param {string} run
 * @param {{ mutexWaitMs?: number }} [opts]
 * @returns {string} the token `dropClean` needs
 */
export function claimClean(parent, run, { mutexWaitMs } = {}) {
  const file = path.join(parent, markerName(run));
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return withLockMutex(
    parent,
    () => {
      const h = readMarker(file);
      if (h.state === "unreadable") throw new Error(`clean marker unreadable (${markerName(run)})`);
      if (h.state === "held" && !isDead(h.pid)) {
        throw new Error(`run ${run} is being cleaned (cleaner pid ${h.pid}, ${markerName(run)})`);
      }
      if (h.state === "held") fs.unlinkSync(file);
      writeWhole(file, JSON.stringify({ pid: process.pid, token }), FILE_MODE);
      return token;
    },
    { waitMs: mutexWaitMs },
  );
}

/**
 * Drop a claim made by `claimClean`.
 * @param {string} parent @param {string} run @param {string} token
 * @param {{ mutexWaitMs?: number }} [opts]
 * @returns {boolean} true when our marker was removed
 */
export function dropClean(parent, run, token, { mutexWaitMs } = {}) {
  const file = path.join(parent, markerName(run));
  return withLockMutex(
    parent,
    () => {
      const h = readMarker(file);
      if (h.state !== "held" || h.token !== token) return false;
      fs.unlinkSync(file);
      return true;
    },
    { waitMs: mutexWaitMs },
  );
}

/**
 * Run `body` holding the clean claim of `run`; a refused claim is the verdict.
 * @param {any} d clean's deps (`lockMutexWaitMs`, `err`) @param {any} rep
 * @param {string} parent @param {string} run
 * @param {() => Promise<{ exit: 0 | 1, lines: string[] }>} body
 */
export async function underClaim(d, rep, parent, run, body) {
  let token;
  try {
    token = claimClean(parent, run, { mutexWaitMs: d.lockMutexWaitMs });
  } catch (e) {
    return rep.verdict("driver failure", errMessage(e));
  }
  try {
    return await body();
  } finally {
    let why = null;
    try {
      if (!dropClean(parent, run, token, { mutexWaitMs: d.lockMutexWaitMs })) why = "not ours";
    } catch (e) {
      why = errMessage(e);
    }
    if (why !== null) d.err(`[warn] clean marker kept: ${markerName(run)} (${why})`);
  }
}

/** @param {number} pid @returns {boolean} true only when `kill(pid, 0)` says ESRCH */
function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return /** @type {any} */ (error)?.code === "ESRCH";
  }
}

/**
 * @param {string} file
 * @returns {{ state: "absent" } | { state: "unreadable" } | { state: "held", pid: number, token: string }}
 */
export function readMarker(file) {
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return /** @type {any} */ (error)?.code === "ENOENT" ? { state: "absent" } : { state: "unreadable" };
  }
  const ok =
    rec !== null &&
    typeof rec === "object" &&
    Number.isSafeInteger(rec.pid) &&
    rec.pid > 0 &&
    typeof rec.token === "string" &&
    TOKEN_RE.test(rec.token);
  return ok ? { state: "held", pid: rec.pid, token: rec.token } : { state: "unreadable" };
}
