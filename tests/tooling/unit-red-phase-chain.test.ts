// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { createOwnerChildRunner } from "./d302Child";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
let owner: ReturnType<typeof createOwnerChildRunner> | null = null;
beforeEach((context) => { owner = createOwnerChildRunner(context.signal); });
afterEach(async () => { await owner?.close(); owner = null; });
async function scenario(name: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix1-phase-cases.mjs");
  const result = await (owner?.run(process.execPath, [script, name, repo], { cwd: repo, timeout: 60_000 }) ?? Promise.reject(Error("D302 owner closed")));
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { red: { status: number; kind: string }; green: { status: number; verdict: string } | null };
}
describe.skipIf(!receiptSuites)("fix1 chained and scoped fixtures", () => {
  it("D302 worker heartbeat advances while the nested receipt process runs", async () => {
    let beats = 0;
    const timer = setInterval(() => { beats++; }, 10);
    try {
      const result = await scenario("fixtureConcurrentPrebuilt");
      expect(result.red.status).toBe(64);
      expect(beats).toBeGreaterThan(0);
    } finally { clearInterval(timer); }
  });
  it.each(["fixtureConcurrentPrebuilt", "fixtureFilePrebuilt"])("refuses %s setup failure", async name => {
    const result = await scenario(name);
    expect(result.red.status).toBe(64);
    expect(result.red.kind).not.toBe("assertion-failure");
  });
  it.each(["fixtureConcurrentBody", "fixtureFileBody"])("accepts %s body RED and GREEN", async name => {
    const result = await scenario(name);
    expect(result.red).toEqual({ status: 0, kind: "assertion-failure" });
    expect(result.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });
});
