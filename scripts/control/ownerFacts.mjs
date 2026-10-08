/**
 * Purpose: The one place the launcher reads a run's identity records and
 * gathers the process facts `quitVerdict` judges (ADR-0047 WI-003, review
 * fix WI-R2). Shared by `quit`, `launch --into` and `doctor`, so the three
 * cannot drift apart on what they ask the process table.
 *
 * Pipeline: `readRunRecords(layout)` → `{ launch, inst, owner }` (each parsed
 *   JSON or null) → `ownerFacts(procFacts, records)` → the `quitVerdict` input.
 *
 * Key decisions:
 * - Only `owner.json`'s pid is ever asked about, and only when it is a
 *   positive safe integer (`goodPid`). Any other value never reaches the
 *   process-fact boundary: `process.kill(0 | -1, …)` addresses a process
 *   group or every process. Its facts are all `"unknown"`, so the verdict
 *   fails on `pid, alive, startTime, exe`.
 * - A record that is missing or does not parse reads as null; the verdict,
 *   not this module, decides what that means.
 *
 * @module scripts/control/ownerFacts
 * @coordinates-with scripts/control/ownership.mjs (quitVerdict consumes the facts)
 * @coordinates-with scripts/control/quit.mjs, launchInto.mjs, doctor.mjs (the callers)
 * @coordinates-with scripts/control/runDir.mjs (layout: the record paths)
 */
import fs from "node:fs";

const UNKNOWN = "unknown";

/** A pid that may be handed to the process table: a positive safe integer. @param {unknown} p */
export const goodPid = (p) => Number.isSafeInteger(p) && /** @type {number} */ (p) > 0;

/** @param {string} p @returns {any} parsed JSON, or null when absent or unparsable */
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * A run's three identity records.
 * @param {Readonly<Record<string, string>>} lay a `runDir.layout` result
 * @returns {{ launch: any, inst: any, owner: any }}
 */
export function readRunRecords(lay) {
  return { launch: readJson(lay.launchJson), inst: readJson(lay.instanceJson), owner: readJson(lay.ownerJson) };
}

/**
 * The `quitVerdict` facts for `owner.json`'s pid.
 * @param {{ alive: Function, lstart: Function, exe: Function }} pf the process-fact boundary
 * @param {{ launch: any, inst: any, owner: any }} records
 */
export async function ownerFacts(pf, { launch, inst, owner }) {
  const pid = owner?.pid;
  const [alive, lstart, exe] = goodPid(pid)
    ? await Promise.all([pf.alive(pid), pf.lstart(pid), pf.exe(pid)])
    : [UNKNOWN, UNKNOWN, UNKNOWN];
  return {
    launchNonce: launch?.nonce,
    instanceNonce: inst?.nonce,
    ownerPid: pid,
    instancePid: inst?.pid,
    pidAlive: alive,
    psStartTime: lstart,
    recordedStartTime: owner?.startTime,
    exeRealpath: exe,
    recordedExeRealpath: owner?.exeRealpath,
  };
}
