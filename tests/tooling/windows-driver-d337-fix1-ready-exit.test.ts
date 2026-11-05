// @vitest-environment node
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("GH637-S21 rereads a valid marker published after the tick timestamp before an exited child is judged", async () => {
  const fixture = await supervisorFixture("success", {
    entry: { DeadlineMs: "0", TimeoutSec: "12" },
    env: { TEST_SCHED_BOOT_OP: "start", TEST_SCHED_RACE_AFTER_SAMPLE: "1", TEST_SUPERVISOR_READY_EXIT_RACE: "1" },
  });
  const result = await fixture.start().result;
  expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
  expect(outcome(result.lines)).toMatchObject({ status: "completed", cleanup: "complete" });
}, 20000);
