// @vitest-environment node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapLog, bootstrapRecord, progress, runId, transaction } from "./windows-driver-d346-harness";

const latch = (dir: string) => readFile(path.join(dir, "native-session-blocked.json"), "utf8").then(JSON.parse, () => null);
// All cases use real ui-run/supervisor/Scheduler policy and retained files. The
// controlled OS observations have tester-owned Windows counterpart I1/I2.
describe("D346 terminal task detection through real ui-run and supervisor", () => {
  it.each([
    { label: "missing", log: undefined }, { label: "truncated", log: "{" },
    { label: "no-genesis", log: JSON.stringify(bootstrapRecord({ code: 65 })) + "\n" },
    { label: "wrong-run", log: bootstrapLog({ runId: "b".repeat(32) }) },
    { label: "wrong-job", log: bootstrapLog({ job: `Global\\mdpro-driver-${"b".repeat(32)}` }) },
    { label: "invalid-stage", log: bootstrapLog({ stage: "input" }) },
    { label: "bad-boolean", log: bootstrapLog({ childCreated: "false" }) },
    { label: "post-launch", log: bootstrapLog({ stage: "exited", code: 65, childCreated: true, childResumed: true }, [bootstrapRecord({ code: 65 })]) },
    { label: "duplicate-final", log: bootstrapLog({}, [bootstrapRecord({ code: 65 })]) },
  ])("never invents release from $label bootstrap evidence (enumerate, S5)", async (c) => {
    const r = await transaction([{ status: "Ready", result: 65, ...(c.log === undefined ? {} : { bootstrap: c.log }) }]);
    expect(r.status).toBe(1);
    expect(r.outcome).toMatchObject({ heldInput: "uncertain", inputOutcome: "unknown" });
    expect(await latch(r.dir)).toMatchObject({ runId, heldInput: "uncertain" });
    const retry = await r.start("b".repeat(32)).result;
    expect(retry.status).toBe(1);
    expect(retry.lines.join("\n")).toContain("NATIVE_RECONCILIATION_REQUIRED");
  }, 25000);

  it.each([
    { inputOutcome: "none", heldInput: "released", completedSteps: 0 },
    { inputOutcome: "partial", heldInput: "uncertain", completedSteps: 1 },
  ])("retains affirmative progress $inputOutcome/$heldInput (enumerate, S4)", async (value) => {
    const r = await transaction([{ status: "Ready", result: 1, progress: progress(value) }]);
    expect(r.status).toBe(1);
    expect(r.outcome.phase).toContain("NATIVE_TASK_EXITED code=1");
    expect(r.outcome).toMatchObject({ ...value, inputOutcome: value.inputOutcome === "partial" ? "unknown" : "none" });
  }, 20000);

  it.each(["{", progress({ runId: "b".repeat(32) })])("preserves uncertainty with corrupt/wrong-run progress %j (enumerate, S5)", async (value) => {
    const r = await transaction([{ status: "Ready", result: 1, progress: value }]);
    expect(r.status).toBe(1);
    expect(r.outcome).toMatchObject({ heldInput: "uncertain", inputOutcome: "unknown" });
    if (typeof value === "object") expect(r.outcome.phase).toContain("NATIVE_PROGRESS_RUN_MISMATCH");
    expect(await latch(r.dir)).toMatchObject({ heldInput: "uncertain" });
  }, 20000);

  it("keeps latest partial input after progress removal and old no-launch evidence (named, S7)", async () => {
    const r = await transaction([
      { status: "Running", result: 267009, progress: progress() },
      { status: "Running", result: 267009, progress: progress({ inputOutcome: "partial", heldInput: "uncertain", completedSteps: 1, op: "chord" }) },
      { status: "Ready", result: 7, removeProgress: true, bootstrap: bootstrapLog() },
    ]);
    expect(r.status).toBe(1);
    expect(r.outcome).toMatchObject({ completedSteps: 1, op: "chord", inputOutcome: "unknown", heldInput: "uncertain" });
    expect(r.outcome.phase).toContain("NATIVE_TASK_EXITED code=7");
    expect(await latch(r.dir)).toMatchObject({ heldInput: "uncertain" });
    expect(r.count).toBeLessThanOrEqual(4);
  }, 25000);

  it("retains primary high-bit failure and diagnostic beside failed cleanup (named, S6)", async () => {
    const r = await transaction([{ status: "Ready", result: 3221225477, bootstrap: bootstrapLog({ stage: "exited", code: 3221225477, childCreated: true, childResumed: true }) }], { cleanupFail: true });
    expect(r.status).toBe(1);
    expect(r.outcome.phase).toContain("NATIVE_TASK_EXITED code=3221225477");
    expect(r.outcome.phase).toContain("stage=exited");
    expect(r.outcome.phase).toContain("D346_CLEANUP_FAILED");
    expect(r.outcome.cleanup).toBe("failed");
    expect(await latch(r.dir)).toMatchObject({ cleanup: "failed" });
    expect(await readFile(path.join(r.dir, "unrelated-task"), "utf8")).toBe("untouched 中文");
  }, 20000);

  it.each(["identified", "unreadable", "exited"] as const)("conserves input/control provenance for %s members (enumerate, C3)", async (snapshotKind) => {
    const canary = spawn("pwsh", ["-NoProfile", "-Command", "[Threading.Thread]::Sleep(30000)"]);
    try {
      expect(canary.pid).toBeTypeOf("number");
      const r = await transaction([{ status: "Ready", result: 7 }], { snapshotKind, canaryPid: canary.pid });
      expect(r.outcome.cleanup, r.stderr + r.lines.join("\n")).toBe("complete");
      const raw = JSON.parse(await readFile(path.join(r.dir, "runs", runId, "owned-processes.json"), "utf8"));
      const members = Array.isArray(raw) ? raw : [raw];
      expect(members.map((m) => ({ pid: m.pid, job: m.job }))).toEqual([
        { pid: canary.pid, job: "input" }, { pid: canary.pid, job: "control" },
      ]);
      if (snapshotKind === "identified") expect(members.every((m) => /^\d+$/.test(m.birth) && !!m.exe)).toBe(true);
      if (snapshotKind === "unreadable") expect(members.every((m) => m.alive === true && m.birth === "")).toBe(true);
      if (snapshotKind === "exited") expect(members.every((m) => m.exited === true && m.proof === "pinned-handle-signaled")).toBe(true);
      expect(canary.exitCode).toBeNull();
      expect(() => process.kill(canary.pid!, 0)).not.toThrow();
    } finally { canary.kill(); }
  }, 25000);

});
