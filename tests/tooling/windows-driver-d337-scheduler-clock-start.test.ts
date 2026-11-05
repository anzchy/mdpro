// @vitest-environment node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
const exists = async (file: string) => access(file).then(() => true, () => false);
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function schedulerChildrenGone(dir: string) {
  const pids = (await readFile(path.join(dir, "scheduler-pids"), "utf8")).trim().split("\n").map(Number);
  return pids.length > 0 && pids.every((pid) => !alive(pid));
}

describe("D337 Scheduler child readiness", () => {
  it("gives a short start operation its full phase after slow child boot", async () => {
    const fixture = await supervisorFixture("success", { entry: { PhaseMs: "1000", DeadlineMs: String(Date.now() + 20000) },
      env: { TEST_SCHED_BOOT_OP: "start", TEST_SCHED_BOOT_MS: "3500" } });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines)).toMatchObject({ status: "completed", cleanup: "complete" });
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
  }, 25000);

  it.each(["nonce", "pid", "stale", "future"])("rejects a %s marker before the child is ready", async (badMarker) => {
    const fixture = await supervisorFixture("missing-progress", {
      env: { TEST_SCHED_BOOT_OP: "start", TEST_SCHED_BAD_MARKER: badMarker, TEST_SCHED_BOOT_MS: "10000" } });
    const started = Date.now();
    const result = await fixture.start(undefined, {}, { DeadlineMs: String(Date.now() + 20000) }).result;
    const value = outcome(result.lines);
    expect(result.status).not.toBe(0);
    expect(value.phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-start");
    expect(Date.now() - started).toBeLessThan(10000);
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
    expect(await schedulerChildrenGone(fixture.dir)).toBe(true);
    const later = await fixture.start("d".repeat(32), {}, { DeadlineMs: String(Date.now() + 20000) }).result;
    expect(later.lines.join(" ")).toContain("NATIVE_RECONCILIATION_REQUIRED");
    const manifest = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "owned-processes.json"), "utf8"));
    expect(Array.isArray(manifest) || typeof manifest === "object").toBe(true);
  }, 20000);

  it("fails a child that exits before readiness with the phase name", async () => {
    const fixture = await supervisorFixture("missing-progress", { env: { TEST_SCHED_BOOT_OP: "start", TEST_SCHED_BOOT_MODE: "exit" } });
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines).phase).toContain("phase=scheduler-start");
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
    expect(await schedulerChildrenGone(fixture.dir)).toBe(true);
  }, 15000);
});
