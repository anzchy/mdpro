// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RUN, exists, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

// Ruling 4, Continuation 9 addendum: `exists` treats only a definite "not found" as absent; any other
// Scheduler error refuses. Each latch below is otherwise clean (input released, no owned member).
describe("D337 native-reconcile: only a definite not-found proves the task absent", () => {
  it("refuses when the Scheduler query fails without throwing (access denied)", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const r = await reconcile(dir, ["-RunId", RUN], { TEST_SCHED_QUERY: "denied" });
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused" });
    expect(String(r.result?.reason)).toContain("NATIVE_SCHEDULER_FAILED phase=reconcile-task");
    expect(r.status).toBe(1);
    expect(await exists(latchPath(dir))).toBe(true);
    expect(await exists(runPath(dir, RUN, "reconciled.json"))).toBe(false);
  }, 20000);
  it("still reconciles when the query reports a localized not-found", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const r = await reconcile(dir, ["-RunId", RUN], { TEST_SCHED_QUERY: "not-found" });
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "reconciled", checks: { task: "absent" } });
    expect(r.status).toBe(0);
    expect(await exists(latchPath(dir))).toBe(false);
    expect(await exists(runPath(dir, RUN, "reconciled.json"))).toBe(true);
  }, 20000);
});
