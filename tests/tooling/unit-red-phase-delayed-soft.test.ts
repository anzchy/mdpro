// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
function scenario(variant: string, phase = "fixtureDelayedSoft") {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix2-soft-cases.mjs");
  const run = spawnSync(process.execPath, [script, phase, variant, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { red: { status: number; kind: string | null; output: string }; green: { status: number; verdict: string | null } | null; phaseRan: boolean };
}
describe.skipIf(!plugin)("fix2 delayed fixture soft attribution", () => {
  it("refuses a setup-started soft promise that rejects after the body passes", () => {
    const seen = scenario("alone");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
  it("refuses the unawaited passing setup twin beside a genuine body RED", () => {
    const seen = scenario("twin");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
  });
  it("accepts the awaited passing setup twin beside a genuine body RED, then HELD", () => {
    const seen = scenario("twin", "fixtureDelayedSoftAwaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });
  it("refuses an unawaited soft assertion started in the body", () => {
    const seen = scenario("twin", "bodyDelayedSoft");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
  });
  it("accepts an awaited soft assertion started in the body, then HELD", () => {
    const seen = scenario("twin", "bodyDelayedSoftAwaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });
});
