/**
 * Purpose: `launch --into <run> [--via open] <file>` (ADR-0047 WI-003 WI-6,
 * decision D1): hand a file to a live run by starting a second process with
 * that run's env, the way a user's double-click reaches the running app.
 *
 * Pipeline: `layout(parent, R)` → run dir present → `launch.json`,
 *   `instance.json`, `owner.json` + process facts for the owner pid →
 *   `quitVerdict` → app-log offset + clock start → spawn the main binary (or
 *   `open` without `-n`) with R's realpath and nonce → `awaitExit` →
 *   `second process exited N` → with a file, `awaitDelivery` on R's app log
 *   → `file delivered (source S)` → verdict.
 *
 * Key decisions:
 * - The same ownership checks `quit` runs (nonce, pid, alive, startTime,
 *   exe), from the same shared `ownerFacts` (a pid that is not a positive
 *   safe integer is never asked about); one failure refuses before anything
 *   is spawned.
 * - Read-only on run identity: never touches `.lock`, `owner.json` or
 *   `instance.json`, never creates a run dir, draws no randomness. The only
 *   writes are appends to R's `launcher-stderr.log` and `launcher.jsonl`.
 * - Exit 0 is necessary, not sufficient (WI-R3, device check D): a second
 *   process can exit 0 having handed off nothing. With a file, the pass also
 *   needs R's app log (`layout().appLog`) to gain, after the offset taken
 *   just before the spawn and within `handshakeTimeoutMs` of it, a
 *   `file.open.external` / `success` line naming the file (realpath or as
 *   given, `intoDelivery.mjs`); otherwise `fail — into: file not delivered
 *   within <ms> ms`. With no file there is nothing to deliver, and exit 0
 *   stays the pass. Exit 78 is the guard refusing, its reason parsed from
 *   the stderr this process appended.
 * - `--via open` runs `open` without `-n`, so macOS hands the file to the
 *   running instance; the `--env` pairs still confine a racing cold start.
 * - Never signals a pid read from a file; on a timeout only the second
 *   process's own handle is killed, and `--via open` never kills. A file
 *   that is not delivered kills nothing: the second process already exited.
 * - `runInto` only sequences four steps (D82-WI-7 L4): `resolveOwnedRun` →
 *   `spawnSecond` → `judgeExit` → `awaitFileDelivery`; each returns early
 *   with the final verdict, in the order the Pipeline lists.
 *
 * @module scripts/control/launchInto
 * @coordinates-with scripts/control/launch.mjs (dispatches here on `into`)
 * @coordinates-with scripts/control/ownership.mjs (quitVerdict)
 * @coordinates-with scripts/control/ownerFacts.mjs (readRunRecords, ownerFacts)
 * @coordinates-with scripts/control/launchProcess.mjs (spawn, awaitExit)
 * @coordinates-with scripts/control/intoDelivery.mjs (deliveryNames, awaitDelivery)
 */
import fs from "node:fs";
import path from "node:path";
import { errMessage, GUARD_EXIT, openArgv, parseGuardReason, reporter } from "./launchCore.mjs";
import { awaitDelivery, deliveryNames } from "./intoDelivery.mjs";
import { formatQuitRefusal } from "./launcherFormat.mjs";
import { appendLog } from "./launcherLog.mjs";
import { awaitExit, readFrom, sizeOf, spawnDirect, spawnOpen } from "./launchProcess.mjs";
import { ownerFacts, readRunRecords } from "./ownerFacts.mjs";
import { quitVerdict } from "./ownership.mjs";
import { childEnv, layout, runsParent } from "./runDir.mjs";

/** @param {string} p */
function isDir(p) {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The bundle `open -a` targets: `deps.bundlePath`, else the `.app` that
 * holds the main binary (`<app>/Contents/MacOS/<bin>`).
 * @param {any} d
 */
export function bundleOf(d) {
  return d.bundlePath ?? path.dirname(path.dirname(path.dirname(d.mainBinary)));
}

/**
 * Step 1: resolve R's layout and run the `quit` ownership checks. Pushes the
 * run's nonce onto `secrets` as soon as it is read.
 * @returns {Promise<{ done: { exit: 0 | 1, lines: string[] } } | { lay: any, launch: any }>}
 */
async function resolveOwnedRun(args, d, rep, secrets) {
  let lay;
  try {
    lay = layout(runsParent(fs.realpathSync(d.passwdHome)), args.into);
  } catch (e) {
    return { done: rep.verdict("fail", errMessage(e)) };
  }
  if (!isDir(lay.runDir)) return { done: rep.verdict("fail", "into: run not found") };
  const records = readRunRecords(lay);
  const { launch } = records;
  if (typeof launch?.nonce === "string") secrets.push(launch.nonce);
  const v = quitVerdict(await ownerFacts(d.procFacts, records));
  if (!v.ok) return { done: rep.finish(formatQuitRefusal(v.failed, { secrets })) };
  return { lay, launch };
}

/**
 * Step 2: take the stderr and app-log offsets and the clock start, then spawn
 * the second process (main binary, or `open` without `-n`).
 * @returns {{ done: { exit: 0 | 1, lines: string[] } } | { sp: any, offset: number, appOffset: number, start: number }}
 */
function spawnSecond(ctx, launch) {
  const { args, d, rep, log, lay, viaOpen } = ctx;
  const runDirReal = fs.realpathSync(lay.runDir);
  const offset = sizeOf(lay.stderrLog);
  const appOffset = sizeOf(lay.appLog);
  const start = d.now();
  log({ phase: "spawn", run: args.into, via: viaOpen ? "open" : "exec" });
  const sp = viaOpen
    ? spawnOpen(d, {
        stderrLog: lay.stderrLog,
        argv: openArgv({ runDirReal, nonce: launch.nonce, bundle: bundleOf(d), file: args.file, newInstance: false }),
      })
    : spawnDirect(d, { stderrLog: lay.stderrLog, file: args.file, env: childEnv({ baseEnv: process.env, runDirReal, nonce: launch.nonce }) });
  if ("failed" in sp) {
    log({ phase: "result", outcome: `spawn failed: ${sp.failed}` });
    return { done: rep.verdict("driver failure", `spawn failed: ${sp.failed}`) };
  }
  return { sp, offset, appOffset, start };
}

/**
 * Step 3: wait for the second process and judge its exit. `null` means it
 * exited 0 (already reported); anything else is the final verdict.
 * @returns {Promise<{ exit: 0 | 1, lines: string[] } | null>}
 */
async function judgeExit(ctx, second) {
  const { args, d, rep, log, lay, viaOpen } = ctx;
  const res = await awaitExit(d, second.sp.st, d.handshakeTimeoutMs);
  if ("error" in res) {
    log({ phase: "result", outcome: `spawn failed: ${res.error}` });
    return rep.verdict("driver failure", `spawn failed: ${res.error}`);
  }
  if ("timeout" in res) {
    if (!viaOpen) second.sp.child.kill("SIGKILL");
    const reason = `second process timeout after ${d.handshakeTimeoutMs} ms`;
    log({ phase: "result", outcome: reason });
    return rep.verdict("driver failure", reason);
  }
  log({ phase: "result", outcome: `exited ${res.code}` });
  if (res.code === 0) {
    rep.say(`into: run ${args.into} second process exited 0`);
    return null;
  }
  const guard = res.code === GUARD_EXIT && !viaOpen ? `: guard refused: ${parseGuardReason(readFrom(lay.stderrLog, second.offset))}` : "";
  return rep.verdict("fail", `second process exited ${res.code}${guard}`);
}

/**
 * Step 4: with a file, require R's app log to name it within
 * `handshakeTimeoutMs` of the spawn; with none, exit 0 is the pass.
 * @returns {Promise<{ exit: 0 | 1, lines: string[] }>}
 */
async function awaitFileDelivery(ctx, second) {
  const { args, d, rep, log, lay } = ctx;
  if (typeof args.file !== "string" || args.file === "") return rep.verdict("pass");
  const names = deliveryNames(args.file);
  const timeoutMs = d.handshakeTimeoutMs;
  const hit = await awaitDelivery(d, { appLog: lay.appLog, offset: second.appOffset, names, start: second.start, timeoutMs });
  if (hit === null) {
    const reason = `into: file not delivered within ${timeoutMs} ms`;
    log({ phase: "result", outcome: reason });
    return rep.verdict("fail", reason);
  }
  log({ phase: "result", outcome: `file delivered (source ${hit.source})` });
  rep.say(`into: run ${args.into} file delivered (source ${hit.source})`);
  return rep.verdict("pass");
}

/**
 * Run `--into`: resolve and verify ownership → spawn → judge the exit →
 * await delivery. Each step returns early with the final verdict.
 * @param {{ into: string, via?: string, file?: string }} args
 * @param {any} d resolved deps
 * @returns {Promise<{ exit: 0 | 1, lines: string[] }>}
 */
export async function runInto(args, d) {
  const secrets = /** @type {string[]} */ ([]);
  const rep = reporter(d, secrets);
  const owned = await resolveOwnedRun(args, d, rep, secrets);
  if ("done" in owned) return owned.done;
  const { lay } = owned;
  const log = (/** @type {Record<string, unknown>} */ rec) =>
    appendLog(lay.launcherLog, { event: "launcher.into", ...rec }, { secrets, now: d.now });
  const ctx = { args, d, rep, log, lay, viaOpen: args.via === "open" };
  const second = spawnSecond(ctx, owned.launch);
  if ("done" in second) return second.done;
  const verdict = await judgeExit(ctx, second);
  if (verdict !== null) return verdict;
  return awaitFileDelivery(ctx, second);
}
