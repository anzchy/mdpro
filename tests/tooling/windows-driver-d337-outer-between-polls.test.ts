// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("GH637-S15 catches worker expiry after a poll exits and before another poll starts", async () => {
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "10", PhaseMs: "1000", PollMs: "1000" },
    env: { TEST_PROGRESS_AFTER_FIRST_POLL: "1" },
  });
  const result = await fixture.start().result;
  expect(outcome(result.lines).phase, result.stderr).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
  const runDir = path.join(fixture.dir, "runs", fixture.runId);
  const progress = JSON.parse(await readFile(path.join(runDir, "ui-out.json.progress.json"), "utf8"));
  const pollEnd = Number((await readFile(path.join(fixture.dir, "scheduler-times"), "utf8"))
    .split("\n").find((line) => line.startsWith("scheduler-poll "))!.split(" ")[1]);
  const requests = (await readdir(runDir)).filter((name) => /^scheduler-.*\.json$/.test(name));
  const polls = (await Promise.all(requests.map(async (name) => JSON.parse(await readFile(path.join(runDir, name), "utf8")))))
    .filter((request) => request.op === "poll");
  expect(pollEnd).toBeLessThan(progress.phaseStartedMs + 1000);
  expect(result.status).not.toBe(0);
  expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
  expect(polls).toHaveLength(1);
}, 15000);
