/**
 * Purpose: launch one device bundle by path and archive the observed identity.
 * No process is killed, quit, or cleaned here. The archive always describes this run.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readExe } from "../control/procFacts.mjs";
import { main as devReleaseId } from "../release/devReleaseId.mjs";
import { evaluateIdentity } from "./identityChecks.mjs";
import { parseIdentityOptions } from "./identityOptions.mjs";

const exec = promisify(execFile);
const LOG_PATH = path.join(process.env.HOME ?? "", ".mdpro", "mdpro.log");
const TIMEOUT_MS = 20_000;
const POLL_MS = 100;

async function atomicReport(file, contents) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, contents, { mode: 0o600 });
  try { await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}

async function bundleExists(bundle) {
  try { return (await fs.stat(bundle)).isDirectory() && bundle.endsWith(".app"); }
  catch { return false; }
}

/** Select only mdpro's Tauri main binaries from the `ps pid=,comm=` column. */
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

async function scanProcesses() {
  let stdout;
  try { ({ stdout } = await exec("ps", ["-axww", "-o", "pid=,comm="], { env: { ...process.env, LC_ALL: "C" }, timeout: 5000 })); }
  catch { return [{ pid: -1, exe: "unknown", birthMs: 0 }]; }
  const candidates = parseMainPids(stdout);
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
  if (earlyOut) await atomicReport(earlyOut, "IN PROGRESS\n");
  const finish = async (result) => {
    const report = `${result.lines.join("\n")}\n`;
    if (earlyOut) await atomicReport(earlyOut, report);
    return { ...result, report };
  };
  let options;
  try { options = await parseIdentityOptions(args, deps); }
  catch { return finish({ lines: ["[FAIL] bundle", "[FAIL] process", "[FAIL] releaseId", "[SKIPPED] window"], exit: 1 }); }
  const exists = await bundleExists(options.bundlePath);
  if (!exists) return finish(evaluateIdentity({ bundlePath: options.bundlePath, bundleExists: false,
    expectedReleaseId: options.expectedReleaseId, processes: [], records: [] }));

  const before = await deps.scanProcesses();
  if (!options.checkOnly && before.length !== 0) return finish(evaluateIdentity({ bundlePath: options.bundlePath,
    bundleExists: true, expectedReleaseId: options.expectedReleaseId, processes: before, records: [] }));

  const cursor = options.checkOnly ? null : await deps.logCursor();
  if (!options.checkOnly) {
    try { await deps.launch(["-n", options.bundlePath, ...(options.filePath ? [options.filePath] : [])]); }
    catch { return finish(evaluateIdentity({ bundlePath: options.bundlePath, bundleExists: true,
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
  return finish(evaluateIdentity({ bundlePath: options.bundlePath, bundleExists: true,
    expectedReleaseId: options.expectedReleaseId, processes, records }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runIdentity(process.argv.slice(2)).then(
    ({ report, exit }) => { process.stdout.write(report); process.exitCode = exit; },
    () => { process.stdout.write("[FAIL] bundle\n[FAIL] process\n[FAIL] releaseId\n[SKIPPED] window\n"); process.exitCode = 1; },
  );
}
