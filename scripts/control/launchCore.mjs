/**
 * Purpose: The pure half of `launch` (ADR-0047 WI-003 WI-6): the timing
 * constants, the guard-line parser, the `open` argv, the handshake check
 * and the verdict reporter. No fs, no spawn, no clock.
 *
 * Pipeline: `launcher-stderr.log` text → `parseGuardReason`;
 *   `{ runDirReal, nonce, bundle, file, newInstance }` → `openArgv`;
 *   `instance.json` text + expected `{ nonce, buildId, pid }` → `checkHandshake`;
 *   `reporter(deps, secrets)` → `say(line)` / `verdict(kind, reason)` (via
 *   `formatVerdict`) / `finish(line)` for a ready-made verdict line.
 *
 * Key decisions:
 * - The guard reason is the **last** line that **starts with** the guard
 *   prefix (`verify_run.rs`), trailing CR stripped and trimmed; an empty
 *   reason or no such line is `unknown`. Works for debug-echo and release
 *   stderr alike.
 * - The handshake names the first failing field, in the order nonce,
 *   buildId, pid; it never prints either value (no nonce leaks).
 * - `open [-n] --env K=V … -a <bundle> [file]`: a cold `launch --via open`
 *   passes `-n` (the default) to force a new instance; `--into --via open`
 *   passes `newInstance: false`, so macOS delivers the file to the running
 *   instance as an open-documents event (with `-n` the fresh instance only
 *   hands an empty argv to the owner over single-instance). Either way the
 *   four values ride on `--env`, never on the spawn env, so a cold start in
 *   a race stays confined to the run. The argv carries the nonce, so it is
 *   never printed.
 * - Every printed line goes through `redact` with the run's secrets; the
 *   last line of every outcome is the verdict.
 *
 * @module scripts/control/launchCore
 * @coordinates-with scripts/control/launch.mjs (the driver)
 * @coordinates-with scripts/control/launcherFormat.mjs (redact, formatVerdict)
 * @coordinates-with src-tauri/src/services/verify_run_instance.rs (guard line, instance.json)
 */
import { formatVerdict, redact } from "./launcherFormat.mjs";

/** How long the launcher waits for `instance.json` (or a second process). */
export const HANDSHAKE_TIMEOUT_MS = 15000;
/** Poll interval while waiting; `HANDSHAKE_TIMEOUT_MS` is a multiple of it. */
export const POLL_MS = 100;
/** The app's guard refusal prefix and exit code (`verify_run.rs`). */
export const GUARD_PREFIX = "mdpro verify-run guard: refusing to start: ";
export const GUARD_EXIT = 78;

const UNKNOWN = "unknown";

/**
 * The reason on the last guard line of a stderr capture.
 * @param {unknown} text
 * @returns {string} the reason, or "unknown"
 */
export function parseGuardReason(text) {
  let reason = UNKNOWN;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.startsWith(GUARD_PREFIX)) continue;
    const r = line.slice(GUARD_PREFIX.length).trim();
    reason = r === "" ? UNKNOWN : r;
  }
  return reason;
}

/**
 * The `open` argv for a run. `newInstance` (default true) puts `-n` first;
 * `--into` passes false so the file reaches the running instance.
 * @param {{ runDirReal: string, nonce: string, bundle: string, file?: string, newInstance?: boolean }} input
 * @returns {string[]}
 */
export function openArgv({ runDirReal, nonce, bundle, file, newInstance = true }) {
  const env = [
    `MDPRO_VERIFY_RUN=${runDirReal}`,
    `MDPRO_VERIFY_NONCE=${nonce}`,
    `HOME=${runDirReal}`,
    `CFFIXED_USER_HOME=${runDirReal}`,
  ];
  const argv = [...(newInstance ? ["-n"] : []), ...env.flatMap((kv) => ["--env", kv]), "-a", bundle];
  return typeof file === "string" && file !== "" ? [...argv, file] : argv;
}

/**
 * Judge a published `instance.json` against what this launch expects.
 * `expected.pid` undefined skips the pid comparison (`--via open`: there is
 * no handle; the pid is cross-checked against process facts instead).
 * @param {string} text
 * @param {{ nonce: string, buildId: string, pid?: number }} expected
 * @returns {{ ok: true, pid: number } | { ok: false, reason: string }}
 */
export function checkHandshake(text, expected) {
  let inst;
  try {
    inst = JSON.parse(text);
  } catch {
    return { ok: false, reason: "instance.json unreadable" };
  }
  if (inst === null || typeof inst !== "object") return { ok: false, reason: "instance.json unreadable" };
  if (inst.nonce !== expected.nonce) return { ok: false, reason: "handshake mismatch: nonce" };
  if (inst.buildId !== expected.buildId) return { ok: false, reason: "handshake mismatch: buildId" };
  const pidOk = Number.isSafeInteger(inst.pid) && inst.pid > 0;
  if (!pidOk || (expected.pid !== undefined && inst.pid !== expected.pid)) {
    return { ok: false, reason: "handshake mismatch: pid" };
  }
  return { ok: true, pid: inst.pid };
}

/** @param {unknown} e @returns {string} an error's `code`, or "error" */
export function errCode(e) {
  const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
  return typeof code === "string" && code !== "" ? code : "error";
}

/** @param {unknown} e @returns {string} */
export const errMessage = (e) => (e instanceof Error ? e.message : String(e));

/**
 * A line printer that redacts the run's secrets, and the verdict builder.
 * @param {{ out: (line: string) => void }} deps
 * @param {string[]} secrets mutable; a secret pushed later is redacted from then on
 */
export function reporter(deps, secrets) {
  const lines = [];
  const say = (/** @type {string} */ line) => {
    const safe = redact(line, { secrets });
    lines.push(safe);
    deps.out(safe);
  };
  /**
   * @param {"pass" | "fail" | "driver failure" | "NOT VERIFIED"} kind
   * @param {string} [reason]
   * @returns {{ exit: 0 | 1, lines: string[] }}
   */
  const verdict = (kind, reason) => finish(formatVerdict(kind, reason, { secrets }));
  /**
   * Print a ready-made verdict line (a `format*Refusal`) as the last line.
   * @param {string} line @returns {{ exit: 0 | 1, lines: string[] }}
   */
  const finish = (line) => {
    say(line);
    return { exit: line === "verdict: pass" ? 0 : 1, lines };
  };
  return { say, verdict, finish, lines };
}
