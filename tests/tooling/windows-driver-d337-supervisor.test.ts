// @vitest-environment node
import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function waitFor(file: string) {
  const end = Date.now() + 8000;
  while (!await exists(file)) { if (Date.now() >= end) throw new Error("fixture never started"); await new Promise((r) => setTimeout(r, 25)); }
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

describe("D337 real supervisor with controlled kernel/Scheduler observations", () => {
  it.each(["discovery", "uia", "title-restore", "after-input", "held"])("bounds %s with retained partial phase and drains the worker", async (phase) => {
    const fixture = await supervisorFixture(phase);
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
    const value = outcome(result.lines);
    expect(value.phase).toContain(phase);
    expect(value.completedSteps).toBe(phase === "after-input" || phase === "held" ? 1 : 0);
    expect(value.inputOutcome).toBe(phase === "after-input" || phase === "held" ? "unknown" : "none");
    expect(value.cleanup).toBe("complete");
    expect(value.elapsedMs).toBeLessThan(10000);
    const members = (await readFile(path.join(fixture.dir, "members"), "utf8")).trim().split("\n").map(Number);
    expect(members.every((pid) => !alive(pid))).toBe(true);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
  }, 15000);
  it("cleans detached child/grandchild lifetimes after the root exits and preserves an unrelated process", async () => {
    const canary = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const fixture = await supervisorFixture("tree");
      const result = await fixture.start().result;
      expect(result.status).not.toBe(0); // worker did not produce a committed completion result
      const members = (await readFile(path.join(fixture.dir, "members"), "utf8")).trim().split("\n").map(Number);
      expect(members.length).toBeGreaterThanOrEqual(3);
      expect(members.every((pid) => !alive(pid))).toBe(true);
      expect(alive(canary.pid!)).toBe(true);
      const manifest = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "owned-processes.json"), "utf8"));
      expect((Array.isArray(manifest) ? manifest : [manifest]).every((v: { birth: string; exe: string }) => v.birth && v.exe)).toBe(true);
    } finally { canary.kill(); }
  }, 15000);
  it("a contender sends no input and cannot clean or consume the first invocation", async () => {
    const fixture = await supervisorFixture("discovery");
    const first = fixture.start();
    await waitFor(path.join(fixture.dir, "started"));
    const second = await fixture.start("b".repeat(32)).result;
    expect(second.status).not.toBe(0);
    expect(second.lines.join(" ")).toContain("NATIVE_SESSION_BUSY");
    expect(outcome(second.lines)).toMatchObject({ runId: "b".repeat(32), inputOutcome: "none", heldInput: "released", completedSteps: 0 });
    expect(await exists(path.join(fixture.dir, "runs", "b".repeat(32)))).toBe(false);
    const result = await first.result;
    expect(outcome(result.lines).runId).toBe(fixture.runId);
    expect(await exists(path.join(fixture.dir, "runs", fixture.runId, "result.json"))).toBe(true);
  }, 15000);
  it.each(["missing-progress", "corrupt-progress"])("%s after task start stays unknown and blocks later input", async (scenario) => {
    const fixture = await supervisorFixture(scenario);
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines)).toMatchObject({ inputOutcome: "unknown", heldInput: "uncertain" });
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
    const later = await fixture.start("d".repeat(32)).result;
    expect(later.lines.join(" ")).toContain("NATIVE_RECONCILIATION_REQUIRED");
  }, 15000);
  it("retains the last good partial prefix after the progress file disappears", async () => {
    const fixture = await supervisorFixture("lost-progress");
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines)).toMatchObject({ completedSteps: 1, inputOutcome: "unknown", op: "clickat" });
    expect(outcome(result.lines).phase).toContain("lost-progress");
  }, 15000);
  it("a stalled Scheduler cleanup returns failure and latches all later input", async () => {
    const fixture = await supervisorFixture("cleanup-stall");
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines).cleanup).toBe("failed");
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
    const later = await fixture.start("c".repeat(32)).result;
    expect(later.lines.join(" ")).toContain("NATIVE_RECONCILIATION_REQUIRED");
    expect(await exists(path.join(fixture.dir, "runs", "c".repeat(32)))).toBe(false);
  }, 15000);
});
