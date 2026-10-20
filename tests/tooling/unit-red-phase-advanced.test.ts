// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const hasPlugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));

function scenario(name: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix1-phase-cases.mjs");
  const result = spawnSync(process.execPath, [script, name, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { red: { status: number; kind: string }; green: { status: number; verdict: string } | null; setupReached: string | null; overlap: boolean | null; attempts: number | null };
}

describe.skipIf(!hasPlugin)("fix1 WI-1 adversarial phase boundaries", () => {
  it.each([
    "nestedBeforeAll", "nestedAfterAll", "nestedParentBeforeEach",
    "nestedBeforeAllAlone", "nestedAfterAllAlone", "nestedParentBeforeEachAlone",
    "afterEachExpect", "cleanupExpect", "afterEachSoft", "cleanupSoft", "fixtureExpect", "finishedExpect",
    "duplicateForward", "duplicateReverse",
    "countMessageAfterEach", "countMessageCleanup", "countAndCleanup",
    "concurrent", "retryBodyThenCleanup", "retryCleanupThenBody", "repeatCleanupSecond", "configTsFail", "allPhasesFail",
  ])("refuses %s outside-body failure even beside a body failure", (name) => {
    const result = scenario(name);
    expect(result.red.status).toBe(64);
    expect(result.red.kind).not.toBe("assertion-failure");
    if (name === "concurrent") expect(result.overlap).toBe(true);
    if (name.startsWith("retry") || name.startsWith("repeat")) expect(result.attempts).toBe(2);
    if (name === "configTsFail") expect(result.setupReached).toBe("yes");
  });

  it.each([
    "timeoutLike", "timeoutLiteral", "bodyTypeError", "bodyReferenceError", "bodyString", "bodyAsyncReject", "bodyErrorRed",
    "countAssertions", "countHasAssertions", "configTs", "allPhases", "allPhasesConfig",
  ])("accepts %s body or post-body count failure and reaches GREEN", (name) => {
    const result = scenario(name);
    expect(result.red).toEqual({ status: 0, kind: "assertion-failure" });
    expect(result.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
    if (name === "configTs" || name === "allPhasesConfig") expect(result.setupReached).toBe("yes");
  });
});
