// @vitest-environment node
/// <reference lib="es2023.array" />
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }

describe("D337 T3 executable supervisor boundary outcomes against pre-existing code", () => {
  it.each(["discovery", "uia", "title-restore", "after-input", "held"])("retains durable %s phase and the actual completed prefix", async (phase) => {
    const fixture = await supervisorFixture(phase);
    const started = Date.now();
    const result = await fixture.start().result;
    const value = outcome(result.lines);
    expect(result.status, result.stderr).not.toBe(0);
    expect(value.phase).toContain(phase);
    expect(value.completedSteps).toBe(["after-input", "held"].includes(phase) ? 1 : 0);
    expect(value.inputOutcome).toBe(["after-input", "held"].includes(phase) ? "unknown" : "none");
    expect(value.cleanup).toBe("complete");
    expect(Date.now() - started).toBeLessThan(10000);
    const durable = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "result.json"), "utf8"));
    expect(durable).toMatchObject({ runId: fixture.runId, phase: value.phase, completedSteps: value.completedSteps });
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
  }, 15000);
  it("a cleanup stall cannot turn an already completed worker into caller success", async () => {
    const fixture = await supervisorFixture("cleanup-stall");
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines)).toMatchObject({ cleanup: "failed", status: "failed" });
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
  }, 15000);
});
