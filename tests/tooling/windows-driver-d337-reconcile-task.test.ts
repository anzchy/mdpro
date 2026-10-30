// @vitest-environment node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";
import { RUN, exists, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D337 native-reconcile: the run's scheduled task must be gone", () => {
  it("refuses while the real latching run left its mdpro-audit-ui-<id> task registered", async () => {
    const fixture = await supervisorFixture("cleanup-stall");
    await fixture.start().result;
    expect(await exists(latchPath(fixture.dir))).toBe(true);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(true); // the stalled Unregister never finished
    const r = await reconcile(fixture.dir, ["-RunId", fixture.runId]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_TASK_PRESENT" });
    expect(r.status).toBe(1);
    expect(await exists(latchPath(fixture.dir))).toBe(true);
    expect(await exists(runPath(fixture.dir, fixture.runId, "reconciled.json"))).toBe(false);
  }, 30000);
  it("fails closed when the Scheduler query itself fails", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    await writeFile(path.join(dir, "task"), "mdpro-audit-ui-" + RUN); // registered, but the fake query cannot read rootpid
    const r = await reconcile(dir, ["-RunId", RUN]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused" });
    expect(String(r.result?.reason)).toContain("NATIVE_SCHEDULER_FAILED phase=reconcile-task");
    expect(r.status).toBe(1);
    expect(await exists(latchPath(dir))).toBe(true);
  }, 20000);
});
