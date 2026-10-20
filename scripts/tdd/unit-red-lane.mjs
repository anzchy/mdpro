import { mkdtempSync, readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEST_FILE = /^tests\/(?:[^/]+\/)*[^/]+\.test\.(?:ts|tsx)$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function usageError(message) {
  const error = new Error(message);
  error.code = 64;
  return error;
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
  return validateFiles(process.cwd(), files);
}

function countsFromReport(report, files, cwd) {
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== files.length) {
    throw usageError("Vitest did not report exactly the selected files.");
  }
  const wanted = new Set(files);
  let failed = 0;
  let passed = 0;
  let total = 0;
  for (const suite of report.testResults) {
    const name = relative(cwd, suite.name || "").replaceAll("\\", "/");
    if (!wanted.delete(name) || !Array.isArray(suite.assertionResults)) {
      throw usageError(`Vitest collected an unexpected or duplicate suite: ${name}.`);
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

function main() {
  const files = selectedFiles();
  const cwd = process.cwd();
  const outputDir = mkdtempSync(join(tmpdir(), "mdpro-unit-red-run-"));
  const reportPath = join(outputDir, "vitest.json");
  const logPath = join(outputDir, "vitest.log");
  writeFileSync(`${process.env.MDPRO_UNIT_RED_MARKER}.log`, logPath, { mode: 0o600 });
  const args = [
    "exec", "vitest", "run", "--maxWorkers=2", "--coverage.enabled=false",
    "--reporter=default", "--reporter=json", `--outputFile.json=${reportPath}`,
    ...files,
  ];
  const run = spawnSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, VITEST_MAX_WORKERS: "2", MDPRO_HEAVY_LOCK_HELD: "" },
  });
  writeFileSync(logPath, `${run.stdout || ""}${run.stderr || ""}`);
  process.stderr.write(`[unit-red] log: ${logPath}\n`);
  if (run.error || run.signal || ![0, 1].includes(run.status)) {
    throw usageError("Vitest did not finish as a test run.");
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    throw usageError("Vitest JSON report is missing or unreadable.");
  }
  const counts = countsFromReport(report, files, cwd);
  const human = `${run.stdout || ""}\n${run.stderr || ""}`;
  if (/Unhandled Errors|unhandled rejection|unhandled error/i.test(human) ||
      (Array.isArray(report.unhandledErrors) && report.unhandledErrors.length)) {
    throw usageError("Vitest reported an unhandled error.");
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
