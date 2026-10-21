// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));

function scenario(name: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-async-cases.mjs");
  const run = spawnSync(process.execPath, [script, name, variant, repo], { cwd: repo, encoding: "utf8", timeout: 90_000 });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { red: { status: number; kind: string | null; output: string }; green: { status: number; verdict: string | null } | null };
}

describe.skipIf(!plugin)("D301 async assertion provenance", () => {
  it.each(["fixture", "beforeEach"])("refuses %s failure with passing body", phase => {
    const seen = scenario(phase, "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it.each(["fixture", "beforeEach"])("refuses %s failure beside a body RED", phase => {
    const seen = scenario(phase, "mixed");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it.each(["fixtureRejects", "beforeEachRejects"])("refuses setup %s failure alone and beside a body RED", phase => {
    for (const variant of ["alone", "mixed"]) {
      const seen = scenario(phase, variant);
      expect(seen.red.status).toBe(64);
      expect(seen.red.output).toContain("nonBody=true");
      expect(seen.red.output).toContain("unawaited async assertion");
    }
  });
  it("refuses beforeAll async failure", () => {
    const seen = scenario("beforeAll", "alone");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
  it.each(["afterEachRejects", "afterAllRejects"])("refuses %s async rejects failure alone and beside body RED", phase => {
    for (const variant of ["alone", "mixed"]) {
      const seen = scenario(phase, variant);
      expect(seen.red.status).toBe(64);
      expect(seen.red.output).toContain("nonBody=true");
    }
  });
  it.each(["fixtureAwaited", "beforeEachAwaited"])("accepts awaited %s setup beside body RED and verifies GREEN", phase => {
    const seen = scenario(phase, "twin");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toMatchObject({ status: 0, verdict: "SEPARATION-HELD" });
  });
  it.each(["pFirst", "qFirst"])("keeps setup P origin after body Q (%s)", order => {
    const seen = scenario("twoOrigins", order);
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
  });
});
