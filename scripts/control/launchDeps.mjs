/**
 * Purpose: The launcher drivers' default boundary deps (ADR-0047 WI-003
 * WI-1): the passwd home and the CSPRNG, plus the two small helpers that
 * consume the CSPRNG (`newRunName`, `newNonce`). Tests inject their own
 * `deps`; production uses `defaultDeps()`. The drivers build the runs
 * parent from `passwdHome` themselves (`runDir.mjs` `runsParent` /
 * `RUNS_SUFFIX`); this module exports no runs-parent helper.
 *
 * Pipeline: `defaultDeps()` → `{ passwdHome, randomBytes }`
 *   → `newRunName` (16 bytes) / `newNonce` (32 bytes).
 *
 * Key decisions:
 * - The home is `os.userInfo().homedir` (the passwd entry), never
 *   `os.homedir()` or `$HOME`: both honour `$HOME`, which a previous run's
 *   env can point into a run dir and nest the next run inside it (WI-002 R3).
 * - Randomness is `crypto.randomBytes` itself, never `Math.random` or a value
 *   derived from the run name. The draw order is fixed: 16 bytes for the run
 *   name, then 32 for the nonce.
 * - `process.env` is read nowhere here and assigned nowhere (hard constraint 5).
 *
 * @module scripts/control/launchDeps
 * @coordinates-with scripts/control/runDir.mjs (runName)
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import { runName } from "./runDir.mjs";

const NAME_BYTES = 16;
const NONCE_BYTES = 32;

/**
 * The production deps.
 * @returns {{ passwdHome: string, randomBytes: (n: number) => Uint8Array }}
 */
export function defaultDeps() {
  return { passwdHome: os.userInfo().homedir, randomBytes };
}

/**
 * A fresh run name from 16 bytes of `deps.randomBytes`.
 * @param {{ randomBytes: (n: number) => Uint8Array }} deps
 * @returns {string}
 */
export function newRunName(deps) {
  return runName(new Uint8Array(deps.randomBytes(NAME_BYTES)));
}

/**
 * A fresh nonce: 32 bytes of `deps.randomBytes` as 64 lowercase hex chars.
 * @param {{ randomBytes: (n: number) => Uint8Array }} deps
 * @returns {string}
 */
export function newNonce(deps) {
  return Buffer.from(deps.randomBytes(NONCE_BYTES)).toString("hex");
}
