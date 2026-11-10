#!/usr/bin/env node
/**
 * Purpose: the platform advisory's checker (MIG-003b, #754). It reads a saved `cargo test` log and exits non-zero
 * unless the run really tested something:
 *   node scripts/ci/cargo-test-summary.mjs <cargo test log>
 *
 * Key decisions:
 * - It counts only libtest summary lines anchored at line start (`test result: ok|FAILED. N passed; M failed`), after
 *   stripping SGR colour, because dtolnay/rust-toolchain sets CARGO_TERM_COLOR=always.
 * - It fails closed: there is no summary line, a summary is unreadable or `FAILED`, or a summary counts failures, or
 *   zero tests passed in total. Ignored tests never count.
 * - On failure it prints one decisive line to stderr.
 *
 * @coordinates-with .github/workflows/platform-advisory.yml — runs it on the file its cargo test step tees.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "test result:";
const SGR = /\x1b\[[0-9;]*m/g;
const SUMMARY = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/;

/** The verdict on one `cargo test` log: `ok` only when every summary passed and at least one test ran. */
export function checkCargoTestLog(text) {
  let passed = 0;
  let failed = 0;
  let summaries = 0;
  let fault = null;
  for (const line of text.replace(SGR, "").split("\n")) {
    if (!line.startsWith(PREFIX)) continue;
    summaries += 1;
    const m = SUMMARY.exec(line);
    if (!m) {
      fault ??= `cannot read a summary: ${line.trimEnd()}`;
      continue;
    }
    passed += Number(m[2]);
    failed += Number(m[3]);
    if (m[1] === "FAILED" || Number(m[3]) > 0) fault ??= `a test target failed: ${line.trimEnd()}`;
  }
  const result = (message) => ({ ok: message === "", passed, failed, message });
  if (summaries === 0) return result("the log has no `test result:` line");
  if (fault !== null) return result(fault);
  if (passed === 0) return result("cargo test ran zero tests in total");
  return result("");
}

/** The CLI: 0 when the log at `argv[0]` passes, 1 (with one stderr line) otherwise. */
export function main(argv) {
  const [file] = argv;
  if (!file) return fail("usage: cargo-test-summary.mjs <cargo test log>");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return fail(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (text === "") return fail(`${file} is empty`);
  const result = checkCargoTestLog(text);
  if (!result.ok) return fail(result.message);
  process.stdout.write(`cargo-test-summary: ${result.passed} tests passed\n`);
  return 0;
}

function fail(line) {
  process.stderr.write(`cargo-test-summary: ${line}\n`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
