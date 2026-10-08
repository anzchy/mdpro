/**
 * Purpose: Liveness facts for the launcher (ADR-0047 WI-003 WI-4): a pid's
 * start time, its executable's realpath, a scan for running verify main
 * binaries, and a probe of a unix socket (`si.sock`).
 *
 * Pipeline: `ps -p <pid> -o lstart=` → `parseLstart` → `readStartTime`;
 *   `lsof -a -p <pid> -d txt -Fn` → `parseLsofTxt` → realpath → `readExe`;
 *   `ps -axww -o pid=,command=` → `parseVerifyScan` → `scanVerifyPids`;
 *   `net.connect(sock)` → live | `classifySocketError` → `probeSocket`.
 *
 * Key decisions:
 * - Parsers are pure functions over captured text; only the spawn/connect
 *   wrappers touch the boundary, so the parsers are tested on fixtures and
 *   the wrappers against the real `ps` / `lsof` / socket.
 * - Totality, conservative default: anything that does not parse is
 *   `"unknown"`, which callers treat as a refusal, never as "dead".
 * - `lstart` is kept raw (C locale, double space before a 1-digit day) and
 *   compared as a string: no epoch conversion, so no timezone sensitivity.
 *   `ps` runs with `LC_ALL=C` in a fresh env; `process.env` is never assigned.
 * - The exe comes from the first `txt` entry of `lsof` (the main binary;
 *   later entries are dyld and libraries) and must be absolute.
 * - Socket: a connect that succeeds is `live`; `ECONNREFUSED` is `stale` (a
 *   file with no listener); `ENOENT` is `absent`; any other error or a
 *   timeout is `unknown`.
 *
 * @module scripts/control/procFacts
 * @coordinates-with scripts/control/ownership.mjs (consumes these facts)
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const UNKNOWN = "unknown";
const PROBE_TIMEOUT_MS = 1000;
const EXEC_TIMEOUT_MS = 5000;
const LSTART_RE =
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d\d:\d\d:\d\d \d{4}$/;
const SCAN_LINE_RE = /^\s*(\d+)\s+(\S.*)$/;
const VERIFY_MAIN_RE = /\/mdpro-verify\.app\/Contents\/MacOS\/tauri-app(?:\s|$)/;

/**
 * @param {string} text stdout of `ps -p <pid> -o lstart=`
 * @returns {string} the raw C-locale start time, or "unknown"
 */
export function parseLstart(text) {
  const line = String(text).trim();
  return LSTART_RE.test(line) ? line : UNKNOWN;
}

/**
 * @param {string} text stdout of `lsof -a -p <pid> -d txt -Fn`
 * @returns {string} the first `txt` entry's absolute path, or "unknown"
 */
export function parseLsofTxt(text) {
  let fd = "txt";
  for (const line of String(text).split("\n")) {
    if (line.startsWith("f")) fd = line.slice(1);
    if (!line.startsWith("n") || fd !== "txt") continue;
    const name = line.slice(1);
    return name.startsWith("/") ? name : UNKNOWN;
  }
  return UNKNOWN;
}

/**
 * @param {string} text stdout of `ps -axww -o pid=,command=`
 * @returns {number[] | "unknown"} pids of running verify main binaries
 */
export function parseVerifyScan(text) {
  const pids = [];
  for (const line of String(text).split("\n")) {
    if (line.trim() === "") continue;
    const m = SCAN_LINE_RE.exec(line);
    if (!m) return UNKNOWN;
    if (VERIFY_MAIN_RE.test(m[2])) pids.push(Number(m[1]));
  }
  return pids;
}

/**
 * @param {{ code?: string } | "timeout"} error a connect error, or "timeout"
 * @returns {"stale" | "absent" | "unknown"}
 */
export function classifySocketError(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "ECONNREFUSED") return "stale";
  if (code === "ENOENT") return "absent";
  return UNKNOWN;
}

/**
 * Connect to a unix socket once and classify the result. Never unlinks.
 * @param {string} sockPath
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<"live" | "stale" | "absent" | "unknown">}
 */
export function probeSocket(sockPath, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(sockPath);
    const done = (verdict) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(verdict);
    };
    const timer = setTimeout(() => done(classifySocketError("timeout")), timeoutMs);
    socket.once("connect", () => done("live"));
    socket.once("error", (error) => done(classifySocketError(error)));
  });
}

/**
 * @param {number} pid
 * @returns {Promise<string>} the raw C-locale start time, or "unknown"
 */
export async function readStartTime(pid) {
  if (!isPid(pid)) return UNKNOWN;
  const out = await run("ps", ["-p", String(pid), "-o", "lstart="]);
  return out === null ? UNKNOWN : parseLstart(out);
}

/**
 * @param {number} pid
 * @returns {Promise<string>} the realpath of the pid's main binary, or "unknown"
 */
export async function readExe(pid) {
  if (!isPid(pid)) return UNKNOWN;
  const out = await run("lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"]);
  const exe = out === null ? UNKNOWN : parseLsofTxt(out);
  if (exe === UNKNOWN) return UNKNOWN;
  try {
    return await fs.promises.realpath(exe);
  } catch {
    return UNKNOWN;
  }
}

/**
 * @returns {Promise<number[] | "unknown">} pids of running verify main binaries
 */
export async function scanVerifyPids() {
  const out = await run("ps", ["-axww", "-o", "pid=,command="]);
  return out === null ? UNKNOWN : parseVerifyScan(out);
}

function isPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

/** stdout of a successful run, or null on any failure (read as "unknown"). */
function run(cmd, args) {
  const env = { ...process.env, LC_ALL: "C" };
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout: EXEC_TIMEOUT_MS }, (error, stdout) =>
      resolve(error ? null : String(stdout)),
    );
  });
}
