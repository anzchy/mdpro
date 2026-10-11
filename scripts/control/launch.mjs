/**
 * Purpose: The launcher's `launch` driver (ADR-0047 WI-003 WI-6): start the
 * verify app in a fresh run dir and wait until it proves it is the process
 * this launch started (L1), or refuse / fail with exactly one verdict line.
 * `--into <run>` (D1) is dispatched to `launchInto.mjs`.
 *
 * Pipeline: `run(args, deps)` → doctor gate (`collectDoctorFacts` →
 *   `evaluate`) → `checkBudget(realpath(passwdHome))` → name + nonce → runs
 *   parent at 0700 → `acquireLock` (`wx`, then `mkdir` run dir, never reused,
 *   in the same `.lock.mutex` section) →
 *   `launch.json` (`wx`, 0600) + preferences → spawn (direct, or `open -n
 *   --env …`) → `awaitHandshake` (`instance.json`) → `verifyIdentity` →
 *   `owner.json` (`wx`, 0600) → `ready: L1 run <R> pid <P>` → `verdict: pass`.
 *
 * Key decisions:
 * - Order is the contract: doctor before the budget, the budget before any
 *   mkdir or random draw, the parent before the `wx` acquire, the acquire
 *   before the run dir. A doctor failure (any live, stale or unknown run, D2)
 *   creates nothing, and neither does a passwd home whose realpath cannot be
 *   resolved (`driver failure — home unresolvable: <code>`).
 * - Failure after acquire releases only the lock this launch wrote (run and
 *   nonce must both match); a failed acquire never touches the existing lock.
 * - Acquire and that release run inside `.lock.mutex` (D105-WI-2,
 *   lockMutex.mjs). A mutex still busy after its wait is `driver failure —
 *   lock busy: …` before the run dir exists; `deps.lockMutexWaitMs` (tests)
 *   bounds the wait, production uses `MUTEX_WAIT_MS`. The run dir is made
 *   inside the acquire's section (`inSection`, D148-WI-1), so a `clean` that
 *   follows the mutex never sees this launch's lock without its run dir and
 *   never takes it for an orphan. A failed mkdir is returned, not thrown,
 *   and goes through `fail()` as before.
 *   The run dir is kept for diagnosis (`pnpm control:clean <run>`). A release
 *   that kept its own tomb (D105-WI-3) prints `[warn] lock tomb kept: <tomb>`
 *   on stderr; the driver-failure verdict is unchanged. Any tomb refuses the
 *   acquire: `driver failure — lock interrupted: kept <tomb> (…)`.
 * - Direct exec: on a failed handshake only the spawned handle is killed
 *   (SIGKILL); a pid read from `instance.json` is never signalled, and a
 *   child that already exited or failed to spawn is not signalled at all.
 *   `--via open` never kills: there is no handle to the app.
 * - `instance.json` is never written here; the app is its only writer.
 *   `process.env` is never assigned: the child env is a fresh copy built
 *   from realpaths (`childEnv`), and `open` carries it on `--env` argv.
 * - Every printed line and log record is redacted with the run's nonce
 *   (`launcherFormat`); a failed `--via open` spawn logs its argv through
 *   `formatOpenArgvError`, nonce redacted;
 *   `launcher.jsonl` lives in the run dir only and is written only once the
 *   run dir exists (no home / tmpdir / cwd fallback).
 *
 * @module scripts/control/launch
 * @coordinates-with scripts/control/launchCore.mjs, launchProcess.mjs, launchInto.mjs
 * @coordinates-with scripts/control/launcherCli.mjs (`pnpm control:launch`: parseLaunchArgs, runIfMain)
 * @coordinates-with scripts/control/doctor.mjs, doctorChecks.mjs (the gate)
 * @coordinates-with scripts/control/lock.mjs, runDir.mjs, preset.mjs, launchDeps.mjs
 * @coordinates-with src-tauri/src/services/verify_run.rs (guard, instance.json)
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildLayout } from "./buildSteps.mjs";
import { collectFacts, defaultDeps as doctorDeps } from "./doctor.mjs";
import { evaluate } from "./doctorChecks.mjs";
import { errCode, errMessage, HANDSHAKE_TIMEOUT_MS, openArgv, reporter } from "./launchCore.mjs";
import { newNonce, newRunName } from "./launchDeps.mjs";
import { runIfMain } from "./launcherCli.mjs";
import { formatOpenArgvError, formatReady } from "./launcherFormat.mjs";
import { appendLog } from "./launcherLog.mjs";
import { bundleOf, runInto } from "./launchInto.mjs";
import { awaitHandshake, spawnDirect, spawnOpen, verifyIdentity } from "./launchProcess.mjs";
import { acquireLock, keptTomb, releaseLock } from "./lock.mjs";
import { writePreferences } from "./preset.mjs";
import { checkBudget, childEnv, launchJsonBody, layout, RUNS_SUFFIX } from "./runDir.mjs";

export { GUARD_EXIT, GUARD_PREFIX, HANDSHAKE_TIMEOUT_MS, parseGuardReason, POLL_MS } from "./launchCore.mjs";
export { parseLaunchArgs } from "./launcherCli.mjs";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Production deps; tests inject their own. */
export function defaultDeps() {
  return {
    ...doctorDeps(),
    err: (/** @type {string} */ line) => process.stderr.write(`${line}\n`),
    randomBytes,
    spawn,
    now: Date.now,
    sleep: (/** @type {number} */ ms) => new Promise((res) => setTimeout(res, ms)),
    collectDoctorFacts: collectFacts,
    mainBinaryArgs: [],
    handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
  };
}

/** mkdir each missing `RUNS_SUFFIX` component (runDir.mjs) at 0700; existing ones are left alone. */
function makeParent(homeReal) {
  let p = homeReal;
  for (const part of RUNS_SUFFIX) {
    p = path.join(p, part);
    try {
      fs.mkdirSync(p, { mode: DIR_MODE });
      fs.chmodSync(p, DIR_MODE);
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && e.code === "EEXIST")) throw e;
    }
  }
  return p;
}

/** mkdir + chmod the run dir at 0700. @returns {unknown} the error, or null; never throws (it runs inside the acquire's section) */
function makeRunDir(runDir) {
  try {
    fs.mkdirSync(runDir, { mode: DIR_MODE });
    fs.chmodSync(runDir, DIR_MODE);
    return null;
  } catch (e) {
    return e;
  }
}

/**
 * Run the doctor gate. On pass, prints its lines minus its verdict.
 * @returns {Promise<{ ok: true, facts: any } | { ok: false, result: { exit: 0 | 1, lines: string[] } }>}
 */
async function doctorGate(d, rep) {
  let facts;
  try {
    facts = await d.collectDoctorFacts(d);
  } catch (e) {
    return { ok: false, result: rep.verdict("driver failure", `doctor facts unavailable: ${errMessage(e)}`) };
  }
  const ev = evaluate(facts);
  const body = ev.lines.slice(0, -1);
  for (const line of body) rep.say(line);
  if (ev.exit !== 0) return { ok: false, result: rep.verdict(ev.verdict) };
  return { ok: true, facts };
}

/**
 * Run `launch`.
 * @param {{ file?: string, via?: string, into?: string, viewMode?: string }} args
 * @param {Record<string, unknown>} [deps]
 * @returns {Promise<{ exit: 0 | 1, lines: string[] }>} exit 0 pass, 1 otherwise
 */
export async function run(args = {}, deps = {}) {
  const d = /** @type {any} */ ({ ...defaultDeps(), ...deps });
  if (d.mainBinary === undefined) d.mainBinary = buildLayout(d.repoRoot, "verify").mainBinary;
  if (args.via !== undefined && args.via !== "open") return reporter(d, []).verdict("fail", `unknown --via ${args.via}`);
  if (args.into !== undefined) return runInto(args, d);

  const secrets = /** @type {string[]} */ ([]);
  const rep = reporter(d, secrets);
  const gate = await doctorGate(d, rep);
  if (!gate.ok) return gate.result;
  let homeReal;
  try {
    homeReal = fs.realpathSync(d.passwdHome);
  } catch (e) {
    return rep.verdict("driver failure", `home unresolvable: ${errCode(e)}`);
  }
  const budget = checkBudget(homeReal);
  if (!budget.ok) return rep.verdict("fail", budget.reason);

  const name = newRunName(d);
  const nonce = newNonce(d);
  secrets.push(nonce);
  let parent;
  let lay;
  let mkdirError = null;
  try {
    parent = makeParent(homeReal);
    lay = layout(parent, name);
    const inSection = () => (mkdirError = makeRunDir(lay.runDir));
    acquireLock(parent, { run: name, nonce }, { mutexWaitMs: d.lockMutexWaitMs, inSection });
  } catch (e) {
    return rep.verdict("driver failure", errMessage(e));
  }
  const ctx = { d, rep, secrets, parent, name, nonce, lay, ownsRunDir: mkdirError === null };
  if (mkdirError !== null) {
    const code = errCode(mkdirError);
    return fail(ctx, null, code === "EEXIST" ? `run dir already exists: ${name}` : errMessage(mkdirError));
  }
  const viaOpen = args.via === "open";
  log(ctx, { phase: "start", run: name, via: viaOpen ? "open" : "exec" });
  const buildId = d.buildId !== undefined ? d.buildId : gate.facts?.manifest?.buildId;
  try {
    const body = launchJsonBody({ nonce, buildId, mainBinary: d.mainBinary });
    fs.writeFileSync(lay.launchJson, JSON.stringify(body), { flag: "wx", mode: FILE_MODE });
    await writePreferences(lay, { viewMode: args.viewMode ?? "source" });
  } catch (e) {
    return fail(ctx, null, errMessage(e));
  }
  return spawnAndConfirm(ctx, { buildId, viaOpen, file: args.file });
}

/** Spawn, wait for the handshake, cross-check, record the owner. */
async function spawnAndConfirm(ctx, { buildId, viaOpen, file }) {
  const { d, lay, nonce, name } = ctx;
  const runDirReal = fs.realpathSync(lay.runDir);
  const argv = viaOpen ? openArgv({ runDirReal, nonce, bundle: bundleOf(d), file }) : [];
  const sp = viaOpen
    ? spawnOpen(d, { stderrLog: lay.stderrLog, argv })
    : spawnDirect(d, { stderrLog: lay.stderrLog, file, env: childEnv({ baseEnv: process.env, runDirReal, nonce }) });
  if ("failed" in sp) {
    const detail = viaOpen ? { detail: formatOpenArgvError(argv, { secrets: ctx.secrets }) } : {};
    return fail(ctx, null, `spawn failed: ${sp.failed}`, detail);
  }
  const killable = viaOpen ? null : sp;
  const hs = await awaitHandshake(d, {
    st: sp.st,
    lay,
    expected: { nonce, buildId, pid: viaOpen ? undefined : sp.child.pid },
    timeoutMs: d.handshakeTimeoutMs,
    viaOpen,
  });
  if (!hs.ok) return fail(ctx, killable, hs.reason);
  const id = await verifyIdentity(d, hs.pid);
  if (!id.ok) return fail(ctx, killable, id.reason);
  const owner = { pid: hs.pid, startTime: id.startTime, exeRealpath: id.exeRealpath };
  try {
    fs.writeFileSync(lay.ownerJson, JSON.stringify(owner), { flag: "wx", mode: FILE_MODE });
  } catch (e) {
    return fail(ctx, killable, `owner.json: ${errMessage(e)}`);
  }
  log(ctx, { phase: "ready", run: name, pid: hs.pid });
  ctx.rep.say(formatReady({ run: name, pid: hs.pid }, { secrets: ctx.secrets }));
  return ctx.rep.verdict("pass");
}

/** @param {any} ctx @param {Record<string, unknown>} rec */
function log(ctx, rec) {
  appendLog(ctx.lay.launcherLog, { event: "launcher.launch", ...rec }, { secrets: ctx.secrets, now: ctx.d.now });
}

/**
 * Failure after acquire: kill only a live spawned handle, release only this
 * launch's lock, log (only into a run dir this launch made), print the verdict.
 * @param {any} ctx @param {{ child: any, st: any } | null} sp @param {string} reason
 * @param {Record<string, unknown>} [extra] more log fields (already redacted)
 */
function fail(ctx, sp, reason, extra = {}) {
  const { d, rep, parent, name, nonce } = ctx;
  if (sp && !sp.st.exited && !sp.st.error) sp.child.kill("SIGKILL");
  try {
    const tomb = keptTomb(releaseLock(parent, { run: name, nonce }, { mutexWaitMs: d.lockMutexWaitMs }));
    if (tomb !== null) d.err(`[warn] lock tomb kept: ${tomb}`);
  } catch (e) {
    d.err(`lock not released: ${errMessage(e)}`);
  }
  if (ctx.ownsRunDir) log(ctx, { phase: "fail", run: name, reason, ...extra });
  return rep.verdict("driver failure", reason);
}

runIfMain(import.meta.url, "launch", run);
