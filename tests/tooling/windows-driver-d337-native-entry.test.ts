// @vitest-environment node
/// <reference lib="es2023.array" />
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

describe("D337 independent native-entry validation", () => {
  it.each([["PhaseMs", "10.4"], ["CleanupMs", "10.4"], ["PollMs", "1.4"], ["TimeoutSec", "0.001"]])("refuses coercible %s=%s before creating a task", async (name, value) => {
    const fixture = await supervisorFixture("success", { entry: { [name]: value } });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(2);
    expect(await exists(path.join(fixture.dir, "started"))).toBe(false);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
  }, 15000);
  it.each(["null", "{}", "{", '[{"op":"unknown"}]', '[{"op":"wait"},null]'])("rejects malformed native steps %s without dispatch", async (rawSteps) => {
    const fixture = await supervisorFixture("success", { rawSteps });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(2);
    expect(outcome(result.lines)).toMatchObject({ inputOutcome: "none", completedSteps: 0, heldInput: "released" });
    expect(await exists(path.join(fixture.dir, "started"))).toBe(false);
  }, 15000);
  it("refuses a budget that has no complete phase plus cleanup reservation", async () => {
    const fixture = await supervisorFixture("success", { entry: { PhaseMs: "5000", CleanupMs: "5000", DeadlineMs: String(Date.now() + 7000) } });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(2);
    expect(await exists(path.join(fixture.dir, "started"))).toBe(false);
  }, 15000);
  it("refuses a native list of1001 steps before Scheduler dispatch", async () => {
    const fixture = await supervisorFixture("success", { steps: Array.from({ length: 1001 }, () => ({ op: "wait", ms: 0 })) });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(2);
    expect(await exists(path.join(fixture.dir, "started"))).toBe(false);
  }, 15000);
});
