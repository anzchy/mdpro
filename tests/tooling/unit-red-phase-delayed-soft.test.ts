// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
async function scenario(variant: string, phase = "fixtureDelayedSoft") {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix2-soft-cases.mjs");
  const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>(done => {
    execFile(process.execPath, [script, phase, variant, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 }, (error, stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout, stderr });
    });
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { red: { status: number; kind: string | null; output: string }; green: { status: number; verdict: string | null } | null; phaseRan: boolean };
}
describe.skipIf(!plugin)("fix2 delayed fixture soft attribution", () => {
  it("refuses a setup-started soft promise that rejects after the body passes", async () => {
    const seen = await scenario("alone");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
  it("refuses the unawaited passing setup twin beside a genuine body RED", async () => {
    const seen = await scenario("twin");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
  });
  it("accepts the awaited passing setup twin beside a genuine body RED, then HELD", async () => {
    const seen = await scenario("twin", "fixtureDelayedSoftAwaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });
  it("refuses an unawaited soft assertion started in the body", async () => {
    const seen = await scenario("twin", "bodyDelayedSoft");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
  });
  it("accepts an awaited soft assertion started in the body, then HELD", async () => {
    const seen = await scenario("twin", "bodyDelayedSoftAwaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });
});
