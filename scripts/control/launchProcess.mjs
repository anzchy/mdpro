/**
 * Purpose: The process half of `launch` (ADR-0047 WI-003 WI-6): spawn the
 * main binary or `open`, watch the handle, wait for the `instance.json`
 * handshake or a second process's exit, and cross-check the published pid
 * against process facts. Every boundary comes in through `deps`.
 *
 * Pipeline: `spawnDirect` / `spawnOpen` → `{ child, st }` | `{ failed }`;
 *   `awaitHandshake` polls `instance.json` / `st` / the clock →
 *   `checkHandshake`; `verifyIdentity(pid)` → `{ startTime, exeRealpath }`;
 *   `awaitExit` (for `--into`) → `{ code }` | `{ error }` | `{ timeout }`.
 *
 * Key decisions:
 * - stderr goes to `<RUN>/launcher-stderr.log` as an fd, never a pipe (a
 *   full pipe can block the app); the parent's copy is closed after spawn.
 * - Opening that log is part of the spawn (D82 M1): an open that fails
 *   (EACCES, ENOENT) returns `{ failed: <code> }` like a failed spawn, and
 *   nothing is spawned. It never throws past the driver, so `launch` still
 *   releases its lock and prints `driver failure — spawn failed: <code>`,
 *   and `--into` ends with that verdict. Only an fd that was opened is closed.
 * - The direct child is spawned detached and unref'd, so the launcher can
 *   exit while the app lives on. `open` gets no spawn env: the run's values
 *   ride on its `--env` argv.
 * - Nothing here signals anything. The driver decides, and only ever
 *   signals the handle it spawned (never a pid read from a file).
 * - A start time or exe of `unknown` is a failure, never recorded: an
 *   `owner.json` holding `unknown` would make every later ownership check
 *   compare unknown to unknown.
 *
 * @module scripts/control/launchProcess
 * @coordinates-with scripts/control/launch.mjs, launchInto.mjs (the drivers)
 * @coordinates-with scripts/control/launchCore.mjs (checkHandshake, parseGuardReason)
 */
import fs from "node:fs";
import { checkHandshake, errCode, GUARD_EXIT, parseGuardReason, POLL_MS } from "./launchCore.mjs";

const LOG_MODE = 0o600;
const UNKNOWN = "unknown";

/** @param {any} child @returns {{ exited: boolean, code: number | string | null, error: string | null }} */
function watch(child) {
  const st = { exited: false, code: /** @type {number | string | null} */ (null), error: /** @type {string | null} */ (null) };
  child.on("exit", (/** @type {number | null} */ code, /** @type {string | null} */ signal) => {
    st.exited = true;
    st.code = code ?? signal;
  });
  child.on("error", (/** @type {unknown} */ e) => {
    st.error = errCode(e);
  });
  return st;
}

/** @param {any} d @param {string} stderrLog @param {string} cmd @param {string[]} args @param {object} opts */
function spawnLogged(d, stderrLog, cmd, args, opts) {
  /** @type {number | null} */
  let fd = null;
  try {
    fd = fs.openSync(stderrLog, "a", LOG_MODE);
    const child = d.spawn(cmd, args, { ...opts, stdio: ["ignore", "ignore", fd] });
    const st = watch(child);
    if (typeof child.unref === "function") child.unref();
    return { child, st };
  } catch (e) {
    return { failed: errCode(e) };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Spawn the main binary detached, with the child env, stderr to the log.
 * @param {any} d deps (`spawn`, `mainBinary`, `mainBinaryArgs`)
 * @param {{ stderrLog: string, file?: string, env: Record<string, string | undefined> }} input
 */
export function spawnDirect(d, { stderrLog, file, env }) {
  const args = [...(d.mainBinaryArgs ?? []), ...(typeof file === "string" && file !== "" ? [file] : [])];
  return spawnLogged(d, stderrLog, d.mainBinary, args, { detached: true, env });
}

/**
 * Spawn `open` with a prepared argv. No spawn env.
 * @param {any} d @param {{ stderrLog: string, argv: string[] }} input
 */
export function spawnOpen(d, { stderrLog, argv }) {
  return spawnLogged(d, stderrLog, "open", argv, {});
}

/** @param {string} file @param {number} [offset] @returns {string} */
export function readFrom(file, offset = 0) {
  try {
    return fs.readFileSync(file).subarray(offset).toString("utf8");
  } catch {
    return "";
  }
}

/** @param {string} file @returns {number} */
export const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

/**
 * Poll until `instance.json` appears and is judged, the child dies, or the
 * deadline passes.
 * @param {any} d deps (`now`, `sleep`)
 * @param {{ st: ReturnType<typeof watch>, lay: Readonly<Record<string, string>>,
 *   expected: { nonce: string, buildId: string, pid?: number },
 *   timeoutMs: number, viaOpen: boolean }} input
 * @returns {Promise<{ ok: true, pid: number } | { ok: false, reason: string }>}
 */
export async function awaitHandshake(d, { st, lay, expected, timeoutMs, viaOpen }) {
  const start = d.now();
  for (;;) {
    if (st.error) return { ok: false, reason: `spawn failed: ${st.error}` };
    if (fs.existsSync(lay.instanceJson)) return checkHandshake(readFrom(lay.instanceJson), expected);
    if (st.exited && viaOpen && st.code !== 0) return { ok: false, reason: `open exited ${st.code}` };
    if (st.exited && !viaOpen) {
      if (st.code === GUARD_EXIT) return { ok: false, reason: `guard refused: ${parseGuardReason(readFrom(lay.stderrLog))}` };
      return { ok: false, reason: `child exited ${st.code} before handshake` };
    }
    if (d.now() - start >= timeoutMs) return { ok: false, reason: `handshake timeout after ${timeoutMs} ms` };
    await d.sleep(POLL_MS);
  }
}

/**
 * Wait for a second process to exit.
 * @param {any} d @param {ReturnType<typeof watch>} st @param {number} timeoutMs
 * @returns {Promise<{ code: number | string | null } | { error: string } | { timeout: true }>}
 */
export async function awaitExit(d, st, timeoutMs) {
  const start = d.now();
  for (;;) {
    if (st.error) return { error: st.error };
    if (st.exited) return { code: st.code };
    if (d.now() - start >= timeoutMs) return { timeout: true };
    await d.sleep(POLL_MS);
  }
}

/** @param {unknown} v */
const known = (v) => typeof v === "string" && v !== "" && v !== UNKNOWN;

/**
 * The realpath of the main binary, or the path itself when it cannot be
 * resolved (a fake path in tests).
 * @param {string} mainBinary
 */
export function expectedExe(mainBinary) {
  try {
    return fs.realpathSync(mainBinary);
  } catch {
    return mainBinary;
  }
}

/**
 * Cross-check a handshaken pid: known start time, exe equal to the main binary.
 * @param {any} d deps (`procFacts`, `mainBinary`)
 * @param {number} pid
 * @returns {Promise<{ ok: true, startTime: string, exeRealpath: string } | { ok: false, reason: string }>}
 */
export async function verifyIdentity(d, pid) {
  const [startTime, exe] = await Promise.all([d.procFacts.lstart(pid), d.procFacts.exe(pid)]);
  if (!known(startTime)) return { ok: false, reason: "process facts: startTime unknown" };
  if (!known(exe)) return { ok: false, reason: "process facts: exe unknown" };
  if (exe !== expectedExe(d.mainBinary)) return { ok: false, reason: "process facts: exe mismatch" };
  return { ok: true, startTime, exeRealpath: exe };
}
