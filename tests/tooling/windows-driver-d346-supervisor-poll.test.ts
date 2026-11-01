// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runId, transaction, type Poll } from "./windows-driver-d346-harness";

const finish = { status: "Ready", result: 0, commit: "completed" };
const latch = (dir: string) => readFile(path.join(dir, "native-session-blocked.json"), "utf8").then(JSON.parse, () => null);
const codes = [1, 7, 65, 66, 67, 125, 255, 2147483647, 2147483648, 3221225477, 3221225794, 4294967295];
// Finite independence partitions: every DWORD boundary at fresh Ready; active,
// sentinel and freshness axes separately. No 3x17x3 duplicate process sweep.
const waiting: Poll[] = [
  { status: "Running", result: 1 }, { status: "Queued", result: 3221225477 },
  ...[0, 267008, 267009, 267011, null].map((result) => ({ status: "Ready", result })),
  { status: "Ready", result: 7, lastRunTime: "stale" },
];

// All cases use real ui-run/supervisor/Scheduler policy and retained files. The
// controlled OS observations have tester-owned Windows counterpart I1/I2.
describe("D346 terminal task detection through real ui-run and supervisor", () => {
  it.each(codes)("fails fresh terminal DWORD %i within one subsequent poll (enumerate, S1/S2)", async (code) => {
    const r = await transaction([{ status: "Ready", result: code }]);
    expect(r.status, r.stderr + r.lines.join("\n")).toBe(1);
    expect(r.outcome).toMatchObject({ status: "failed", heldInput: "uncertain", inputOutcome: "unknown", completedSteps: 0, cleanup: "complete" });
    expect(r.outcome.phase).toContain(`NATIVE_TASK_EXITED code=${code}`);
    expect(r.outcome.phase).not.toMatch(/TIMEOUT/);
    expect(r.count).toBeLessThanOrEqual(2);
    expect(await latch(r.dir)).toMatchObject({ runId, heldInput: "uncertain" });
    expect(await readFile(path.join(r.dir, "task"), "utf8").catch(() => "absent")).toBe("absent");
  }, 20000);

  it.each(waiting)("waits active/sentinel/stale observation $status/$result/$lastRunTime (enumerate, S2)", async (first) => {
    const r = await transaction([first, finish]);
    expect(r.status, r.stderr + r.lines.join("\n")).toBe(0);
    expect(r.outcome.status).toBe("completed");
    expect(r.count).toBe(2);
  }, 20000);


});
