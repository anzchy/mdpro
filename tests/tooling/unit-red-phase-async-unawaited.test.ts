// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));

async function scenario(name: string, variant = "alone") {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-async-cases.mjs");
  const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>(done => {
    execFile(process.execPath, [script, name, variant, repo], { cwd: repo, encoding: "utf8", timeout: 90_000 }, (error, stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout, stderr });
    });
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { red: { status: number; kind: string | null; output: string } };
}

describe.skipIf(!plugin)("D301 reported unawaited async assertions", () => {
  it("refuses a failing unawaited hard assertion in the body", async () => {
    const seen = await scenario("bodyHard");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
  it("accepts awaited body resolves and rejects assertion REDs", async () => {
    for (const name of ["bodyAwaited", "bodyRejectsAwaited"]) {
      const seen = await scenario(name);
      expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    }
  });
  it("a standalone awaited passing body assertion supplies no RED", async () => {
    const seen = await scenario("bodyAwaitedPass");
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
    expect(seen.red.output).not.toContain("unawaited async assertion");
  });
  it("refuses a passing unawaited setup assertion beside a body RED", async () => {
    const seen = await scenario("passingSetupUnawaited");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
  });
  it("accepts its awaited setup twin beside a body RED", async () => {
    const seen = await scenario("passingSetup");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
  it.each(["xFirst", "yFirst"])("refuses a passing unawaited X beside failing Y (%s)", async order => {
    const seen = await scenario("twoTests", order);
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
  it.each(["xFirstAwaited", "yFirstAwaited"])("accepts awaited X beside failing Y (%s)", async order => {
    const seen = await scenario("twoTests", order);
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
});
