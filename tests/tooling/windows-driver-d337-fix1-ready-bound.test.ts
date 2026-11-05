// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it("GH637-S16 rejects a valid marker stamped after the boot ceiling even if the child succeeds", async () => {
  const fixture = await supervisorFixture("success", {
    entry: { DeadlineMs: "0", TimeoutSec: "20", PhaseMs: "4000", PollMs: "1000" },
    env: { TEST_SCHED_BOOT_OP: "start", TEST_SCHED_READY_AFTER_BOOT_MS: "5200",
      TEST_SUPERVISOR_WAIT_FOR_LATE_READY: "1" },
  });
  const result = await fixture.start().result;
  const value = outcome(result.lines);
  const ready = (await readFile(path.join(fixture.dir, "scheduler-times"), "utf8")).split("\n");
  expect(ready.some((line) => line.startsWith("scheduler-start "))).toBe(true);
  expect(result.status).not.toBe(0);
  expect(value.phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-start");
  const { readdir } = await import("node:fs/promises");
  const runDir = path.join(fixture.dir, "runs", fixture.runId);
  const request = (await readdir(runDir)).find((name) => /^scheduler-.*\.json$/.test(name));
  expect(request).toBeDefined();
  const childResult = JSON.parse(await readFile(path.join(runDir, `${request}.result`), "utf8"));
  expect(childResult.ok).toBe(true);
}, 30000);
