/**
 * Purpose: The `si.sock` step and the absent-run path of the launcher's
 * `clean <run>` (ADR-0047 WI-003 WI-8, D82-WI-2): decide whether a stale
 * `si.sock` may be unlinked, release an orphan lock, and settle the lock
 * release so the printed lines stay in order.
 *
 * Pipeline: `absentRun(d, rep, parent, name)` → `lockState` (corrupt refuses,
 *   another run is untouched) → scan, probe → `orphanBlocker` (a lock naming
 *   R) → `siSock` while the lock is still held → `settle` (releaseOrphanLock,
 *   then the absent line, [the kept-tomb warn line], the socket line, the
 *   verdict).
 *   `siSock(d, probe, scan, { parent, run })` → the line to print (or null):
 *   first-probe and scan gates → `lstat` (a socket) → re-probe (`stale` only)
 *   → inside `.lock.mutex`: `readLock` → `unlinkSync` only when the lock is
 *   absent or names `run`.
 *
 * Key decisions:
 * - The socket step runs while `clean` still holds the lock (D82-WI-2, H2).
 *   Releasing first let a launch take the lock, bind a live `si.sock`, and
 *   then lose it to `clean`'s unlink, which acted on a probe taken earlier.
 *   With the lock held, that launch is refused (`lock held by run R`).
 * - A second probe runs right before the unlink, and only on the path that
 *   would unlink (first probe `stale`, scan exactly `[]`, a socket file).
 *   Only a `stale` re-probe unlinks; otherwise `[info] si.sock kept: re-probe
 *   <live|absent|unknown>`. Re-probing off that path would re-run probe
 *   callbacks that today's tests (CL-R8a/b) script for one call.
 * - The lock is re-checked right before the unlink, inside `.lock.mutex`
 *   (D105-WI-4, lockMutex.mjs): `si.sock` is unlinked only when `.lock` is
 *   absent or names the run being cleaned; otherwise `[info] si.sock kept:
 *   lock held by run <X>` | `lock unreadable`. A launch acquires inside the
 *   same mutex before it binds, so a socket bound by a launch that holds the
 *   lock is never unlinked: neither when another `clean` released R's orphan
 *   lock and a launch took it during the re-probe (D105 ②), nor when there was
 *   no lock to hold at all (the former accepted limit). A busy mutex keeps the
 *   socket: `[info] si.sock kept: lock busy: …`. Processes not started by the
 *   launcher take no lock; the scan and the re-probe stay the only guard
 *   there.
 * - A release that succeeded but kept its own tomb (`released; tomb kept:
 *   <tomb>`, D105-WI-3) prints `[warn] lock tomb kept: <tomb>` right after the
 *   removed/absent line; the verdict stays `pass` (the release itself
 *   succeeded), and the tomb refuses the next acquire until removed.
 * - The socket line is held until the release settles: on success the order
 *   is the removed/absent line, the socket line, the verdict (as before); on
 *   a failed release it is the socket line, then the driver-failure verdict,
 *   which stays last. The removed/absent line is printed only after a
 *   successful release.
 * - An orphan lock (absent R, a lock naming R) is released by
 *   `releaseOrphanLock` only when the scan is exactly `[]` and `si.sock` is
 *   not live or unknown; otherwise refused, lock kept. The release runs inside
 *   `.lock.mutex` (D105-WI-2); `deps.lockMutexWaitMs` (tests) bounds its wait.
 *
 * @module scripts/control/cleanSocket
 * @coordinates-with scripts/control/clean.mjs (run: the present-run path calls siSock and settle)
 * @coordinates-with scripts/control/lock.mjs (readLock, releaseOrphanLock, keptTomb)
 * @coordinates-with scripts/control/lockMutex.mjs (withLockMutex: the lock re-check and the unlink)
 * @coordinates-with scripts/control/launcherFormat.mjs (formatCleanRefusal)
 * @coordinates-with scripts/control/launchCore.mjs (errCode, errMessage)
 * @coordinates-with scripts/control/ownerFacts.mjs (goodPid)
 */
import fs from "node:fs";
import { errCode, errMessage } from "./launchCore.mjs";
import { formatCleanRefusal } from "./launcherFormat.mjs";
import { keptTomb, readLock, releaseOrphanLock } from "./lock.mjs";
import { withLockMutex } from "./lockMutex.mjs";
import { goodPid } from "./ownerFacts.mjs";

export const UNKNOWN = "unknown";

/** @param {string} p @returns {fs.Stats | null} */
export function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** @param {unknown} s @returns {number[] | "unknown"} */
export const normScan = (s) => (Array.isArray(s) && s.every(goodPid) ? s : UNKNOWN);

/** @returns {"absent" | "thisRun" | "otherRun" | "corrupt"} */
export function lockState(parent, name) {
  const lock = readLock(parent);
  if (lock.state === "held") return lock.run === name ? "thisRun" : "otherRun";
  return lock.state === "absent" ? "absent" : "corrupt";
}

/**
 * Release the lock, then print in order: on success `okLine(result)`, the
 * `[warn] lock tomb kept: <tomb>` line when the release kept its own tomb, the
 * held socket line, `verdict: pass`; on failure the socket line, then the
 * driver-failure verdict built by `failReason`.
 * @param {any} rep @param {string | null} sockLine
 * @param {() => string} release @param {(result: string) => string} okLine
 * @param {(msg: string) => string} failReason
 */
export function settle(rep, sockLine, release, okLine, failReason) {
  let result;
  try {
    result = release();
  } catch (e) {
    if (sockLine !== null) rep.say(sockLine);
    return rep.verdict("driver failure", failReason(errMessage(e)));
  }
  rep.say(okLine(result));
  const tomb = keptTomb(result);
  if (tomb !== null) rep.say(`[warn] lock tomb kept: ${tomb}`);
  if (sockLine !== null) rep.say(sockLine);
  return rep.verdict("pass");
}

/** Why an orphan lock must stay, or null when the scan is `[]` and `si.sock` is stale or absent. */
function orphanBlocker(scan, probe) {
  if (scan === UNKNOWN) return "process scan unknown";
  if (scan.length > 0) return "verify binary running";
  if (probe === "live") return "si.sock live";
  return probe === "stale" || probe === "absent" ? null : "si.sock probe unknown";
}

/** R is absent: under the same proofs, a stale `si.sock` is unlinked while an orphan lock naming R is held, then released. */
export async function absentRun(d, rep, parent, name) {
  const lock = lockState(parent, name);
  if (lock === "corrupt") return rep.finish(formatCleanRefusal(["lock"]));
  if (lock === "otherRun") {
    rep.say(`clean: absent ${name}`);
    return rep.verdict("pass");
  }
  const scan = normScan(await d.procFacts.scan());
  const probe = await d.procFacts.probe(d.siSockPath);
  if (lock === "thisRun") {
    const why = orphanBlocker(scan, probe);
    if (why !== null) return rep.verdict("fail", `orphan lock kept: ${why}`);
  }
  const sockLine = await siSock(d, probe, scan, { parent, run: name });
  return settle(
    rep,
    sockLine,
    () => (lock === "thisRun" ? releaseOrphanLock(parent, name, { mutexWaitMs: d.lockMutexWaitMs }) : "absent"),
    (released) => (released === "absent" ? `clean: absent ${name}` : `clean: absent ${name}; released orphan lock`),
    (msg) => `lock not released: ${msg}`,
  );
}

/**
 * After R is gone, before the lock is released: unlink a stale `si.sock` only
 * when no verify binary may be running, a re-probe still says `stale`, and,
 * inside `.lock.mutex`, the lock is absent or names `run`.
 * @param {any} d @param {string} probe @param {number[] | "unknown"} scan
 * @param {{ parent: string, run: string }} at the runs parent and the run being cleaned
 * @returns {Promise<string | null>} the line to print, or null for none
 */
export async function siSock(d, probe, scan, { parent, run }) {
  if (probe === UNKNOWN) return "[info] si.sock kept: probe unknown";
  if (probe !== "stale") return null;
  if (scan === UNKNOWN) return "[info] si.sock kept: process scan unknown";
  if (scan.length > 0) return "[info] si.sock kept: verify binary running";
  const st = lstatOrNull(d.siSockPath);
  if (st === null || !st.isSocket()) return "[info] si.sock kept: not a socket";
  const again = await d.procFacts.probe(d.siSockPath);
  if (again !== "stale") return `[info] si.sock kept: re-probe ${again === "live" || again === "absent" ? again : UNKNOWN}`;
  try {
    return withLockMutex(parent, () => unlinkUnlessTaken(d.siSockPath, parent, run), { waitMs: d.lockMutexWaitMs });
  } catch (e) {
    return `[info] si.sock kept: ${errMessage(e)}`;
  }
}

/** The caller holds `.lock.mutex`: unlink `sock` only when `.lock` is absent or names `run`. */
function unlinkUnlessTaken(sock, parent, run) {
  const lock = readLock(parent);
  if (lock.state === "corrupt") return "[info] si.sock kept: lock unreadable";
  if (lock.state === "held" && lock.run !== run) return `[info] si.sock kept: lock held by run ${lock.run}`;
  try {
    fs.unlinkSync(sock);
    return "clean: removed stale si.sock";
  } catch (e) {
    return `[info] si.sock kept: unlink failed: ${errCode(e)}`;
  }
}
