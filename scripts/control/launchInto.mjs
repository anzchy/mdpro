/**
 * Purpose: `launch --into <run> [--via open] <file>` (ADR-0047 WI-003 WI-6,
 * decision D1): hand a file to a live run by starting a second process with
 * that run's env, the way a user's double-click reaches the running app.
 *
 * Pipeline: `layout(parent, R)` → run dir present → `launch.json`,
 *   `instance.json`, `owner.json` + process facts for the owner pid →
 *   `quitVerdict` → spawn the main binary (or `open`) with R's realpath and
 *   nonce → `awaitExit` → `second process exited N` → verdict.
 *
 * Key decisions:
 * - The same ownership checks `quit` runs (nonce, pid, alive, startTime,
 *   exe), from the same shared `ownerFacts` (a pid that is not a positive
 *   safe integer is never asked about); one failure refuses before anything
 *   is spawned.
 * - Read-only on run identity: never touches `.lock`, `owner.json` or
 *   `instance.json`, never creates a run dir, draws no randomness. The only
 *   writes are appends to R's `launcher-stderr.log` and `launcher.jsonl`.
 * - Exit 0 is the only pass: on direct exec the second process is expected
 *   to hand off to the single-instance owner and exit 0. Exit 78 is the
 *   guard refusing, its reason parsed from the stderr this process appended.
 * - Never signals a pid read from a file; on a timeout only the second
 *   process's own handle is killed, and `--via open` never kills.
 *
 * @module scripts/control/launchInto
 * @coordinates-with scripts/control/launch.mjs (dispatches here on `into`)
 * @coordinates-with scripts/control/ownership.mjs (quitVerdict)
 * @coordinates-with scripts/control/ownerFacts.mjs (readRunRecords, ownerFacts)
 * @coordinates-with scripts/control/launchProcess.mjs (spawn, awaitExit)
 */
import fs from "node:fs";
import path from "node:path";
import { errMessage, GUARD_EXIT, openArgv, parseGuardReason, reporter } from "./launchCore.mjs";
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
 * Run `--into`.
 * @param {{ into: string, via?: string, file?: string }} args
 * @param {any} d resolved deps
 * @returns {Promise<{ exit: 0 | 1, lines: string[] }>}
 */
export async function runInto(args, d) {
  const secrets = /** @type {string[]} */ ([]);
  const rep = reporter(d, secrets);
  let lay;
  try {
    lay = layout(runsParent(fs.realpathSync(d.passwdHome)), args.into);
  } catch (e) {
    return rep.verdict("fail", errMessage(e));
  }
  if (!isDir(lay.runDir)) return rep.verdict("fail", "into: run not found");
  const records = readRunRecords(lay);
  const { launch } = records;
  if (typeof launch?.nonce === "string") secrets.push(launch.nonce);
  const v = quitVerdict(await ownerFacts(d.procFacts, records));
  if (!v.ok) return rep.finish(formatQuitRefusal(v.failed, { secrets }));

  const log = (/** @type {Record<string, unknown>} */ rec) =>
    appendLog(lay.launcherLog, { event: "launcher.into", ...rec }, { secrets, now: d.now });
  const runDirReal = fs.realpathSync(lay.runDir);
  const viaOpen = args.via === "open";
  const offset = sizeOf(lay.stderrLog);
  log({ phase: "spawn", run: args.into, via: viaOpen ? "open" : "exec" });
  const sp = viaOpen
    ? spawnOpen(d, { stderrLog: lay.stderrLog, argv: openArgv({ runDirReal, nonce: launch.nonce, bundle: bundleOf(d), file: args.file }) })
    : spawnDirect(d, { stderrLog: lay.stderrLog, file: args.file, env: childEnv({ baseEnv: process.env, runDirReal, nonce: launch.nonce }) });
  if ("failed" in sp) {
    log({ phase: "result", outcome: `spawn failed: ${sp.failed}` });
    return rep.verdict("driver failure", `spawn failed: ${sp.failed}`);
  }
  const res = await awaitExit(d, sp.st, d.handshakeTimeoutMs);
  if ("error" in res) {
    log({ phase: "result", outcome: `spawn failed: ${res.error}` });
    return rep.verdict("driver failure", `spawn failed: ${res.error}`);
  }
  if ("timeout" in res) {
    if (!viaOpen) sp.child.kill("SIGKILL");
    const reason = `second process timeout after ${d.handshakeTimeoutMs} ms`;
    log({ phase: "result", outcome: reason });
    return rep.verdict("driver failure", reason);
  }
  log({ phase: "result", outcome: `exited ${res.code}` });
  if (res.code === 0) {
    rep.say(`into: run ${args.into} second process exited 0`);
    return rep.verdict("pass");
  }
  const guard = res.code === GUARD_EXIT && !viaOpen ? `: guard refused: ${parseGuardReason(readFrom(lay.stderrLog, offset))}` : "";
  return rep.verdict("fail", `second process exited ${res.code}${guard}`);
}
