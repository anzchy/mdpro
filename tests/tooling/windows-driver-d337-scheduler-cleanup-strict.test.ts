// @vitest-environment node
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }

// The scheduler-cleanup proof that the run's task is gone must come from a query that can fail:
// an access-denied lookup is not "removed".
describe("D337 scheduler-cleanup: only a definite not-found proves the task removed", () => {
  it("latches with failed cleanup when the cleanup lookup is denied and the task stays registered", async () => {
    const fixture = await supervisorFixture("success", { env: { TEST_SCHED_DENY_OP: "cleanup" } });
    const result = await fixture.start().result;
    expect(await exists(path.join(fixture.dir, "task"))).toBe(true); // still registered
    expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
    const value = outcome(result.lines);
    expect(value.cleanup).toBe("failed");
    expect(result.lines.join(" ")).toContain("phase=scheduler-cleanup");
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
  }, 15000);
  it("still completes cleanup when the task is removed and the recheck reports a localized not-found", async () => {
    const fixture = await supervisorFixture("success", { env: { TEST_SCHED_QUERY: "not-found" } });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines).cleanup).toBe("complete");
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(false);
  }, 15000);
});
