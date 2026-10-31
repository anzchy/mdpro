// @vitest-environment node
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { budgetFixture, LATCH, latchBytes, outcome, runBudgetBatch, type BudgetRow } from "./windows-driver-d342-budget-harness";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

async function checkRows(rows: BudgetRow[]) {
  const dir = await budgetFixture();
  const results = await runBudgetBatch(dir, rows);
  expect(results).toHaveLength(rows.length);
  for (const [index, row] of rows.entries()) {
    const result = results[index];
    expect(result.id).toBe(row.id);
    expect(result.status, row.id + ": " + result.lines.join(" ")).toBe(row.accepted ? 1 : 2);
    expect(outcome(result.lines), row.id).toMatchObject({
      phase: "setup: " + (row.accepted ? "NATIVE_RECONCILIATION_REQUIRED" : "UI_BUDGET_INVALID"),
      completedSteps: 0, inputOutcome: "none", heldInput: "released", cleanup: "not-started",
    });
  }
  expect(await latchBytes(dir)).toBe(LATCH);
  expect((await readdir(dir)).sort()).toEqual(["batch.ps1", "native-session-blocked.json", "native-validation.ps1", "rows.json", "ui-run.ps1"]);
  return results;
}

describe("D342 native integer budgets use numeric order", () => {
  it("accepts the real direct default argument line past validation", async () => {
    await checkRows([{ id: "real-defaults", values: { PollMs: "25" }, accepted: true }]);
  });

  it("isolates each numeric range, including values whose text order disagrees", async () => {
    const rows: BudgetRow[] = [];
    for (const [name, minimum, maximum, values] of [
      ["PhaseMs", 10, 5000, [0, 9, 10, 50, 4999, 5000, 5001, 6000]],
      ["CleanupMs", 10, 5000, [0, 9, 10, 100, 4999, 5000, 5001, 6000]],
      ["PollMs", 1, 1000, [0, 1, 2, 10, 25, 999, 1000, 1001]],
    ] as const) {
      for (const value of values) rows.push({ id: `${name}=${value}`, values: { [name]: String(value) }, accepted: value >= minimum && value <= maximum });
    }
    await checkRows(rows);
  });

  it("keeps strict decimal spelling and long overflow refusals for every integer budget", async () => {
    const invalid = ["", "-1", "1.5", "1e2", "0x10", " 100", "中文", "9223372036854775808"];
    const rows = ["PhaseMs", "CleanupMs", "PollMs", "DeadlineMs"].flatMap((name) => invalid.map((value) => ({
      id: `${name}=${JSON.stringify(value)}`, values: { [name]: value }, accepted: false,
    })));
    await checkRows(rows);
  });

  it("caps deadlines numerically even when their digit count differs from this clock", async () => {
    await checkRows([
      { id: "default deadline", values: { DeadlineMs: "0" }, accepted: true },
      { id: "ordinary deadline", deadlineOffset: 30000, accepted: true },
      { id: "reservation too short", deadlineOffset: 2000, accepted: false },
      { id: "past 12-digit deadline", values: { DeadlineMs: "999999999999", TimeoutSec: "30" }, accepted: false },
      { id: "future 14-digit deadline capped", values: { DeadlineMs: "10000000000000", TimeoutSec: "30" }, accepted: true },
      { id: "long maximum capped", values: { DeadlineMs: "9223372036854775807", TimeoutSec: "30" }, accepted: true },
      { id: "cap still exceeds native 85-second bound", deadlineOffset: 120000, accepted: false },
    ]);
  });

  it("preserves timeout range, syntax and cleanup reservation", async () => {
    await checkRows([
      ...["", "-1", "1e2", "0x10", " 30", "中文", "1.0001", "0", "0.099", "90.001", "100"].map((value) => ({
        id: "TimeoutSec=" + JSON.stringify(value), values: { TimeoutSec: value }, accepted: false,
      })),
      { id: "smallest timeout with full reservation", values: { TimeoutSec: "0.1", DeadlineMs: "0", PhaseMs: "10", CleanupMs: "10", PollMs: "1" }, accepted: true },
      { id: "maximum timeout", values: { TimeoutSec: "90" }, accepted: true },
      { id: "capped deadline cannot reserve phase and cleanup", values: { TimeoutSec: "1" }, accepted: false },
    ]);
  });

  it("preserves classification under legal zero-prefixed decimal representations", async () => {
    const rows: BudgetRow[] = [];
    for (const [name, minimum, maximum, values] of [
      ["PhaseMs", 10, 5000, [9, 10, 50, 5000, 5001]],
      ["CleanupMs", 10, 5000, [9, 10, 100, 5000, 6000]],
      ["PollMs", 1, 1000, [0, 1, 2, 25, 999, 1000, 1001]],
    ] as const) {
      for (const value of values) for (const text of [String(value), "000" + value]) rows.push({
        id: `${name}=${text}`, values: { [name]: text }, accepted: value >= minimum && value <= maximum,
      });
    }
    const results = await checkRows(rows);
    for (let index = 0; index < results.length; index += 2) {
      expect({ status: results[index].status, phase: outcome(results[index].lines).phase }).toEqual({
        status: results[index + 1].status, phase: outcome(results[index + 1].lines).phase,
      });
    }
  });

  it("completes the real supervisor path and carries default PollMs 25 into its worker", async () => {
    const fixture = await supervisorFixture("success", { steps: [{ op: "wait", ms: 0 }], entry: {
      PhaseMs: "5000", CleanupMs: "5000", PollMs: "25", DeadlineMs: String(Date.now() + 30000), TimeoutSec: "90",
    } });
    // Observe the inherited argument at the existing desktop-worker boundary, before its early success exit.
    const workerPath = path.join(fixture.dir, "worker.ps1");
    const worker = await readFile(workerPath, "utf8");
    await writeFile(workerPath, '[IO.File]::WriteAllText("$env:TEST_ROOT/worker-poll", "$env:MDPRO_NATIVE_POLL_MS")\n' + worker);
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines)).toMatchObject({ status: "completed", cleanup: "complete", heldInput: "released" });
    expect(await readFile(path.join(fixture.dir, "worker-poll"), "utf8")).toBe("25");
    expect(await readdir(fixture.dir)).not.toContain("native-session-blocked.json");
  }, 30000);
});
