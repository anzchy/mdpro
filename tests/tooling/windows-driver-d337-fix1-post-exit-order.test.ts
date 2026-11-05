// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("gives the worker its earlier deadline after a Scheduler child exits and result reading crosses both limits", async () => {
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "10", PhaseMs: "5000", CleanupMs: "4000" },
    env: { TEST_WORKER_EXPIRY_BEFORE_WORK_LIMIT_MS: "1000", TEST_CLEANUP_MS: "4000", TEST_WORKER_PHASE_MS: "5000",
      TEST_SUPERVISOR_RESULT_READ_DELAY_MS: "6500" },
  });
  const result = await fixture.start().result;
  const progress = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.progress.json"), "utf8"));
  const workEnd = Number(await readFile(path.join(fixture.dir, "worker-deadline"), "utf8")) - 4000;
  expect(progress.phaseStartedMs + 5000).toBeLessThan(workEnd);
  expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
}, 20000);
