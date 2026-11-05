// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

it("GH637-S9 observes a worker phase expiry while a poll child blocks and drains that child", async () => {
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "10" },
    env: { TEST_SCHED_STALL_OP: "poll", TEST_SCHED_STALL_MS: "2500" },
  });
  const result = await fixture.start().result;
  const value = outcome(result.lines);
  const runDir = path.join(fixture.dir, "runs", fixture.runId);
  const progress = JSON.parse(await readFile(path.join(runDir, "ui-out.json.progress.json"), "utf8"));
  const requestNames = (await readdir(runDir)).filter((name) => /^scheduler-.*\.json$/.test(name));
  const requests = await Promise.all(requestNames.map(async (name) => JSON.parse(await readFile(path.join(runDir, name), "utf8"))));
  const poll = requests.find((request) => request.op === "poll");
  expect(poll).toBeDefined();
  const marker = JSON.parse(await readFile(poll.readyPath, "utf8"));
  const phaseEnd = Number((await readFile(path.join(fixture.dir, "scheduler-times"), "utf8")).trim().split("\n")
    .find((line) => line.startsWith("scheduler-poll "))!.split(" ")[1]);
  expect(value.phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
  expect(value.phase).not.toContain("phase=scheduler-poll");
  expect(phaseEnd - progress.phaseStartedMs).toBeGreaterThanOrEqual(3000);
  expect(phaseEnd - progress.phaseStartedMs).toBeLessThan(3200);
  expect(alive(marker.pid)).toBe(false);
}, 15000);
