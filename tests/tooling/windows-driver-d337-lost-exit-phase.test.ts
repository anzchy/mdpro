// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { productionWorkerFixture, type ProductionStall } from "./windows-driver-native-production-harness";

vi.setConfig({ testTimeout: 40_000 });

const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
const steps = [{ op: "clickat", x: 100, y: 100 }, { op: "chord", keys: ["ctrl+a"], nofocus: true }];

// The Scheduler's LastTaskResult can read 0 while the worker committed a failed result (a lost or
// not-yet-updated exit code). The committed result is present, so the caller must get its phase,
// never a claim that the result is missing.
describe("D337 a lost task exit code never hides the worker's committed failure phase", () => {
  it.each<[ProductionStall, string]>([
    ["resolver", "window-resolver"],
    ["stdout", "window-resolver"],
  ])("a %s stall with exit 0 still fails, naming %s", async (stall, phase) => {
    const fixture = await productionWorkerFixture(stall, steps, { exitStatus: "lost" });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
    const value = outcome(result.lines);
    expect(value).toMatchObject({ status: "failed", inputOutcome: "none", cleanup: "complete" });
    expect(value.phase).toContain(phase);
    expect(value.phase).not.toContain("RESULT_MISSING");
    const durable = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "result.json"), "utf8"));
    expect(durable.phase).toBe(value.phase);
  });

  it("a completed worker with exit 0 still succeeds", async () => {
    const fixture = await productionWorkerFixture("none", steps, { exitStatus: "lost" });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines)).toMatchObject({ status: "completed", completedSteps: 2, cleanup: "complete" });
  });
});
