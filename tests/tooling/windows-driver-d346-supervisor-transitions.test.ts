// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runD346Job } from "./windows-driver-d346-job-harness";
import { bootstrapLog, runId, transaction, type Poll } from "./windows-driver-d346-harness";

const finish = { status: "Ready", result: 0, commit: "completed" };
const latch = (dir: string) => readFile(path.join(dir, "native-session-blocked.json"), "utf8").then(JSON.parse, () => null);
// All cases use real ui-run/supervisor/Scheduler policy and retained files. The
// controlled OS observations have tester-owned Windows counterpart I1/I2.
describe("D346 terminal task detection through real ui-run and supervisor", () => {
  it.each(["equal", "offset"])("includes exact start timestamp represented as %s (enumerate, S2/S3)", async (lastRunTime) => {
    const r = await transaction([{ status: "Ready", result: 7, lastRunTime }]);
    expect(r.status, r.stderr + r.lines.join("\n")).toBe(1);
    expect(r.outcome.phase).toContain("NATIVE_TASK_EXITED code=7");
    expect(r.count).toBeLessThanOrEqual(2);
  }, 20000);

  it.each(["bogus", 1.5, -1, 4294967296])("refuses malformed DWORD %j (enumerate, S2)", async (result) => {
    const r = await transaction([{ status: "Ready", result }, finish]);
    expect(r.status).toBe(1);
    expect(r.outcome.phase).toContain("NATIVE_TASK_RESULT_INVALID");
    expect(r.count).toBeLessThanOrEqual(2);
  }, 20000);

  it.each([null, "not-a-date"])("cannot make invalid lastRunTime %j fresh (enumerate, S2)", async (lastRunTime) => {
    const r = await transaction([{ status: "Ready", result: 7, lastRunTime }, finish]);
    expect(r.outcome.phase).not.toContain("NATIVE_TASK_EXITED");
    expect(["NATIVE_TASK_TIME_INVALID", "worker-complete"].some((s) => r.outcome.phase.includes(s))).toBe(true);
    expect(r.status === 0 ? r.count === 2 : r.outcome.heldInput === "uncertain").toBe(true);
  }, 20000);

  it.each([
    [{ status: "Ready", result: 267009 }, finish],
    [{ status: "Ready", result: 7, afterStatus: "Running" }, finish],
    [{ status: "Running", result: 1 }, finish],
    [{ status: "Ready", result: 7, lastRunTime: "stale" }, { status: "Running", result: 267009 }, { status: "Ready", result: 7 }],
    [{ status: "Ready", result: 267011 }, { status: "Running", result: 267009 }, finish],
  ])("handles independently changing State/Info sequence %j (enumerate, S3)", async (...sequence) => {
    const polls = sequence as Poll[];
    const terminal = polls.at(-1)?.result === 7;
    const r = await transaction(polls);
    expect(r.status, r.lines.join("\n")).toBe(terminal ? 1 : 0);
    expect(r.outcome.phase).toContain(terminal ? "NATIVE_TASK_EXITED code=7" : "worker-complete");
    expect(r.count).toBeGreaterThanOrEqual(polls.length);
    expect(r.count).toBeLessThanOrEqual(polls.length + (terminal ? 1 : 0));
  }, 25000);

  it.each([
    { result: 0, commit: "completed", status: 0 },
    { result: 7, commit: "failed", status: 7 },
    { result: 0, commit: "wrong-run", status: 1 },
  ])("binds committed result $commit/$result to the exact run (enumerate, S3)", async (c) => {
    const r = await transaction([{ status: "Ready", result: c.result, commit: c.commit }]);
    expect(r.status, r.lines.join("\n")).toBe(c.status);
    expect(r.count).toBe(1);
    if (c.commit === "wrong-run") expect(r.outcome.phase).toContain("NATIVE_RESULT_RUN_MISMATCH");
    else expect(r.outcome.status).toBe(c.status === 0 ? "completed" : "failed");
  }, 20000);

  it.each([
    { code: 65, fields: { stage: "open" }, released: true },
    { code: 66, fields: { stage: "launch" }, released: true },
    { code: 65, fields: { stage: "exited", childCreated: true, childResumed: true }, released: false },
    { code: 66, fields: { stage: "launch", childCreated: true }, released: false },
    { code: 67, fields: { stage: "wait", childCreated: true, childResumed: true }, released: false },
  ])("uses launch truth rather than numerical code $code/$fields (enumerate, S4/A4)", async (c) => {
    const evidence = bootstrapLog({ ...c.fields, code: c.code });
    const r = await transaction([{ status: "Ready", result: c.code, bootstrap: evidence }]);
    expect(r.status).toBe(1);
    expect(r.outcome.phase).toContain(`NATIVE_TASK_EXITED code=${c.code}`);
    expect(r.outcome.phase).toContain(`stage=${c.fields.stage}`);
    expect(r.outcome).toMatchObject({ heldInput: c.released ? "released" : "uncertain", inputOutcome: c.released ? "none" : "unknown", cleanup: "complete" });
    expect(await readFile(path.join(r.dir, "runs", runId, "bootstrap.log"), "utf8")).toBe(evidence);
    expect(await latch(r.dir)).toEqual(c.released ? null : expect.objectContaining({ heldInput: "uncertain" }));
  }, 20000);

  it.each([false, true])("preserves actual Main log/launch truth into OUTCOME, worker launched=%s (enumerate, A4)", async (launched) => {
    const produced = await runD346Job(`
      [NativeJobScope]::FailOpen=$${!launched}
      [NativeJobScope]::OverrideCode=$${launched}; [NativeJobScope]::ExitCode=[uint32]65
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($arguments))
      $rc=[NativeJobScope]::Main([string[]]@($scope.Name,$node,$encoded,$runDir))
      @{rc=$rc}|ConvertTo-Json -Compress
    `);
    expect(produced.status, produced.stdout + produced.stderr).toBe(0);
    expect(produced.value.rc).toBe(65);
    expect(produced.log).not.toBe("");
    const r = await transaction([{ status: "Ready", result: produced.value.rc, bootstrap: produced.log }]);
    expect(r.status).toBe(1);
    expect(r.outcome.phase).toContain("NATIVE_TASK_EXITED code=65");
    expect(r.outcome.phase).toContain(launched ? "stage=exited" : "stage=open");
    expect(r.outcome).toMatchObject({ cleanup: "complete", heldInput: launched ? "uncertain" : "released", inputOutcome: launched ? "unknown" : "none" });
    expect(await readFile(path.join(r.dir, "runs", runId, "bootstrap.log"), "utf8")).toBe(produced.log);
    expect(await latch(r.dir)).toEqual(launched ? expect.objectContaining({ heldInput: "uncertain" }) : null);
  }, 25000);


});
