// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 90_000 });
// Keep the recorded configuration line intact; this later setting covers the child budget.
vi.setConfig({ testTimeout: 180_000 });
const repo = resolve(import.meta.dirname, "../..");

async function scenario(phase: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-fix1-late-cases.mjs");
  const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [script, phase, variant, repo], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
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
    delivered: boolean;
    registered: boolean;
    bReleased: boolean;
  };
}

function childLog(seen: Awaited<ReturnType<typeof scenario>>) {
  return (seen.red as typeof seen.red & { vitestLog: string }).vitestLog;
}

describe.skipIf(!receiptSuites)("D301 fix1 late async assertion after result delivery", () => {
  it.each(["finish", "timer"])("refuses %s late rejection beside B's body RED", async phase => {
    const seen = await scenario(phase, "failing");
    expect(seen.delivered).toBe(true);
    expect(seen.registered).toBe(true);
    expect(seen.bReleased).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
    expect(childLog(seen)).toContain("Unhandled Rejection");
    expect(childLog(seen)).not.toContain("Test body timed out");
    expect(childLog(seen)).toMatch(/FAIL\s+tests\/(?:case|b)\.test\.ts > B/);
  });
  it.each(["finish", "timer"])("accepts %s passing twin and verifies HELD", async phase => {
    const seen = await scenario(phase, "passing");
    expect(seen.delivered).toBe(true);
    expect(seen.registered).toBe(true);
    expect(seen.bReleased).toBe(true);
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toMatchObject({ status: 0, verdict: "SEPARATION-HELD" });
    expect(childLog(seen)).not.toContain("Unhandled Rejection");
    expect(childLog(seen)).toMatch(/FAIL\s+tests\/(?:case|b)\.test\.ts > B/);
  });
});
