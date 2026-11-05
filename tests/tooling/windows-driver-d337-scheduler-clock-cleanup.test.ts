// @vitest-environment node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
const exists = async (file: string) => access(file).then(() => true, () => false);

describe("D337 cleanup readiness bound", () => {
  it("allows a short cleanup op after boot beyond the phase budget", async () => {
    const fixture = await supervisorFixture("success", { entry: { PhaseMs: "1500", CleanupMs: "5000", DeadlineMs: String(Date.now() + 20000) },
      env: { TEST_SCHED_BOOT_OP: "cleanup", TEST_SCHED_BOOT_MS: "2800" } });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines).cleanup).toBe("complete");
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
  }, 25000);

  it.each(["never ready", "ready after cleanup limit"])("keeps the latch when cleanup is %s", async (mode) => {
    const fixture = await supervisorFixture("success", {
      env: { TEST_SCHED_BOOT_OP: "cleanup", TEST_SCHED_BOOT_MS: mode === "never ready" ? "10000" : "5000" } });
    const result = await fixture.start(undefined, {}, { DeadlineMs: String(Date.now() + 20000) }).result;
    const value = outcome(result.lines);
    expect(result.status).not.toBe(0);
    expect(value.cleanup).toBe("failed");
    expect(value.phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-cleanup");
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(true);
    const later = await fixture.start("d".repeat(32), {}, { DeadlineMs: String(Date.now() + 20000) }).result;
    expect(later.lines.join(" ")).toContain("NATIVE_RECONCILIATION_REQUIRED");
    const blocked = JSON.parse(await readFile(path.join(fixture.dir, "native-session-blocked.json"), "utf8"));
    expect(blocked.cleanup).toBe("failed");
  }, 25000);
});
