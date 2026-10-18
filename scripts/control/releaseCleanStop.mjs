/**
 * Purpose: how `releaseClean`'s layer 4 stops the release app it launched
 * and tells whose single-instance socket is left, touching nothing it did
 * not create (PR #500 round-2 audit, H1 and H2; round 4).
 *
 * Pipeline: launch → `processId` (owner) → … → `stopOwned`: alive? →
 *   identity check → SIGTERM → poll → identity check → SIGKILL → poll.
 *   `lsof` shows our pid holds the socket → `sockId` (recorded) → … after
 *   stop → `ownsSock` → the leftover is "ours", "other" or none.
 *
 * Key decisions:
 * - The socket path is global, so a socket there after our app exits may
 *   belong to another mdpro: it is "ours" only while it still has the dev
 *   and ino recorded when lsof showed our pid holding it (H1).
 * - Signals go only through the ChildProcess handle (`handleKill`). Node
 *   clears the handle in the same callback that reaps the child, so once
 *   the pid can be reused the handle can no longer signal it (round 4, H2).
 * - As a second check, every signal is preceded by one that the pid's start
 *   time and executable are still those recorded at launch, the facts
 *   `quit.mjs` re-checks (round 2, H2). A mismatch means our process is
 *   gone: no signal. An unknown identity is not a match: no signal, and
 *   the stop fails so layer 4 reports it.
 * - `sockId` and `ownsSock` only tell whose socket is left after the run;
 *   nothing here or in the deps unlinks it (round 4, H1).
 * - Every boundary is injected (`procFacts`, `kill`, `sleep`, `now`), so the
 *   order of checks and signals is tested without a real process.
 *
 * @module scripts/control/releaseCleanStop
 * @coordinates-with scripts/control/releaseCleanDeps.mjs (records the identities, calls these)
 * @coordinates-with scripts/control/procFacts.mjs (lstart, exe)
 * @coordinates-with scripts/control/quit.mjs (the same identity re-check)
 */

const UNKNOWN = "unknown";

/** @typedef {{ dev: number, ino: number }} SockId */
/** @typedef {{ startTime: string, exe: string }} ProcId */

/**
 * The identity of a socket from its `lstat`, or null when absent or not a socket.
 * @param {{ isSocket: () => boolean, dev: number, ino: number } | null} st
 * @returns {SockId | null}
 */
export function sockId(st) {
  return st !== null && st.isSocket() ? { dev: st.dev, ino: st.ino } : null;
}

/**
 * Whether the socket now at the path is the one recorded.
 * @param {SockId | null} recorded @param {SockId | null} current
 */
export function ownsSock(recorded, current) {
  return recorded !== null && current !== null && recorded.dev === current.dev && recorded.ino === current.ino;
}

/**
 * A kill that reaches only `child`, through its handle. False, and no
 * signal, for any other pid, for no child, and once Node has reaped it.
 * @param {{ pid?: number, kill: (sig: string) => boolean } | null} child
 * @returns {(pid: number, sig: string) => boolean}
 */
export function handleKill(child) {
  return (pid, sig) => (child !== null && child.pid === pid ? child.kill(sig) : false);
}

/**
 * The pid's identity now, or null when either fact is unknown.
 * @param {{ lstart: (pid: number) => Promise<string>, exe: (pid: number) => Promise<string> }} pf
 * @param {number} pid
 * @returns {Promise<ProcId | null>}
 */
export async function processId(pf, pid) {
  const [startTime, exe] = await Promise.all([pf.lstart(pid), pf.exe(pid)]);
  return startTime === UNKNOWN || exe === UNKNOWN ? null : { startTime, exe };
}

/**
 * "same", "other" (the pid is another process now), or "unknown".
 * @param {any} pf @param {number} pid @param {ProcId | null} owner
 */
async function identity(pf, pid, owner) {
  if (owner === null) return UNKNOWN;
  const now = await processId(pf, pid);
  if (now === null) return UNKNOWN;
  return now.startTime === owner.startTime && now.exe === owner.exe ? "same" : "other";
}

/**
 * Poll until the pid is gone or `ms` pass. @returns {Promise<boolean>} whether it is gone
 * @param {any} d @param {number} pid @param {number} ms
 */
async function goneWithin(d, pid, ms) {
  const start = d.now();
  do {
    if ((await d.procFacts.alive(pid)) === false) return true;
    await d.sleep();
  } while (d.now() - start < ms);
  return (await d.procFacts.alive(pid)) === false;
}

/**
 * Signal `pid` only while it is still `owner`. Returns once it is gone or
 * has become another process; throws when its identity is unknown or it
 * survives SIGKILL.
 * @param {{ procFacts: any, kill: (pid: number, sig: string) => void, sleep: () => Promise<void>, now: () => number, termMs: number, killMs: number }} d
 * @param {number} pid @param {ProcId | null} owner
 */
export async function stopOwned(d, pid, owner) {
  for (const [sig, ms] of /** @type {const} */ ([
    ["SIGTERM", d.termMs],
    ["SIGKILL", d.killMs],
  ])) {
    if ((await d.procFacts.alive(pid)) === false) return;
    const who = await identity(d.procFacts, pid, owner);
    if (who === "other") return;
    if (who === UNKNOWN) throw new Error(`pid ${pid}: identity unknown, not signalled`);
    d.kill(pid, sig);
    if (await goneWithin(d, pid, ms)) return;
  }
  throw new Error(`pid ${pid} still alive after SIGKILL`);
}
