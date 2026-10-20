// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
const phases = ["beforeEach", "beforeEachCleanup", "fixtureSetup", "fixtureTeardown", "afterEach", "onFinished", "onFailed"] as const;

function scenario(phase: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix2-soft-cases.mjs");
  const run = spawnSync(process.execPath, [script, phase, variant, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as {
    red: { status: number; kind: string | null; output: string };
    green: { status: number; verdict: string | null } | null;
    phaseRan: boolean;
    attempts: number | null;
  };
}

describe.skipIf(!plugin)("fix2 WI-1 soft-error phase provenance through real entry/plugin", () => {
  it.each(phases)("refuses %s soft failure with a passing body", phase => {
    const seen = scenario(phase, "alone");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });

  it.each(phases)("refuses %s soft failure beside a body failure", phase => {
    const seen = scenario(phase, "mixed");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });

  it.each(phases)("accepts a body RED with a passing %s soft assertion and reaches GREEN", phase => {
    const seen = scenario(phase, "twin");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });

  it("refuses a retry whose first attempt has a soft beforeEach failure and second has a body failure", () => {
    const seen = scenario("retryBeforeEachSoft", "mixed");
    expect(seen.phaseRan).toBe(true);
    expect(seen.attempts).toBe(2);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
});
