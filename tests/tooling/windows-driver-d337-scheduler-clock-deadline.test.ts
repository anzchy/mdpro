// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

async function clock(fixture: Awaited<ReturnType<typeof supervisorFixture>>, op: string) {
  const dir = path.join(fixture.dir, "runs", fixture.runId);
  const requests = (await readdir(dir)).filter((name) => /^scheduler-.*\.json$/.test(name));
  const request = (await Promise.all(requests.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8")))))
    .find((item) => item.op === op);
  expect(request).toBeDefined();
  const marker = JSON.parse(await readFile(request.readyPath, "utf8"));
  const trace = (await readFile(path.join(fixture.dir, "scheduler-times"), "utf8")).trim().split("\n")
    .map((line) => ({ name: line.split(" ")[0], at: Number(line.split(" ")[1]) }));
  return { ready: marker.readyUtcMs as number, end: trace.find((item) => item.name === `scheduler-${op}`)!.at };
}

describe("D337 Scheduler operation clock", () => {
  it.each(["start", "poll"])("times a blocked %s operation from child readiness", async (op) => {
    const fixture = await supervisorFixture("success", { entry: { PhaseMs: "1500" },
      env: { TEST_SCHED_STALL_OP: op, TEST_SCHED_STALL_MS: "10000" } });
    const result = await fixture.start().result;
    const measured = await clock(fixture, op);
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines).phase).toContain(`NATIVE_PHASE_TIMEOUT phase=scheduler-${op}`);
    expect(measured.end - measured.ready).toBeGreaterThanOrEqual(1400);
    expect(measured.end - measured.ready).toBeLessThan(1900);
  }, 20000);

  it("lets the shorter absolute work limit win over the poll phase", async () => {
    const fixture = await supervisorFixture("success", { entry: { PhaseMs: "4000", CleanupMs: "4000" },
      env: { TEST_SCHED_STALL_OP: "poll", TEST_SCHED_STALL_MS: "10000" } });
    const limit = Date.now() + 8500;
    const workLimit = limit - 4000;
    const result = await fixture.start(undefined, {}, { DeadlineMs: String(limit) }).result;
    const measured = await clock(fixture, "poll");
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-poll");
    expect(measured.end).toBeGreaterThanOrEqual(workLimit - 100);
    expect(measured.end).toBeLessThan(workLimit + 400);
    expect(measured.end).toBeLessThan(measured.ready + 4000);
  }, 20000);
});
