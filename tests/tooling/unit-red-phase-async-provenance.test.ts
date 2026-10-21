// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));

async function scenario(name: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-async-cases.mjs");
  const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>(done => {
    execFile(process.execPath, [script, name, variant, repo], { cwd: repo, encoding: "utf8", timeout: 90_000 }, (error, stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout, stderr });
    });
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { red: { status: number; kind: string | null; output: string }; green: { status: number; verdict: string | null } | null };
}

describe.skipIf(!plugin)("D301 async assertion provenance", () => {
  it.each(["fixture", "beforeEach"])("refuses %s failure with passing body", async phase => {
    const seen = await scenario(phase, "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it.each(["fixture", "beforeEach"])("refuses %s failure beside a body RED", async phase => {
    const seen = await scenario(phase, "mixed");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it.each(["fixtureRejects", "beforeEachRejects"])("refuses setup %s failure alone and beside a body RED", async phase => {
    for (const variant of ["alone", "mixed"]) {
      const seen = await scenario(phase, variant);
      expect(seen.red.status).toBe(64);
      expect(seen.red.output).toContain("nonBody=true");
      expect(seen.red.output).toContain("unawaited async assertion");
    }
  });
  it("refuses beforeAll async failure", async () => {
    const seen = await scenario("beforeAll", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it.each(["afterEachRejects", "afterAllRejects"])("refuses %s async rejects failure alone and beside body RED", async phase => {
    for (const variant of ["alone", "mixed"]) {
      const seen = await scenario(phase, variant);
      expect(seen.red.status).toBe(64);
      expect(seen.red.output).toContain("nonBody=true");
    }
  });
  it.each(["fixtureAwaited", "beforeEachAwaited"])("accepts awaited %s setup beside body RED and verifies GREEN", async phase => {
    const seen = await scenario(phase, "twin");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toMatchObject({ status: 0, verdict: "SEPARATION-HELD" });
  });
  it.each(["pFirst", "qFirst"])("keeps setup P origin after body Q (%s)", async order => {
    const seen = await scenario("twoOrigins", order);
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
});
