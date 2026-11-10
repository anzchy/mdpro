// @vitest-environment node
/**
 * MIG-003b (#754): the platform advisory's checker, scripts/ci/cargo-test-summary.mjs. A file in, an exit code out:
 * it fails a `cargo test` log with no `test result:` line, with any `FAILED` summary, or with zero tests run in total.
 */
import { describe, expect, it } from "vitest";
import { checkCargoTestLog } from "../../scripts/ci/cargo-test-summary.mjs";

describe("MIG-003b checkCargoTestLog", () => {
  it("passes one ok summary and counts its passed tests, not its ignored ones", () => {
    expect(checkCargoTestLog("test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.50s\n"))
      .toMatchObject({ ok: true, passed: 12, failed: 0 });
  });
});

describe("MIG-003b checkCargoTestLog failures", () => {
  it("fails a FAILED summary and names it", () => {
    const result = checkCargoTestLog("test result: FAILED. 3 passed; 1 failed\n");
    expect(result).toMatchObject({ ok: false, passed: 3, failed: 1 });
    expect(result.message).toContain("test result: FAILED. 3 passed; 1 failed");
  });
});

const OK = (n: number) => `test result: ok. ${n} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s`;

describe("MIG-003b checkCargoTestLog across targets", () => {
  it("fails an ok and a FAILED target together, in either order", () => {
    const bad = "test result: FAILED. 3 passed; 1 failed";
    expect([checkCargoTestLog(`${OK(5)}\n${bad}\n`).ok, checkCargoTestLog(`${bad}\n${OK(5)}\n`).ok]).toEqual([false, false]);
  });

  it("fails when every target ran zero tests, ignored ones not counting", () => {
    const result = checkCargoTestLog("test result: ok. 0 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out\n".repeat(2));
    expect(result).toMatchObject({ ok: false, passed: 0, failed: 0 });
    expect(result.message).toMatch(/zero tests/);
  });
});

describe("MIG-003b checkCargoTestLog without a summary", () => {
  it("fails a log with no test result line, such as a compile error", () => {
    const result = checkCargoTestLog("   Compiling tauri-app v0.4.0\nerror[E0425]: cannot find value `x` in this scope\nerror: could not compile `tauri-app`\n");
    expect(result).toMatchObject({ ok: false, passed: 0 });
    expect(result.message).toMatch(/no `test result:` line/);
  });
});

describe("MIG-003b checkCargoTestLog fails closed on a summary it cannot read", () => {
  it("fails a FAILED or ok summary whose counts do not parse, even beside good ones", () => {
    const failed = checkCargoTestLog(`${OK(12)}\ntest result: FAILED.\n${OK(5)}\n`);
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain("test result: FAILED.");
    const ok = checkCargoTestLog(`${OK(12)}\ntest result: ok.\n`);
    expect(ok.ok).toBe(false);
    expect(ok.message).toContain("cannot read");
  });
});

describe("MIG-003b checkCargoTestLog inconsistent summaries", () => {
  it("fails an ok summary that still counts failures", () => {
    const result = checkCargoTestLog("test result: ok. 4 passed; 2 failed; 0 ignored\n");
    expect(result).toMatchObject({ ok: false, passed: 4, failed: 2 });
    expect(result.message).toContain("2 failed");
  });
});

import fs from "node:fs";
import path from "node:path";

const FIXTURE = fs.readFileSync(path.resolve(__dirname, "..", "fixtures", "mig003b", "cargo-test-multi-target.log"), "utf8");
const FIXTURE_PASSED = 2 + 0 + 4 + 7 + 0;

describe("MIG-003b checkCargoTestLog over a whole run", () => {
  it("sums the passed tests of every target, a zero-test doc-test target included", () => {
    expect(checkCargoTestLog(FIXTURE)).toEqual({ ok: true, passed: FIXTURE_PASSED, failed: 0, message: "" });
  });

  it("reads the same run with CRLF line endings", () => {
    expect(checkCargoTestLog(FIXTURE.replace(/\n/g, "\r\n"))).toEqual({ ok: true, passed: FIXTURE_PASSED, failed: 0, message: "" });
  });
});

describe("MIG-003b checkCargoTestLog line anchoring", () => {
  it("does not count a summary quoted mid-line", () => {
    expect(checkCargoTestLog("note: test result: ok. 9 passed; 0 failed; 0 ignored\n")).toMatchObject({ ok: false, passed: 0 });
  });
});

/** Wrap each summary's verdict in SGR colour, as libtest prints it under CARGO_TERM_COLOR=always (dtolnay/rust-toolchain sets it). */
const coloured = (text: string) => text.replace(/^test result: (ok|FAILED)\./gm, (_m, verdict: string) => `test result: \x1b[${verdict === "ok" ? 32 : 31}m${verdict}\x1b[0m.`);

describe("MIG-003b checkCargoTestLog with colour", () => {
  it("reads coloured summaries: the whole run passes, and a coloured FAILED still fails", () => {
    expect(coloured(FIXTURE)).toContain("\x1b[32mok\x1b[0m.");
    expect(checkCargoTestLog(coloured(FIXTURE))).toEqual({ ok: true, passed: FIXTURE_PASSED, failed: 0, message: "" });
    expect(checkCargoTestLog(coloured(`${FIXTURE}test result: FAILED. 3 passed; 1 failed\n`))).toMatchObject({ ok: false, failed: 1 });
  });
});

import { execFile } from "node:child_process";
import os from "node:os";
import { afterAll } from "vitest";
import { spawnBudget } from "../support/spawnBudget";

const CLI = path.resolve(__dirname, "..", "..", "scripts", "ci", "cargo-test-summary.mjs");
const CLI_TIMEOUT_MS = 10_000;
const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mig003b-cli-"));
afterAll(() => fs.rmSync(cliRoot, { recursive: true, force: true }));
let cliCase = 0;

/** Run the CLI as the workflow does, on `text` written to a file (or on `args` as given), and collect its exit and stderr lines. */
function runCli(text: string | null, args?: string[]): Promise<{ status: number | null; stderr: string[] }> {
  const file = path.join(cliRoot, `case-${cliCase++}.log`);
  if (text !== null) fs.writeFileSync(file, text);
  return new Promise((done) => {
    execFile(process.execPath, [CLI, ...(args ?? [file])], { encoding: "utf8", timeout: CLI_TIMEOUT_MS, killSignal: "SIGKILL" }, (error, _stdout, stderr) => {
      const status = error ? (typeof error.code === "number" ? error.code : null) : 0;
      done({ status, stderr: stderr.split("\n").filter((l) => l !== "") });
    });
  });
}

describe("MIG-003b cargo-test-summary CLI", () => {
  it("exits 0 with no stderr on a passing run, and 1 with one stderr line on each failing verdict", async () => {
    const results = await Promise.all([
      runCli(FIXTURE),
      runCli(`${FIXTURE}test result: FAILED. 3 passed; 1 failed\n`),
      runCli("test result: ok. 0 passed; 0 failed; 3 ignored\n"),
      runCli("error: could not compile `tauri-app`\n"),
    ]);
    expect(results.map((r) => r.status)).toEqual([0, 1, 1, 1]);
    expect(results.map((r) => r.stderr.length)).toEqual([0, 1, 1, 1]);
    expect(results[1].stderr[0]).toContain("FAILED");
    expect(results[2].stderr[0]).toContain("zero tests");
    expect(results[3].stderr[0]).toContain("no `test result:` line");
  }, spawnBudget(45));

  it("exits 1 with one stderr line on a missing file, an empty file and no argument", async () => {
    const results = await Promise.all([runCli(null), runCli(""), runCli(null, [])]);
    expect(results.map((r) => [r.status, r.stderr.length])).toEqual([[1, 1], [1, 1], [1, 1]]);
  }, spawnBudget(32));
});
