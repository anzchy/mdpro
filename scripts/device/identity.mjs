/**
 * Purpose: launch one device bundle by path and archive the observed identity.
 * No process is killed, quit, or cleaned here. A report path has one owner;
 * a refused contender prints FAIL and leaves the owner's archive untouched.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readExe } from "../control/procFacts.mjs";
import { main as devReleaseId } from "../release/devReleaseId.mjs";
import { evaluateIdentity } from "./identityChecks.mjs";
import { parseIdentityOptions } from "./identityOptions.mjs";
import { acquireReportLock } from "./reportLock.mjs";

const exec = promisify(execFile);
const LOG_PATH = path.join(process.env.HOME ?? "", ".mdpro", "mdpro.log");
const TIMEOUT_MS = 20_000;
const POLL_MS = 100;

async function bundleExists(bundle) {
  try { return (await fs.stat(bundle)).isDirectory() && bundle.endsWith(".app"); }
  catch { return false; }
}

/** Legacy parser kept for captured process-table fixtures; never used for identity discovery. */
export function parseMainPids(stdout) {
  const candidates = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) return null;
    // Include an unbundled `tauri dev` main, but never a bundled sidecar.
    if (/(?:\/mdpro[^/]*\.app\/Contents\/MacOS\/tauri-app|\/src-tauri\/target\/(?:[^/]+\/)?debug\/tauri-app)$/i.test(match[2])) {
      candidates.push(Number(match[1]));
    }
  }
  return candidates;
}

const MAIN_EXE_RE = /(?:\/mdpro[^/]*\.app\/Contents\/MacOS\/tauri-app|\/src-tauri\/target\/(?:[^/]+\/)?debug\/tauri-app)$/i;

/** Select every mdpro main from each PID's first lsof txt path, independent of argv0. */
export function parseExecutableTable(stdout) {
  const candidates = [];
  let pid = null;
  let firstPathSeen = false;
  let txtSeen = false;
  let sawField = false;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("p")) {
      if (pid !== null && !firstPathSeen) return null;
      const value = Number(line.slice(1));
      if (!Number.isSafeInteger(value) || value <= 0) return null;
      pid = value;
      firstPathSeen = false;
      txtSeen = false;
      sawField = true;
    } else if (line === "ftxt") {
      if (pid === null) return null;
      txtSeen = true;
    } else if (line.startsWith("n")) {
      if (pid === null || !txtSeen) return null;
      if (!firstPathSeen) {
        const exe = line.slice(1);
        if (!exe.startsWith("/")) return null;
        if (MAIN_EXE_RE.test(exe)) candidates.push(pid);
        firstPathSeen = true;
      }
    } else {
      return null;
    }
  }
  return pid !== null && !firstPathSeen ? null : sawField ? candidates : null;
}

/** Enumerate real executable identities without trusting the argv0-derived comm column. */
export async function scanProcesses() {
  let stdout;
  try { ({ stdout } = await exec("lsof", ["-nP", "-d", "txt", "-Fpn"], { env: { ...process.env, LC_ALL: "C" }, timeout: 5000, maxBuffer: 32 * 1024 * 1024 })); }
  catch { return [{ pid: -1, exe: "unknown", birthMs: 0 }]; }
  const candidates = parseExecutableTable(stdout);
  if (candidates === null) return [{ pid: -1, exe: "unknown", birthMs: 0 }];
  return Promise.all(candidates.map(async (pid) => {
    const exe = await readExe(pid);
    let birthMs = 0;
    try {
      const { stdout: started } = await exec("ps", ["-p", String(pid), "-o", "lstart="], { env: { ...process.env, LC_ALL: "C" }, timeout: 5000 });
      birthMs = Date.parse(started.trim());
    } catch { /* unknown birth fails check-only freshness */ }
    return { pid, exe, birthMs: Number.isFinite(birthMs) ? birthMs : 0 };
  }));
}

async function logCursor() {
  try { const stat = await fs.stat(LOG_PATH); return { ino: stat.ino, size: stat.size }; }
  catch { return { ino: null, size: 0 }; }
}

async function readLog(cursor) {
  try {
    const stat = await fs.stat(LOG_PATH);
    const bytes = await fs.readFile(LOG_PATH);
    const from = cursor?.ino === stat.ino && bytes.length >= cursor.size ? cursor.size : 0;
    const text = bytes.subarray(from).toString("utf8");
    return text.split("\n").flatMap((line) => {
      try { return line.trim() ? [JSON.parse(line)] : []; }
      catch { return []; }
    });
  } catch { return []; }
}

async function launch(args) { await exec("open", args, { timeout: 5000 }); }
const defaults = {
  resolveDefault: () => devReleaseId([]), scanProcesses, logCursor, readLog, launch,
  now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs: TIMEOUT_MS,
};

function recordTime(record) {
  if (typeof record.ts === "number") return record.ts;
  const time = Date.parse(record.ts);
  return Number.isFinite(time) ? time : 0;
}

/** @param {string[]} args @param {Partial<typeof defaults>} [injected] */
export async function runIdentity(args, injected = {}) {
  const deps = { ...defaults, ...injected };
  const outIndex = args.indexOf("--out");
  const earlyOut = outIndex >= 0 && path.isAbsolute(args[outIndex + 1] ?? "") ? args[outIndex + 1] : undefined;
  const refusal = { lines: ["[FAIL] bundle", "[FAIL] process", "[FAIL] releaseId", "[SKIPPED] window"], exit: 1 };
  const lock = earlyOut ? await acquireReportLock(earlyOut) : null;
  if (earlyOut && !lock) return { ...refusal, report: `${refusal.lines.join("\n")}\n` };
  try {
    if (earlyOut) await deps.afterLock?.(lock);
    const finish = async (result) => {
      const report = `${result.lines.join("\n")}\n`;
      if (earlyOut) {
        await deps.beforeCommit?.(lock);
        if (!await lock.commit(report)) return { ...refusal, report: `${refusal.lines.join("\n")}\n` };
      }
      return { ...result, report };
    };
    let options;
    try { options = await parseIdentityOptions(args, deps); }
    catch { return await finish(refusal); }
    const exists = await bundleExists(options.bundlePath);
    if (!exists) return await finish(evaluateIdentity({ bundlePath: options.bundlePath, bundleExists: false,
      expectedReleaseId: options.expectedReleaseId, processes: [], records: [] }));

    const before = await deps.scanProcesses();
    if (!options.checkOnly && before.length !== 0) return await finish(evaluateIdentity({ bundlePath: options.bundlePath,
      bundleExists: true, expectedReleaseId: options.expectedReleaseId, processes: before, records: [] }));
    if (options.checkOnly && before.length !== 1) return await finish(evaluateIdentity({ bundlePath: options.bundlePath,
      bundleExists: true, expectedReleaseId: options.expectedReleaseId, processes: before, records: [] }));

    const cursor = options.checkOnly ? null : await deps.logCursor();
    if (!options.checkOnly) {
      try { await deps.launch(["-n", options.bundlePath, ...(options.filePath ? [options.filePath] : [])]); }
      catch { return await finish(evaluateIdentity({ bundlePath: options.bundlePath, bundleExists: true,
        expectedReleaseId: options.expectedReleaseId, processes: [], records: [] })); }
    }
    const deadline = deps.now() + deps.timeoutMs;
    let records = [];
    do {
      records = await deps.readLog(cursor);
      if (options.checkOnly) records = records.filter((record) => recordTime(record) >= before[0]?.birthMs && before[0]?.birthMs > 0);
      if (records.some((record) => record.event === "app.ready")) break;
      if (deps.now() >= deadline) break;
      await deps.sleep(POLL_MS);
    } while (true);
    const processes = await deps.scanProcesses();
    return await finish(evaluateIdentity({ bundlePath: options.bundlePath, bundleExists: true,
      expectedReleaseId: options.expectedReleaseId, processes, records }));
  } finally {
    if (lock) await lock.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runIdentity(process.argv.slice(2)).then(
    ({ report, exit }) => { process.stdout.write(report); process.exitCode = exit; },
    () => { process.stdout.write("[FAIL] bundle\n[FAIL] process\n[FAIL] releaseId\n[SKIPPED] window\n"); process.exitCode = 1; },
  );
}
