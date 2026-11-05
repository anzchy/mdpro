// @vitest-environment node
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("GH637-S13 rejects a Scheduler result that becomes readable past its limit", async () => {
  const fixture = await supervisorFixture("success", {
    entry: { DeadlineMs: "0", TimeoutSec: "8" },
    env: { TEST_SUPERVISOR_RESULT_READ_DELAY_MS: "4000" },
  });
  const result = await fixture.start().result;
  expect(result.status).not.toBe(0);
  expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-start");
}, 15000);
