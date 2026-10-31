// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { createOwnerChildRunner } from "./d302Child";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
const phases = ["beforeEach", "beforeEachCleanup", "fixtureSetup", "fixtureTeardown", "afterEach", "onFinished", "onFailed"] as const;
let owner: ReturnType<typeof createOwnerChildRunner> | null = null;
beforeEach((context) => { owner = createOwnerChildRunner(context.signal); });
afterEach(async () => { await owner?.close(); owner = null; });

async function scenario(phase: string, variant: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix2-soft-cases.mjs");
  const run = await (owner?.run(process.execPath, [script, phase, variant, repo], { cwd: repo, timeout: 60_000 }) ?? Promise.reject(Error("D302 owner closed")));
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as {
    red: { status: number; kind: string | null; output: string };
    green: { status: number; verdict: string | null } | null;
    phaseRan: boolean;
    attempts: number | null;
  };
}

describe.skipIf(!receiptSuites)("fix2 WI-1 soft-error phase provenance through real entry/plugin", () => {
  it.each(phases)("refuses %s soft failure with a passing body", async phase => {
    const seen = await scenario(phase, "alone");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });

  it.each(phases)("refuses %s soft failure beside a body failure", async phase => {
    const seen = await scenario(phase, "mixed");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });

  it.each(phases)("accepts a body RED with a passing %s soft assertion and reaches GREEN", async phase => {
    const seen = await scenario(phase, "twin");
    expect(seen.phaseRan).toBe(true);
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
    expect(seen.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });

  it("refuses a retry whose first attempt has a soft beforeEach failure and second has a body failure", async () => {
    const seen = await scenario("retryBeforeEachSoft", "mixed");
    expect(seen.phaseRan).toBe(true);
    expect(seen.attempts).toBe(2);
    expect(seen.red.status).toBe(64);
    expect(seen.red.kind).not.toBe("assertion-failure");
  });
});
