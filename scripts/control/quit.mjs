/**
 * Purpose: The launcher's `quit [<run>]` driver (ADR-0047 WI-003 WI-7): stop
 * the verify app a run started, only once its ownership is proven, and
 * release that run's lock only once the process is confirmed dead.
 *
 * Pipeline: `run(args, deps)` → run name (`args.run`, else the lock's run) →
 *   `layout(runsParent(realpath(passwdHome)), R)` → `launch.json`,
 *   `instance.json`, `owner.json` + process facts for `owner.json`'s pid →
 *   `quitVerdict` → SIGTERM → poll until dead or `graceMs` → re-check
 *   `startTime` + `exe` → SIGKILL → poll until dead or `killConfirmMs` →
 *   `releaseLock` (only a lock naming R) → `quit: run R terminated (SIGTERM)`
 *   | `killed (SIGKILL)` → verdict.
 *
 * Key decisions:
 * - The only pid ever signalled is `owner.json`'s, and only after the full
 *   ownership verdict (nonce, pid, alive, startTime, exe) holds; the pid
 *   check requires it to equal `instance.json`'s. Any failure refuses with
 *   the failed check names and sends nothing.
 * - SIGKILL is sent only if `startTime` and `exe`, re-read immediately
 *   before it, still match the record: a change is `reused during grace`,
 *   an unknown is `identity unknown during grace`. Both keep the lock.
 * - Unknown liveness reads as alive. The lock is released only after a
 *   poll reports `false`, and only when it names this run (`releaseLock`
 *   also checks the nonce). Nothing auto-cleans a lock (D2).
 * - The run dir is never deleted (PD6); `clean` is the only verb that does.
 *   The only write is appending to R's `launcher.jsonl`; `process.env` is
 *   never read for the child or assigned. The quit guard is bypassed by
 *   design: this is a signal, not a menu quit.
 * - Every printed line and log record is redacted with the run's nonces.
 *
 * @module scripts/control/quit
 * @coordinates-with scripts/control/ownership.mjs (quitVerdict)
 * @coordinates-with scripts/control/launcherCli.mjs (`pnpm control:quit`: parseQuitArgs, runIfMain)
 * @coordinates-with scripts/control/lock.mjs (readLock, releaseLock)
 * @coordinates-with scripts/control/doctor.mjs (defaultProcFacts)
 * @coordinates-with scripts/control/ownerFacts.mjs (readRunRecords, ownerFacts: shared with launchInto, doctor)
 */
import fs from "node:fs";
import { defaultProcFacts } from "./doctor.mjs";
import { errCode, errMessage, POLL_MS, reporter } from "./launchCore.mjs";
import { defaultDeps as launchDeps } from "./launchDeps.mjs";
import { runIfMain } from "./launcherCli.mjs";
import { formatQuitRefusal } from "./launcherFormat.mjs";
import { appendLog } from "./launcherLog.mjs";
import { readLock, releaseLock } from "./lock.mjs";
import { ownerFacts, readRunRecords } from "./ownerFacts.mjs";
import { quitVerdict } from "./ownership.mjs";
import { layout, runsParent } from "./runDir.mjs";

export { POLL_MS } from "./launchCore.mjs";
export { parseQuitArgs } from "./launcherCli.mjs";

/** How long SIGTERM gets before the escalation to SIGKILL. A multiple of `POLL_MS`. */
export const QUIT_GRACE_MS = 5000;
/** How long the process gets to disappear after SIGKILL. */
export const KILL_CONFIRM_MS = 2000;

const UNKNOWN = "unknown";
const known = (v) => typeof v === "string" && v !== "" && v !== UNKNOWN;

/** Production deps; tests inject their own. */
export function defaultDeps() {
  return {
    passwdHome: launchDeps().passwdHome,
    procFacts: defaultProcFacts(),
    kill: (/** @type {number} */ pid, /** @type {string} */ sig) => process.kill(pid, sig),
    now: Date.now,
    sleep: (/** @type {number} */ ms) => new Promise((res) => setTimeout(res, ms)),
    out: (/** @type {string} */ line) => process.stdout.write(`${line}\n`),
    err: (/** @type {string} */ line) => process.stderr.write(`${line}\n`),
    graceMs: QUIT_GRACE_MS,
    killConfirmMs: KILL_CONFIRM_MS,
  };
}

/**
 * Poll every `POLL_MS` until `alive` reports `false` or `windowMs` has passed.
 * @returns {Promise<boolean | "unknown">} the last liveness seen
 */
async function pollDeath(d, pid, windowMs) {
  const start = d.now();
  let alive = /** @type {boolean | "unknown"} */ (true);
  do {
    await d.sleep(POLL_MS);
    const a = await d.procFacts.alive(pid);
    alive = a === true || a === false ? a : UNKNOWN;
    if (alive === false) return false;
  } while (d.now() - start < windowMs);
  return alive;
}

/** `null` when the pid is still the recorded process, else the refusal reason. */
async function identityDrift(d, pid, owner) {
  const [lstart, exe] = await Promise.all([d.procFacts.lstart(pid), d.procFacts.exe(pid)]);
  const changed = (now, rec) => known(now) && now !== rec;
  if (changed(lstart, owner.startTime) || changed(exe, owner.exeRealpath)) return `pid ${pid} reused during grace`;
  if (!known(lstart) || !known(exe)) return `pid ${pid} identity unknown during grace`;
  return null;
}

/** @param {any} d @param {number} pid @param {string} sig @returns {string | null} an error code, or null */
function signal(d, pid, sig) {
  try {
    d.kill(pid, sig);
    return null;
  } catch (e) {
    return errCode(e) === "ESRCH" ? null : errCode(e);
  }
}

/** The run to quit: the one named, else the one the lock names. */
function pickRun(args, parent) {
  if (args.run !== undefined) return { name: args.run };
  const lock = readLock(parent);
  if (lock.state === "held") return { name: lock.run };
  return { reason: lock.state === "corrupt" ? "lock unreadable" : "no run named and no lock" };
}

/**
 * Run `quit`.
 * @param {{ run?: string }} [args]
 * @param {Record<string, unknown>} [deps]
 * @returns {Promise<{ exit: 0 | 1, lines: string[] }>} exit 0 pass, 1 otherwise
 */
export async function run(args = {}, deps = {}) {
  const d = /** @type {any} */ ({ ...defaultDeps(), ...deps });
  const secrets = /** @type {string[]} */ ([]);
  const rep = reporter(d, secrets);
  let parent;
  let name;
  let lay;
  try {
    parent = runsParent(fs.realpathSync(d.passwdHome));
    const pick = pickRun(args, parent);
    if (pick.reason !== undefined) return rep.verdict("fail", pick.reason);
    name = /** @type {string} */ (pick.name);
    lay = layout(parent, name);
  } catch (e) {
    return rep.verdict("fail", errMessage(e));
  }
  if (!fs.existsSync(lay.runDir)) return rep.verdict("fail", "run not found");
  const records = readRunRecords(lay);
  const { launch, inst, owner } = records;
  for (const n of [launch?.nonce, inst?.nonce]) if (typeof n === "string" && n !== "") secrets.push(n);
  const log = (/** @type {Record<string, unknown>} */ rec) =>
    appendLog(lay.launcherLog, { event: "launcher.quit", run: name, ...rec }, { secrets, now: d.now });

  const v = quitVerdict(await ownerFacts(d.procFacts, records));
  if (!v.ok) {
    log({ phase: "refused", failed: v.failed });
    return rep.finish(formatQuitRefusal(v.failed, { secrets }));
  }
  const pid = owner.pid;
  const outcome = await stop(d, pid, owner, log);
  if (outcome.failure !== undefined) {
    log({ phase: "result", outcome: outcome.failure });
    return rep.verdict("driver failure", outcome.failure);
  }
  release(d, parent, name, launch.nonce);
  log({ phase: "result", outcome: outcome.how, pid });
  rep.say(`quit: run ${name} ${outcome.how}`);
  return rep.verdict("pass");
}

/**
 * SIGTERM, grace, identity re-check, SIGKILL, confirm.
 * @returns {Promise<{ how: string } | { failure: string }>}
 */
async function stop(d, pid, owner, log) {
  log({ phase: "signal", signal: "SIGTERM", pid });
  const termErr = signal(d, pid, "SIGTERM");
  if (termErr !== null) return { failure: `signal failed: ${termErr}` };
  if ((await pollDeath(d, pid, d.graceMs)) === false) return { how: "terminated (SIGTERM)" };
  const drift = await identityDrift(d, pid, owner);
  if (drift !== null) return { failure: drift };
  log({ phase: "signal", signal: "SIGKILL", pid });
  const killErr = signal(d, pid, "SIGKILL");
  if (killErr !== null) return { failure: `signal failed: ${killErr}` };
  const after = await pollDeath(d, pid, d.killConfirmMs);
  if (after === false) return { how: "killed (SIGKILL)" };
  return { failure: after === true ? `pid ${pid} still alive after SIGKILL` : `pid ${pid} liveness unknown after SIGKILL` };
}

/** Release the lock only if it names this run; a lock naming another run is left alone. */
function release(d, parent, name, nonce) {
  const lock = readLock(parent);
  if (lock.state !== "held" || lock.run !== name) return;
  try {
    releaseLock(parent, { run: name, nonce });
  } catch (e) {
    d.err(`lock not released: ${errMessage(e)}`);
  }
}

runIfMain(import.meta.url, "quit", run);
