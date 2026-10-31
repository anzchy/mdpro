// @vitest-environment node
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN, exists, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D342 reconcile preserves numeric budgets through the real supervisor boundary", () => {
  it("retains PhaseMs and PollMs 25 as numeric state while moving the exact latch bytes", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const before = await readFile(latchPath(dir));
    // Only observe at the existing kernel-job substitute; entry, validator, supervisor and scheduler stay real.
    await appendFile(path.join(dir, "native-job.ps1"), String.raw`
@{ phase = $PhaseMs; poll = $PollMs; phaseType = $PhaseMs.GetType().FullName; pollType = $PollMs.GetType().FullName } |
  ConvertTo-Json -Compress | Set-Content -LiteralPath "$PSScriptRoot/budget-state.json" -Encoding UTF8
`);
    const result = await reconcile(dir, ["-RunId", RUN, "-PhaseMs", "5000", "-PollMs", "25"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.result).toMatchObject({ status: "reconciled", checks: { task: "absent", owned: "none-alive", heldInput: "released" } });
    const state = JSON.parse((await readFile(path.join(dir, "budget-state.json"), "utf8")).replace(/^\uFEFF/, ""));
    expect(state).toEqual({ phase: 5000, poll: 25, phaseType: "System.Int64", pollType: "System.Int64" });
    expect(await exists(latchPath(dir))).toBe(false);
    expect(await readFile(runPath(dir, RUN, "reconciled.json"))).toEqual(before);
    expect(await exists(runPath(dir, RUN, "reconcile-checks.json"))).toBe(true);
    expect(await exists(path.join(dir, "started"))).toBe(false);
  }, 20000);

  it.each([["PollMs", "1001"], ["PhaseMs", "9"]])("refuses invalid %s=%s without moving the latch", async (name, value) => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const before = await readFile(latchPath(dir));
    const budgets = { PollMs: "25", [name]: value };
    const result = await reconcile(dir, ["-RunId", RUN, ...Object.entries(budgets).flatMap(([key, text]) => ["-" + key, text])]);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.result).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_INVALID" });
    expect(await readFile(latchPath(dir))).toEqual(before);
    expect(await exists(runPath(dir, RUN, "reconciled.json"))).toBe(false);
    expect(await exists(path.join(dir, "started"))).toBe(false);
  }, 15000);
});
