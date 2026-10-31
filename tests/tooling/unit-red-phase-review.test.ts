// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");

describe.skipIf(!receiptSuites)("fix1 reviewer phase regressions", () => {
  it.each(["fixtureSetupThrow", "busyBodyTimeout"])("refuses %s outside-body failure", name => {
    const script = join(repo, "tests/tooling/fixtures/unit-red/fix1-phase-cases.mjs");
    const result = spawnSync(process.execPath, [script, name, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const observed = JSON.parse(result.stdout) as { red: { status: number; kind: string } };
    expect(observed.red.status).toBe(64);
    expect(observed.red.kind).not.toBe("assertion-failure");
  });
  it("refuses a synchronous over-deadline body even when Vitest detects it before a timer callback", () => {
    const script = join(repo, "tests/tooling/fixtures/unit-red/fix1-phase-cases.mjs");
    const result = spawnSync(process.execPath, [script, "busySyncTimeout", repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const observed = JSON.parse(result.stdout) as { red: { status: number; kind: string } };
    expect(observed.red.status).toBe(64);
    expect(observed.red.kind).not.toBe("assertion-failure");
  });
});
