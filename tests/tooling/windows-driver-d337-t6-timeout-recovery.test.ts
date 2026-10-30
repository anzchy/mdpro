// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";
import { reconcile } from "./windows-driver-native-reconcile-harness";

const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
const exists = (file: string) => readFile(file).then(() => true, () => false);

// T6, timeout-A / recovery / C / late-A: A times out in a blocking phase with its worker drained and no
// committed result, so it latches. C is refused until A is reconciled by run id; then a delayed A writer
// resumes while C runs, and C completes with its own identity. Neither run's files are taken for the other's.
describe("D337 T6 a timed-out run's late writer cannot complete or corrupt the next run", () => {
  it("C recovers after A's phase timeout and ignores A's late completion", async () => {
    const fixture = await supervisorFixture("discovery");
    const a = await fixture.start().result;
    expect(a.status, a.stderr).not.toBe(0);
    expect(outcome(a.lines)).toMatchObject({ runId: fixture.runId, inputOutcome: "none", cleanup: "complete" });
    expect(outcome(a.lines).phase).toContain("discovery");
    const latch = path.join(fixture.dir, "native-session-blocked.json");
    expect(await exists(latch)).toBe(true);
    const aResult = path.join(fixture.dir, "runs", fixture.runId, "result.json");
    const aFinal = await readFile(aResult, "utf8");
    const cId = "c".repeat(32);
    const refused = await fixture.start(cId, { TEST_SCENARIO: "success" }).result;
    expect(refused.status).not.toBe(0);
    expect(refused.lines.join(" ")).toContain("NATIVE_RECONCILIATION_REQUIRED");
    expect(await exists(path.join(fixture.dir, "runs", cId))).toBe(false);
    const r = await reconcile(fixture.dir, ["-RunId", fixture.runId]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "reconciled", checks: { task: "absent", owned: "none-alive" } });
    expect(await exists(latch)).toBe(false);
    const c = fixture.start(cId, { TEST_SCENARIO: "success" });
    const late = JSON.stringify({ runId: fixture.runId, status: "completed", phaseComplete: true, cleanup: "complete", marker: "late-A" });
    const aOut = path.join(fixture.dir, "runs", fixture.runId, "ui-out.json");
    await writeFile(aOut + ".progress.json", late);
    await writeFile(aOut + ".result.json", late);
    const second = await c.result;
    expect(second.status, second.stderr + second.lines.join(" ")).toBe(0);
    expect(outcome(second.lines)).toMatchObject({ runId: cId, status: "completed", cleanup: "complete" });
    expect(second.lines.join(" ")).not.toContain("late-A");
    expect(JSON.parse(await readFile(path.join(fixture.dir, "runs", cId, "result.json"), "utf8"))).toMatchObject({ runId: cId, status: "completed" });
    expect(await readFile(aResult, "utf8")).toBe(aFinal);
    expect(await readFile(aOut + ".result.json", "utf8")).toBe(late);
  }, 25000);
});
