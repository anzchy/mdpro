// @vitest-environment node
/// <reference lib="es2023.array" />
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

describe("D337 scheduler run-instance and completion evidence", () => {
  it("waits past Ready observed before the started instance runs, then returns its own committed result", async () => {
    const fixture = await supervisorFixture("early-ready");
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines)).toMatchObject({ runId: fixture.runId, status: "completed", cleanup: "complete" });
    expect(await readFile(path.join(fixture.dir, "polled"), "utf8")).toBe("ready-before-run");
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
  }, 15000);
  it.each(["wrong-progress", "wrong-result"])("a %s run identifier cannot authorize completion and latches later input", async (scenario) => {
    const fixture = await supervisorFixture(scenario);
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines).status).toBe("failed");
    expect(result.lines.join(" ")).toContain("RUN_MISMATCH");
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
  }, 15000);
});
