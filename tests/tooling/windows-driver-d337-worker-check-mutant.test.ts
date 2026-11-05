// @vitest-environment node
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("GH637-S10 synthetic uia stall retains its worker-phase source assertion", async () => {
  const fixture = await supervisorFixture("uia", { entry: { DeadlineMs: "0", TimeoutSec: "10" } });
  const result = await fixture.start().result;
  expect(result.status).not.toBe(0);
  expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
  expect(outcome(result.lines).phase).not.toContain("phase=scheduler-poll");
}, 15000);
