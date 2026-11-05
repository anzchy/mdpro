// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

it.each(["nonce", "pid", "stale"])("rejects a %s marker and starts the operation clock only at the later valid marker", async (badMarker) => {
  const fixture = await supervisorFixture("success", {
    entry: { DeadlineMs: "0", TimeoutSec: "12", PhaseMs: "2500" },
    env: { TEST_SCHED_BOOT_OP: "start", TEST_SCHED_BAD_MARKER: badMarker,
      TEST_SCHED_BAD_MARKER_GAP_MS: "1500", TEST_SCHED_STALL_OP: "start", TEST_SCHED_STALL_MS: "10000" },
  });
  const result = await fixture.start().result;
  const runDir = path.join(fixture.dir, "runs", fixture.runId);
  const requests = (await readdir(runDir)).filter((name) => /^scheduler-.*\.json$/.test(name));
  const start = (await Promise.all(requests.map(async (name) => JSON.parse(await readFile(path.join(runDir, name), "utf8")))))
    .find((request) => request.op === "start");
  expect(start).toBeDefined();
  const marker = await readFile(start.readyPath, "utf8").then(JSON.parse, () => null);
  expect(marker, result.stderr + result.lines.join(" ")).not.toBeNull();
  const end = Number((await readFile(path.join(fixture.dir, "scheduler-times"), "utf8"))
    .split("\n").find((line) => line.startsWith("scheduler-start "))!.split(" ")[1]);
  expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-start");
  expect(end - marker.readyUtcMs).toBeGreaterThanOrEqual(2400);
  expect(end - marker.readyUtcMs).toBeLessThan(3000);
}, 20000);
