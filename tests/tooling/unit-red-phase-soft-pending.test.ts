// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");

async function scenario(name: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-async-cases.mjs");
  const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>(done => {
    execFile(process.execPath, [script, name, variant, repo], { cwd: repo, encoding: "utf8", timeout: 90_000 }, (error, stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout, stderr });
    });
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as {
    red: { status: number; kind: string | null; output: string;
      evidence: { failureCount: number | null; attempt: { pendingAtDelivery?: boolean; nonBodyBeforePending?: boolean; nonBody?: boolean } | null;
        phaseFailures: string[] | null; unhandledErrors: number | null } };
    green: { status: number; verdict: string | null } | null;
  };
}

describe.skipIf(!receiptSuites)("D301 FX2 delayed soft cleanup after pending snapshot", () => {
  it("refuses a body RED paired with a later soft cleanup failure", async () => {
    const seen = await scenario("lateSoftPending", "mixed");
    expect(seen.red.evidence.failureCount).toBe(2);
    expect(seen.red.evidence.attempt?.pendingAtDelivery).toBe(true);
    expect(seen.red.evidence.attempt?.nonBodyBeforePending).toBe(false);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
    expect(seen.red.output).toContain("nonBody=true");
  });
  it("accepts passing soft cleanup beside a body RED, then verifies HELD", async () => {
    const seen = await scenario("lateSoftPending", "twin");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toMatchObject({ status: 0, verdict: "SEPARATION-HELD" });
  });
  it("still refuses a delayed hard rejection beside a body RED", async () => {
    const seen = await scenario("lateHardPending", "mixed");
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
});
