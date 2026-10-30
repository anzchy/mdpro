// @vitest-environment node
/// <reference lib="es2023.array" />
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function waitFor(file: string) {
  const end = Date.now() + 8000;
  while (!await exists(file)) { if (Date.now() >= end) throw new Error("worker did not start"); await new Promise((r) => setTimeout(r, 20)); }
}
describe("D337 T6 executable run isolation against pre-existing code", () => {
  it("the concurrent contender has no task directory or input and cannot remove the owner result", async () => {
    const fixture = await supervisorFixture("discovery");
    const first = fixture.start();
    await waitFor(path.join(fixture.dir, "started"));
    const contenderId = "b".repeat(32);
    const second = await fixture.start(contenderId).result;
    expect(second.status).not.toBe(0);
    expect(outcome(second.lines)).toMatchObject({ runId: contenderId, inputOutcome: "none", completedSteps: 0, heldInput: "released" });
    expect(second.lines.join(" ")).toContain("NATIVE_SESSION_BUSY");
    expect(await exists(path.join(fixture.dir, "runs", contenderId))).toBe(false);
    const owner = await first.result;
    expect(outcome(owner.lines).runId).toBe(fixture.runId);
    expect(await exists(path.join(fixture.dir, "runs", fixture.runId, "result.json"))).toBe(true);
  }, 15000);
  it("stale fixed-name and another run's late completion never satisfy the next run", async () => {
    const fixture = await supervisorFixture("success");
    const first = await fixture.start().result;
    expect(first.status, first.stderr).toBe(0);
    const laterId = "c".repeat(32);
    const late = JSON.stringify({ runId: fixture.runId, status: "completed", marker: "late-A" });
    await writeFile(path.join(fixture.dir, "ui-out.json"), late);
    const later = fixture.start(laterId);
    await writeFile(path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.result.json"), late);
    const second = await later.result;
    expect(second.status, second.stderr).toBe(0);
    expect(outcome(second.lines)).toMatchObject({ runId: laterId, status: "completed" });
    expect(JSON.parse(await readFile(path.join(fixture.dir, "runs", laterId, "result.json"), "utf8"))).toMatchObject({ runId: laterId, status: "completed" });
    expect(await readFile(path.join(fixture.dir, "ui-out.json"), "utf8")).toBe(late);
    expect(await readFile(path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.result.json"), "utf8")).toBe(late);
  }, 20000);
});
