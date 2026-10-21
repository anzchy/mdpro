import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { phaseRunnerSource } from "./phase-runner-source.mjs";
const TEST_FILE = /^tests\/(?:[^/]+\/)*[^/]+\.test\.(?:ts|tsx)$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export default class UnitRedEvidenceReporter {
  constructor() { this.activeHooks = new Map(); }
  key(hook) { return `${hook.name}:${hook.entity.id}`; }
  onHookStart(hook) {
    const key = this.key(hook);
    this.activeHooks.set(key, (this.activeHooks.get(key) || 0) + 1);
  }
  onHookEnd(hook) {
    const key = this.key(hook);
    const count = this.activeHooks.get(key) || 0;
    if (count <= 1) this.activeHooks.delete(key);
    else this.activeHooks.set(key, count - 1);
  }
  onTestRunEnd(modules, unhandledErrors) {
    const phaseFailures = [];
    const unawaitedAssertions = [];
    const attemptProvenance = [];
    for (const module of modules) {
      if (module.errors().length) phaseFailures.push(`module:${module.moduleId}`);
      for (const suite of module.children.allSuites()) {
        if (suite.errors().length) phaseFailures.push(`suite:${suite.id}`);
      }
      for (const test of module.children.allTests()) {
        const attempts = test.meta().__unitRed?.attempts || [];
        for (const attempt of attempts) {
          attemptProvenance.push(`${test.name}[retry=${attempt.retry},repeat=${attempt.repeats},body=${Boolean(attempt.bodyFailure)},nonBody=${Boolean(attempt.nonBody)},origin=${(attempt.unawaitedOrigins || []).join("+") || "none"}]`);
        }
        if (attempts.some((attempt) => attempt.unawaited)) unawaitedAssertions.push(`test:${test.id}`);
        if (attempts.some((attempt) => attempt.nonBody && (!attempt.pendingAtDelivery || attempt.nonBodyBeforePending || attempt.nonBodyErrorObserved))) phaseFailures.push(`test:${test.id}`);
        if (test.result().state === "failed" && !attempts.some((attempt) => attempt.bodyFailure || attempt.countFailure)) {
          phaseFailures.push(`unattributed:${test.id}`);
        }
      }
    }
    writeFileSync(process.env.MDPRO_UNIT_RED_META_PATH, JSON.stringify({
      activeHooks: [...this.activeHooks],
      unhandledErrors: unhandledErrors.length,
      phaseFailures,
      unawaitedAssertions,
      attemptProvenance,
    }));
  }
}
export function usageError(message) {
  const error = new Error(message); error.code = 64; return error;
}
export function validateId(id) {
  if (typeof id !== "string" || !ID.test(id)) throw usageError("A valid --id is required.");
  return id;
}
export function validateFiles(cwd, input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 4) {
    throw usageError("Give one to four --test files under tests/.");
  }
  const root = realpathSync.native(cwd);
  const testsRoot = join(root, "tests");
  const files = [];
  for (const raw of input) {
    if (typeof raw !== "string" || raw !== raw.trim() || !TEST_FILE.test(raw) ||
        raw.includes("\\") || raw.includes(",") || /[\u0000-\u001f\u007f-\u009f*?[\]{}]/.test(raw) ||
        raw.split("/").some((part) => part === "." || part === ".." || part === "") ||
        /\.slow\.test\.(?:ts|tsx)$/.test(raw)) {
      throw usageError(`Invalid test path: ${JSON.stringify(raw)}.`);
    }
    let current = root;
    for (const component of raw.split("/")) {
      let names;
      try {
        names = readdirSync(current);
      } catch {
        throw usageError(`Test path does not exist: ${raw}.`);
      }
      if (!names.includes(component)) throw usageError(`Test path is not canonical or does not exist: ${raw}.`);
      current = join(current, component);
      if (lstatSync(current).isSymbolicLink()) throw usageError(`Symlinked test path is not supported: ${raw}.`);
    }
    if (!lstatSync(current).isFile()) throw usageError(`Test path is not a file: ${raw}.`);
    const real = realpathSync.native(current);
    if (!real.startsWith(testsRoot + sep) || real !== resolve(root, raw)) {
      throw usageError(`Test path is outside tests/ or not canonical: ${raw}.`);
    }
    if (files.includes(raw)) throw usageError(`Duplicate test path: ${raw}.`);
    files.push(raw);
  }
  return files;
}
function selectedFiles() {
  const markerPath = process.env.MDPRO_UNIT_RED_MARKER;
  const nonce = process.env.MDPRO_UNIT_RED_NONCE;
  const encoded = process.env.MDPRO_UNIT_RED_FILES;
  if (!markerPath || !nonce || !encoded) {
    throw usageError("Run this lane through scripts/tdd/red-receipt.mjs.");
  }
  let files;
  let marker;
  try {
    files = JSON.parse(encoded);
    if (!lstatSync(markerPath).isFile()) throw Error("marker is not a file");
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw usageError("Missing or invalid run marker; use scripts/tdd/red-receipt.mjs.");
  }
  if (marker.nonce !== nonce || JSON.stringify(marker.files) !== JSON.stringify(files)) {
    throw usageError("Run marker and file selection disagree; use scripts/tdd/red-receipt.mjs.");
  }
  return { files: validateFiles(process.cwd(), files), marker };
}
function checkReceiptSelection(marker, cwd) {
  if (!marker.receipt) return;
  let stored;
  try {
    const store = JSON.parse(readFileSync(join(cwd, ".claude/tdd-guardian/receipts.json"), "utf8"));
    stored = store.receipts.find((receipt) => receipt.id === marker.receipt.id);
  } catch {
    throw usageError("The receipt store changed during the focused run.");
  }
  if (!stored || stored.lane !== marker.receipt.lane || stored.red?.kind !== marker.receipt.redKind ||
      JSON.stringify(stored.test_files) !== JSON.stringify(marker.receipt.test_files)) {
    throw usageError("Receipt selection or identity changed during the focused run.");
  }
}
function phaseBarrier(name) {
  const directory = process.env.MDPRO_UNIT_RED_BARRIER_DIR;
  if (!directory) return;
  writeFileSync(join(directory, `${name}.ready`), "ready");
  const release = join(directory, `${name}.go`), deadline = Date.now() + 10_000;
  while (!existsSync(release)) {
    if (Date.now() > deadline) throw usageError(`Barrier ${name} timed out.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
function countsFromReport(report, files, cwd) {
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== files.length) throw usageError("Vitest did not report exactly the selected files.");
  const wanted = new Set(files);
  let failed = 0;
  let passed = 0;
  let total = 0;
  for (const suite of report.testResults) {
    const name = relative(cwd, suite.name || "").replaceAll("\\", "/");
    if (!wanted.delete(name) || !Array.isArray(suite.assertionResults)) {
      throw usageError(`Vitest collected an unexpected or duplicate suite: ${name}.`);
    }
    if (typeof suite.message === "string" && suite.message.trim()) {
      throw usageError(`Vitest reported a suite error in ${name}.`);
    }
    const statuses = suite.assertionResults.map((assertion) => assertion.status);
    if (statuses.some((status) => !["passed", "failed", "pending", "todo", "skipped"].includes(status))) {
      throw usageError(`Vitest reported an unknown assertion status in ${name}.`);
    }
    const filePassed = statuses.filter((status) => status === "passed").length;
    const fileFailed = statuses.filter((status) => status === "failed").length;
    if (filePassed + fileFailed === 0) throw usageError(`No assertions executed in ${name}.`);
    passed += filePassed;
    failed += fileFailed;
    total += statuses.length;
  }
  if (wanted.size || !total || report.numPassedTests !== passed || report.numFailedTests !== failed || report.numTotalTests !== total) {
    throw usageError("Vitest JSON counts disagree with the collected assertions.");
  }
  return { failed, passed, total };
}
function instrumentedConfig(cwd, runnerDir) {
  const base = ["vitest.config.ts", "vitest.config.mjs", "vitest.config.js"].find((name) => existsSync(join(cwd, name)));
  if (!base) throw usageError("The repository Vitest config is missing.");
  const runnerPath = join(runnerDir, "phase-runner.mjs");
  const configPath = join(runnerDir, "vitest.config.mjs");
  const runnersUrl = import.meta.resolve("vitest/runners");
  const getFnUrl = pathToFileURL(createRequire(runnersUrl).resolve("@vitest/runner")).href;
  writeFileSync(runnerPath, phaseRunnerSource(runnersUrl, getFnUrl));
  const viteUrl = import.meta.resolve("vite");
  writeFileSync(configPath, `import { loadConfigFromFile, mergeConfig } from ${JSON.stringify(viteUrl)}; const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, ${JSON.stringify(join(cwd, base))}); if (!loaded) throw Error("Vitest config did not load"); export default mergeConfig(loaded.config, { root: ${JSON.stringify(cwd)}, test: { runner: ${JSON.stringify(runnerPath)} } });\n`);
  return configPath;
}
function main() {
  const { files, marker } = selectedFiles();
  const cwd = process.cwd();
  checkReceiptSelection(marker, cwd);
  const outputDir = mkdtempSync(join(tmpdir(), "mdpro-unit-red-run-"));
  const reportPath = join(outputDir, "vitest.json");
  const metaPath = join(outputDir, "vitest-meta.json");
  const logPath = join(outputDir, "vitest.log");
  mkdirSync(join(cwd, ".claude/tdd-guardian"), { recursive: true });
  const runnerDir = mkdtempSync(join(cwd, ".claude/tdd-guardian/.mdpro-unit-red-"));
  let configPath;
  try { configPath = instrumentedConfig(cwd, runnerDir); }
  catch (error) { rmSync(runnerDir, { recursive: true, force: true }); throw error; }
  phaseBarrier("runner-created");
  writeFileSync(`${process.env.MDPRO_UNIT_RED_MARKER}.log`, logPath, { mode: 0o600 });
  const args = [
    "exec", "vitest", "run", `--config=${configPath}`, "--maxWorkers=2", "--coverage.enabled=false",
    "--reporter=default", "--reporter=json", `--reporter=${fileURLToPath(import.meta.url)}`, `--outputFile.json=${reportPath}`,
    ...files,
  ];
  const run = spawnSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, VITEST_MAX_WORKERS: "2", MDPRO_HEAVY_LOCK_HELD: "", MDPRO_UNIT_RED_FLOCK_FD: "", MDPRO_UNIT_RED_META_PATH: metaPath },
  });
  rmSync(runnerDir, { recursive: true, force: true });
  writeFileSync(logPath, `${run.stdout || ""}${run.stderr || ""}`);
  checkReceiptSelection(marker, cwd);
  phaseBarrier("lane-after-read");
  process.stderr.write(`[unit-red] log: ${logPath}\n`);
  if (run.error || run.signal || ![0, 1].includes(run.status)) {
    throw usageError("Vitest did not finish as a test run.");
  }
  let report;
  let meta;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch {
    throw usageError("Vitest JSON or execution evidence is missing or unreadable.");
  }
  const counts = countsFromReport(report, files, cwd);
  if (!Array.isArray(meta.activeHooks) || !Number.isInteger(meta.unhandledErrors) || !Array.isArray(meta.phaseFailures) || !Array.isArray(meta.unawaitedAssertions) || !Array.isArray(meta.attemptProvenance)) {
    throw usageError("Vitest execution evidence is malformed.");
  }
  if (meta.unawaitedAssertions.length) {
    const reason = `Vitest reported an unawaited async assertion (${meta.unawaitedAssertions.join(", ")})${meta.phaseFailures.length || meta.unhandledErrors ? "; nonBody=true" : ""}; provenance=${meta.attemptProvenance.join("; ")}.`;
    writeFileSync(`${process.env.MDPRO_UNIT_RED_MARKER}.reason`, reason);
    throw usageError(reason);
  }
  if (
      meta.activeHooks.length || meta.unhandledErrors > 0 || meta.phaseFailures.length) {
    const reason = `Vitest reported a failed hook or unhandled error${meta.phaseFailures.length || meta.unhandledErrors ? "; nonBody=true" : ""}; provenance=${meta.attemptProvenance.join("; ")}.`;
    writeFileSync(`${process.env.MDPRO_UNIT_RED_MARKER}.reason`, reason);
    throw usageError(reason);
  }
  if ((run.status === 0) !== (counts.failed === 0) || (run.status === 0 && report.success !== true)) {
    throw usageError("Vitest exit status and JSON assertions disagree.");
  }
  process.stdout.write(`Tests  ${counts.failed} failed | ${counts.passed} passed (${counts.total})\n`);
  return run.status;
}
if (process.argv[1] && realpathSync.native(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[unit-red] ${error.message}\n`);
    process.exitCode = 64;
  }
}
