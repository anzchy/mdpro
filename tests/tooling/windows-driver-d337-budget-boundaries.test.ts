// @vitest-environment node
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh } from "../support/fakeSsh";

// Matrix "full caller and budget boundaries": the accepted edges of every override, the
// phase < transaction < outer and cleanup-reservation refusals, non-decimal spellings, and the
// 1000-step / 65536-byte acceptance edges. A refusal is rc 2 with nothing sent to Windows.
const UI = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
const made: FakeSsh[] = [];
afterEach(() => made.splice(0).forEach((fake) => fake.cleanup()));
const output = Buffer.from(JSON.stringify(["completed"])).toString("base64");
function wrapper(steps: unknown, env: Record<string, string> = {}) {
  const fake = makeFakeSsh([{ execute: true, stdout: output }]);
  made.push(fake);
  return new Promise<{ status: number | null; stderr: string; calls: string[] }>((done) => {
    const child = spawn("bash", [UI, typeof steps === "string" ? steps : JSON.stringify(steps)], { env: { ...fake.env, ...env } });
    let stderr = "";
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("close", (status) => done({ status, stderr, calls: fake.executed() }));
  });
}
const dispatches = (calls: string[]) => calls.filter((c) => c.includes("ui-run.ps1"));

describe("D337 budget overrides at their accepted edges", () => {
  it.each([
    [{ MDPRO_UI_PHASE_MS: "10" }, "-PhaseMs 10 "],
    [{ MDPRO_UI_PHASE_MS: "5000" }, "-PhaseMs 5000 "],
    [{ MDPRO_UI_CLEANUP_MS: "10" }, "-CleanupMs 10 "],
    [{ MDPRO_UI_POLL_MS: "1" }, "-PollMs 1 "],
    [{ MDPRO_UI_POLL_MS: "1000" }, "-PollMs 1000 "],
    [{ MDPRO_UI_TRANSACTION_MS: "85000" }, "-TimeoutSec 90"],
    [{ MDPRO_UI_OUTER_MS: "90000" }, "-TimeoutSec 90"],
  ])("accepts %o and carries it into exactly one native transaction", async (env, carried) => {
    const result = await wrapper([{ op: "focus" }], env);
    expect(result.status, result.stderr).toBe(0);
    expect(dispatches(result.calls)).toHaveLength(1);
    expect(dispatches(result.calls)[0]).toContain(carried);
  });
  it("carries an 85000 ms transaction as the absolute deadline", async () => {
    const before = Date.now();
    const result = await wrapper([{ op: "focus" }], { MDPRO_UI_TRANSACTION_MS: "85000" });
    expect(result.status, result.stderr).toBe(0);
    const deadline = Number(/-DeadlineMs (\d+)/.exec(dispatches(result.calls)[0])?.[1]);
    expect(deadline).toBeGreaterThanOrEqual(before + 85000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 85000);
  });
  it.each([
    { MDPRO_UI_TRANSACTION_MS: "50", MDPRO_UI_PHASE_MS: "10", MDPRO_UI_CLEANUP_MS: "40" },
    { MDPRO_UI_OUTER_MS: "100", MDPRO_UI_TRANSACTION_MS: "60", MDPRO_UI_PHASE_MS: "10", MDPRO_UI_CLEANUP_MS: "10" },
  ])("accepts the smallest valid budget set %o (it may then time out, but never as invalid)", async (env) => {
    // @ts-expect-error -- it.each infers these env tables as unions with optional keys; every value is a string at runtime.
    const result = await wrapper([{ op: "focus" }], env);
    expect(result.status).not.toBe(2);
    expect(result.stderr).not.toContain("UI_BUDGET_INVALID");
    expect(dispatches(result.calls).length).toBeLessThanOrEqual(1);
  });
});

describe("D337 budget ordering, reservation and spelling refusals", () => {
  it.each([
    { MDPRO_UI_PHASE_MS: "5000", MDPRO_UI_TRANSACTION_MS: "5000" },
    { MDPRO_UI_TRANSACTION_MS: "85000", MDPRO_UI_OUTER_MS: "85000" },
    { MDPRO_UI_PHASE_MS: "5000", MDPRO_UI_CLEANUP_MS: "5000", MDPRO_UI_TRANSACTION_MS: "9999" },
    { MDPRO_UI_PHASE_MS: "10", MDPRO_UI_CLEANUP_MS: "60", MDPRO_UI_TRANSACTION_MS: "60" },
    { MDPRO_UI_TRANSACTION_MS: "3e4" }, { MDPRO_UI_TRANSACTION_MS: " 30000" }, { MDPRO_UI_TRANSACTION_MS: "30000.0" },
    { MDPRO_UI_OUTER_MS: "0x10" }, { MDPRO_UI_OUTER_MS: "" }, { MDPRO_UI_CLEANUP_MS: "5001" }, { MDPRO_UI_POLL_MS: "1001" },
  ])("refuses %o before any remote effect", async (env) => {
    // @ts-expect-error -- it.each infers these env tables as unions with optional keys; every value is a string at runtime.
    const result = await wrapper([{ op: "focus" }], env);
    expect(result.status, result.stderr).toBe(2);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain("UI_BUDGET_INVALID");
  });
});

describe("D337 step-count and payload acceptance edges", () => {
  it("accepts exactly 1000 steps as one native transaction", async () => {
    const result = await wrapper(Array.from({ length: 1000 }, () => ({ op: "wait", ms: 0 })));
    expect(result.status, result.stderr).not.toBe(2);
    expect(result.stderr).not.toContain("UI_STEPS_INVALID");
    expect(dispatches(result.calls)).toHaveLength(1);
  });
  it("accepts a payload of exactly 65536 UTF-8 bytes as one native transaction", async () => {
    const frame = JSON.stringify([{ op: "run", exe: "" }]).length;
    const raw = JSON.stringify([{ op: "run", exe: "x".repeat(65536 - frame) }]);
    expect(Buffer.byteLength(raw, "utf8")).toBe(65536);
    const result = await wrapper(raw);
    expect(result.status, result.stderr).not.toBe(2);
    expect(result.stderr).not.toContain("UI_STEPS_TOO_LARGE");
    expect(dispatches(result.calls)).toHaveLength(1);
  });
});
