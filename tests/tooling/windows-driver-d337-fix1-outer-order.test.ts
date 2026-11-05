// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("gives the worker its earlier deadline when the outer loop resumes after workEnd", async () => {
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "20", PhaseMs: "1000", CleanupMs: "4000" },
    env: { TEST_PROGRESS_AFTER_FIRST_POLL: "1", TEST_SUPERVISOR_DELAY_OUTER_PAST_WORK_END: "1" },
  });
  const result = await fixture.start().result;
  const progress = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.progress.json"), "utf8"));
  const workEnd = Number(await readFile(path.join(fixture.dir, "worker-deadline"), "utf8")) - 4000;
  expect(progress.phaseStartedMs + 1000).toBeLessThan(workEnd);
  expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
}, 35000);
