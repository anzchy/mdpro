// @vitest-environment node
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh } from "../support/fakeSsh";
import { runNative } from "./windows-driver-native-harness";

const UI = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
const made: FakeSsh[] = [];
afterEach(() => made.splice(0).forEach((fake) => fake.cleanup()));
const output = Buffer.from(JSON.stringify(["completed"])).toString("base64");
function wrapper(steps: unknown, env: Record<string, string> = {}) {
  const fake = makeFakeSsh([{ execute: true, stdout: output }]);
  made.push(fake);
  return new Promise<{ status: number | null; stdout: string; stderr: string; calls: string[] }>((done) => {
    const child = spawn("bash", [UI, typeof steps === "string" ? steps : JSON.stringify(steps)], { env: { ...fake.env, ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => { stdout += String(v); });
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("close", (status) => done({ status, stdout, stderr, calls: fake.executed() }));
  });
}

describe("D337 validated caller-visible transaction", () => {
  it.each([
    ["MDPRO_UI_PHASE_MS", "9"], ["MDPRO_UI_PHASE_MS", "5001"], ["MDPRO_UI_PHASE_MS", "1.5"],
    ["MDPRO_UI_TRANSACTION_MS", "49"], ["MDPRO_UI_TRANSACTION_MS", "85001"],
    ["MDPRO_UI_OUTER_MS", "99"], ["MDPRO_UI_OUTER_MS", "90001"],
    ["MDPRO_UI_CLEANUP_MS", "0"], ["MDPRO_UI_POLL_MS", "0"],
    ["MDPRO_UI_PHASE_MS", "null"], ["MDPRO_UI_PHASE_MS", "-1"],
  ])("rejects %s=%s before any remote effect", async (key, value) => {
    const result = await wrapper([{ op: "focus" }], { [key]: value });
    expect(result.status, result.stderr).toBe(2);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain("UI_BUDGET_INVALID");
  });
  it.each([
    null, {}, [{ op: "unknown-op" }], Array.from({ length: 1001 }, () => ({ op: "wait", ms: 0 })),
    [{ op: "run", exe: "x".repeat(65537) }],
  ])("refuses malformed, unknown or oversized steps without a task", async (steps) => {
    const result = await wrapper(steps);
    expect(result.status, result.stderr).toBe(2);
    expect(result.calls).toEqual([]);
  });
  it("carries a fresh absolute deadline and normal budgets into exactly one native transaction", async () => {
    const before = Date.now();
    const result = await wrapper([{ op: "focus" }]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain("-PhaseMs 5000");
    expect(result.calls[0]).toContain("-CleanupMs 5000");
    const deadline = Number(/-DeadlineMs (\d+)/.exec(result.calls[0])?.[1]);
    expect(deadline).toBeGreaterThanOrEqual(before + 30000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 30000);
  });
});

describe("D337 input transaction outcomes", () => {
  it("completes clickat and Ctrl+A once with explicit cleanup and held-input outcome", async () => {
    const result = await runNative([{ op: "clickat", x: 100, y: 100 }, { op: "chord", keys: ["ctrl+a"], nofocus: true }]);
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((v) => v.startsWith("mouse:"))).toEqual(["mouse:2", "mouse:4"]);
    expect(result.trace.filter((v) => v.startsWith("logical:"))).toEqual(["logical:17:0", "logical:65:0", "logical:65:2", "logical:17:2"]);
    const line = result.log.find((v) => v.startsWith("OUTCOME "));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice(8))).toMatchObject({ status: "completed", completedSteps: 2, inputOutcome: "partial", cleanup: "complete", heldInput: "released" });
  }, 20000);
  it("never enters a provider or child boundary while any input is held", async () => {
    const result = await runNative([{ op: "chord", keys: ["ctrl+a"], nofocus: true }]);
    expect(result.status, JSON.stringify(result)).toBe(0);
    let held = 0;
    const violations: string[] = [];
    for (const event of result.trace) {
      if (event.startsWith("logical:")) held += event.endsWith(":0") ? 1 : -1;
      if (held && event.startsWith("boundary:")) violations.push(event);
    }
    expect(violations).toEqual([]);
    expect(held).toBe(0);
  }, 20000);
  it("reports an uncertain mouse release and refuses a trailing mutation", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { overlayAfterMouseDown: true });
    expect(result.status).toBe(1);
    expect(result.trace).not.toContain("logical:66:0");
    const line = result.log.find((v) => v.startsWith("OUTCOME "));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice(8))).toMatchObject({ status: "failed", inputOutcome: "unknown", heldInput: "uncertain" });
  }, 20000);
  it("an empty transaction explicitly completes zero steps", async () => {
    const result = await runNative([]);
    expect(result.status, result.stderr).toBe(0);
    const line = result.log.find((v) => v.startsWith("OUTCOME "));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice(8))).toMatchObject({ status: "completed", completedSteps: 0, inputOutcome: "none", heldInput: "released" });
    expect(result.trace.filter((v) => /^(logical|mouse|scan):/.test(v))).toEqual([]);
  }, 20000);
});
