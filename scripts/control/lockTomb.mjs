/**
 * Purpose: The tomb helpers of the launcher's one-run lock (D82-WI-1 tomb
 * protocol, D105-WI-3 reporting), split out of lock.mjs to keep it under the
 * file-size limit. A tomb is `<runs parent>/.lock.<pid>-<random hex>.tomb`:
 * the name a release renames `.lock` to before it judges ownership.
 *
 * Pipeline: `newTombPath(parent)` → the release's rename target;
 *   `unlinkTomb(tomb)` → whether it is gone (best-effort);
 *   `firstTomb(parent)` → the first tomb name in the parent, or null (acquire's
 *   refusal check); `tombKeptResult(tomb)` / `keptTomb(result)` → build / parse
 *   a release's `released; tomb kept: <tomb>` result.
 *
 * Key decisions:
 * - The name is unique per call (pid plus random bytes), never derived from
 *   the nonce, so two removers in one process never share a tomb, and the
 *   name fails the run-name grammar, so `doctor` skips it.
 * - Any entry named `.lock.<anything>.tomb` counts, whoever made it (a crash
 *   between rename and restore, a failed own-tomb unlink, an older checkout):
 *   each one refuses the next acquire until a human removes it (D2: nothing
 *   auto-cleans). The first in sorted order is the one named.
 * - A release whose own tomb could not be unlinked still released: its result
 *   carries the tomb name so the caller can report it, and `keptTomb` is the
 *   one parser callers use, so the wording lives in one place.
 *
 * @module scripts/control/lockTomb
 * @coordinates-with scripts/control/lock.mjs (the tomb protocol, acquire's refusal)
 * @coordinates-with scripts/control/cleanSocket.mjs, quit.mjs, launch.mjs (keptTomb: the `[warn] lock tomb kept` line)
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOMB_RANDOM_BYTES = 8;
const TOMB_RE = /^\.lock\..+\.tomb$/;
const TOMB_KEPT = "released; tomb kept: ";

/** @param {string} parent @returns {string} a fresh tomb path for one release */
export function newTombPath(parent) {
  return path.join(parent, `.lock.${process.pid}-${randomBytes(TOMB_RANDOM_BYTES).toString("hex")}.tomb`);
}

/** Unlink a tomb; a failure only leaves it behind. @returns {boolean} whether it is gone */
export function unlinkTomb(tomb) {
  try {
    fs.unlinkSync(tomb);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} parent @returns {string | null} the first tomb name (sorted) in `parent`, or null */
export function firstTomb(parent) {
  return fs.readdirSync(parent).filter((n) => TOMB_RE.test(n)).sort()[0] ?? null;
}

/** @param {string} tomb a tomb path @returns {string} the release result naming it */
export const tombKeptResult = (tomb) => `${TOMB_KEPT}${path.basename(tomb)}`;

/**
 * @param {unknown} result a release result
 * @returns {string | null} the kept tomb's name, or null when the result is not `released; tomb kept: …`
 */
export function keptTomb(result) {
  return typeof result === "string" && result.startsWith(TOMB_KEPT) ? result.slice(TOMB_KEPT.length) : null;
}
