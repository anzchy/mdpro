/**
 * Purpose: Liveness facts for the launcher (ADR-0047 WI-003 WI-4): a pid's
 * start time, its executable's realpath, a scan for running verify main
 * binaries, and a probe of a unix socket (`si.sock`).
 *
 * Pipeline: `ps -p <pid> -o lstart=` → `parseLstart` → `readStartTime`;
 *   `lsof -a -p <pid> -d txt -Fn` → `parseLsofTxt` → realpath → `readExe`;
 *   `ps -axww -o pid=,comm=` → `parseVerifyScan` → `scanVerifyPids`;
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
 * - Verify scan (D82-WI-6, M5): match on the `comm=` column, not `command=`.
 *   A process whose *arguments* name the verify binary (`grep …/tauri-app`,
 *   an editor with the path open) must not count. Probe PF-M5-0 on macOS
 *   (Darwin 25.3.0, 2026-10-10): `comm` prints the exact spawned path,
 *   spaces included and not realpathed, but with `argv0: "x"` it prints `x`.
 *   So `comm` is `argv[0]`, not the executable: membership depends only on
 *   `argv[0]`, never on later arguments. A process started with a spoofed
 *   `argv0` can enter or leave the scan. A true executable check (the `lsof`
 *   `txt` entry `readExe` reads) costs one `lsof` per process; not adopted.
 *   `comm` carries no arguments, so `SCAN_LINE_RE` keeps `(\S.*)` and paths
 *   with spaces are supported. `VERIFY_MAIN_RE` is anchored with `$`: the
 *   column is the whole path, so `…/tauri-app foo/bar` is another file, not
 *   the verify binary. (Fixture F-05 was re-recorded without `--x` for this,
 *   D82 finding 9 / rule 12.)
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
const VERIFY_MAIN_RE = /\/mdpro-verify\.app\/Contents\/MacOS\/tauri-app$/;

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
 * @param {string} text stdout of `ps -axww -o pid=,comm=`
 * @returns {number[] | "unknown"} pids whose argv[0] is a verify main binary
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
 * @returns {Promise<number[] | "unknown">} pids whose argv[0] is a verify main
 *   binary; arguments are never matched (see Key decisions)
 */
export async function scanVerifyPids() {
  const out = await run("ps", ["-axww", "-o", "pid=,comm="]);
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
