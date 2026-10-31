// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");

async function scenario(name: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-async-cases.mjs");
  const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [script, name, variant, repo], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => done({ status, stdout, stderr }));
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as {
    red: { status: number; kind: string | null; output: string };
    green: { status: number; verdict: string | null } | null;
  };
}

describe.skipIf(!receiptSuites)("D301 fix1 scoped fixture provenance", () => {
  it("refuses a scoped setup throw", async () => {
    const seen = await scenario("scopedThrow", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it("refuses an awaited failing assertion in scoped setup", async () => {
    const seen = await scenario("scopedAwaited", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it("attributes a scoped unawaited assertion to the fixture", async () => {
    const seen = await scenario("scopedUnawaited", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
    expect(seen.red.output).toContain("origin=fixture");
  });
  it("accepts a passing scoped override beside a body RED and verifies HELD", async () => {
    const seen = await scenario("scopedThrow", "twin");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toMatchObject({ status: 0, verdict: "SEPARATION-HELD" });
  });
  it("refuses an earlier scoped setup failure even when A later passes on retry beside B's body RED", async () => {
    const seen = await scenario("scopedRetry", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it("retains a first-attempt non-body failure when retry passes beside B's body RED", async () => {
    const seen = await scenario("softRetryThenPass", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
});
