/**
 * Purpose: The `si.sock` step and the absent-run path of the launcher's
 * `clean <run>` (ADR-0047 WI-003 WI-8, D82-WI-2): decide whether a stale
 * `si.sock` may be unlinked, release an orphan lock, and settle the lock
 * release so the printed lines stay in order.
 *
 * Pipeline: `absentRun(d, rep, parent, name)` → `lockState` (corrupt refuses,
 *   another run is untouched) → scan, probe → `orphanBlocker` (a lock naming
 *   R) → `siSock` while the lock is still held → `settle` (releaseOrphanLock,
 *   then the absent line, the socket line, the verdict).
 *   `siSock(d, probe, scan)` → the line to print (or null): first-probe and
 *   scan gates → `lstat` (a socket) → re-probe → `unlinkSync` only on `stale`.
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
 * - Accepted limit (限制): with no lock at all (absent R with no lock, or a
 *   `run()` whose lock was already gone), `clean` holds nothing, so a launch
 *   between the re-probe and the unlink can still lose its socket. The
 *   re-probe narrows that window; taking the lock under R's name would close
 *   it, but that is a protocol change that is deferred.
 * - The socket line is held until the release settles: on success the order
 *   is the removed/absent line, the socket line, the verdict (as before); on
 *   a failed release it is the socket line, then the driver-failure verdict,
 *   which stays last. The removed/absent line is printed only after a
 *   successful release.
 * - An orphan lock (absent R, a lock naming R) is released by
 *   `releaseOrphanLock` only when the scan is exactly `[]` and `si.sock` is
 *   not live or unknown; otherwise refused, lock kept.
 *
 * @module scripts/control/cleanSocket
 * @coordinates-with scripts/control/clean.mjs (run: the present-run path calls siSock and settle)
 * @coordinates-with scripts/control/lock.mjs (readLock, releaseOrphanLock)
 * @coordinates-with scripts/control/launcherFormat.mjs (formatCleanRefusal)
 * @coordinates-with scripts/control/launchCore.mjs (errCode, errMessage)
 * @coordinates-with scripts/control/ownerFacts.mjs (goodPid)
 */
import fs from "node:fs";
import { errCode, errMessage } from "./launchCore.mjs";
import { formatCleanRefusal } from "./launcherFormat.mjs";
import { readLock, releaseOrphanLock } from "./lock.mjs";
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
  const sockLine = await siSock(d, probe, scan);
  return settle(
    rep,
    sockLine,
    () => (lock === "thisRun" ? releaseOrphanLock(parent, name) : "absent"),
    (released) => (released === "released" ? `clean: absent ${name}; released orphan lock` : `clean: absent ${name}`),
    (msg) => `lock not released: ${msg}`,
  );
}

/**
 * After R is gone, before the lock is released: unlink a stale `si.sock` only
 * when no verify binary may be running and a re-probe still says `stale`.
 * @returns {Promise<string | null>} the line to print, or null for none
 */
export async function siSock(d, probe, scan) {
  if (probe === UNKNOWN) return "[info] si.sock kept: probe unknown";
  if (probe !== "stale") return null;
  if (scan === UNKNOWN) return "[info] si.sock kept: process scan unknown";
  if (scan.length > 0) return "[info] si.sock kept: verify binary running";
  const st = lstatOrNull(d.siSockPath);
  if (st === null || !st.isSocket()) return "[info] si.sock kept: not a socket";
  const again = await d.procFacts.probe(d.siSockPath);
  if (again !== "stale") return `[info] si.sock kept: re-probe ${again === "live" || again === "absent" ? again : UNKNOWN}`;
  try {
    fs.unlinkSync(d.siSockPath);
    return "clean: removed stale si.sock";
  } catch (e) {
    return `[info] si.sock kept: unlink failed: ${errCode(e)}`;
  }
}
