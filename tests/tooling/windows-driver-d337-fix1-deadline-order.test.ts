// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

it("GH637-S17 gives the earlier worker expiry its phase when a poll tick sees both deadlines expired", async () => {
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "10", PhaseMs: "5000", CleanupMs: "4000" },
    env: { TEST_SCHED_STALL_OP: "poll", TEST_SCHED_STALL_MS: "10000",
      TEST_WORKER_EXPIRY_BEFORE_WORK_LIMIT_MS: "1000", TEST_CLEANUP_MS: "4000", TEST_WORKER_PHASE_MS: "5000",
      TEST_SUPERVISOR_DELAY_POLL_TICK_PAST_LIMIT: "1" },
  });
  const result = await fixture.start().result;
  const value = outcome(result.lines);
  const runDir = path.join(fixture.dir, "runs", fixture.runId);
  const progress = JSON.parse(await readFile(path.join(runDir, "ui-out.json.progress.json"), "utf8"));
  const requests = (await readdir(runDir)).filter((name) => /^scheduler-.*\.json$/.test(name));
  const poll = (await Promise.all(requests.map(async (name) => JSON.parse(await readFile(path.join(runDir, name), "utf8")))))
    .find((request) => request.op === "poll");
  expect(poll).toBeDefined();
  const marker = JSON.parse(await readFile(poll.readyPath, "utf8"));
  const workEnd = Number(await readFile(path.join(fixture.dir, "worker-deadline"), "utf8")) - 4000;
  expect(progress.phaseStartedMs + 5000).toBeLessThan(Math.min(workEnd, marker.readyUtcMs + 5000));
  expect(value.phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
  expect(alive(marker.pid)).toBe(false);
}, 20000);
