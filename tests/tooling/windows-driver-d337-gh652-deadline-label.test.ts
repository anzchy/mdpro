// @vitest-environment node
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function readEventually<T>(file: string, decode: (text: string) => T, timeoutMs = 12000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { return decode(await readFile(file, "utf8")); } catch { await sleep(20); }
  }
  throw new Error(`timed out reading ${file}`);
}
const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));

async function runEarlierDeadline(kind: "marker" | "boot") {
  const phaseMs = 2000;
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "22", PhaseMs: String(phaseMs), CleanupMs: "4000", PollMs: "1000" },
    env: { TEST_SUPERVISOR_HOLD_UNREAD_POLL: "1", TEST_WORKER_PHASE_START_FUTURE_MS: "20000",
      ...(kind === "marker"
        ? { TEST_SCHED_STALL_OP: "poll", TEST_SCHED_STALL_MS: "10000" }
        : { TEST_SCHED_BOOT_OP: "poll", TEST_SCHED_BOOT_MS: "10000" }) },
  });
  const run = fixture.start();
  const release = path.join(fixture.dir, "release-poll-tick");
  try {
    const clock = await readEventually(path.join(fixture.dir, "poll-clock.json"), JSON.parse) as
      { bootEnd: number; limit: number; readyPath: string };
    const progressPath = path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.progress.json");
    const progress = await readEventually(progressPath, JSON.parse) as { phaseStartedMs: number };
    const marker = kind === "marker"
      ? await readEventually(clock.readyPath, JSON.parse) as { readyUtcMs: number }
      : null;
    if (marker) expect(marker.readyUtcMs).toBeLessThanOrEqual(clock.bootEnd);
    const schedulerEnd = marker ? marker.readyUtcMs + phaseMs : clock.bootEnd;
    const workerEnd = schedulerEnd + 200;
    progress.phaseStartedMs = workerEnd - phaseMs;
    await writeFile(progressPath, JSON.stringify(progress));
    expect(workerEnd).toBeLessThan(clock.limit);
    while (Date.now() < workerEnd + 150) await sleep(10);
    await writeFile(release, "go");
    const result = await run.result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(1);
    expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=scheduler-poll");
  } finally {
    await writeFile(release, "go").catch(() => run.child.kill("SIGKILL"));
    const timer = setTimeout(() => run.child.kill("SIGKILL"), 10000);
    try { await run.result; } finally { clearTimeout(timer); }
  }
}

it("GH652-S1 labels an unread ready marker before a later worker deadline", async () => {
  await runEarlierDeadline("marker");
}, 35000);

it("GH652-S2 labels the boot ceiling before a later worker deadline", async () => {
  await runEarlierDeadline("boot");
}, 35000);

it("GH652-S3 labels the worker after poll exit when its deadline precedes boot", async () => {
  const phaseMs = 2000;
  const fixture = await supervisorFixture("uia", {
    entry: { DeadlineMs: "0", TimeoutSec: "22", PhaseMs: String(phaseMs), CleanupMs: "4000", PollMs: "1000" },
    // A 10 s boot window leaves room both to reach the held poll and before the 18 s work limit.
    env: { TEST_SUPERVISOR_HOLD_POST_EXIT_POLL: "1", TEST_SUPERVISOR_BOOT_WINDOW_MS: "10000",
      TEST_SCHED_BOOT_OP: "poll", TEST_SCHED_BOOT_MODE: "exit",
      TEST_WORKER_PHASE_START_FUTURE_MS: "20000" },
  });
  const run = fixture.start();
  const release = path.join(fixture.dir, "release-post-exit");
  try {
    await readEventually(path.join(fixture.dir, "post-exit-held"), String);
    const clock = await readEventually(path.join(fixture.dir, "post-exit-clock.json"), JSON.parse) as
      { bootEnd: number; limit: number; readyPath: string };
    const progressPath = path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.progress.json");
    const progress = await readEventually(progressPath, JSON.parse) as { phaseStartedMs: number };
    const workerEnd = clock.bootEnd - 200;
    expect(Date.now()).toBeLessThan(workerEnd);
    expect(workerEnd).toBeLessThan(clock.bootEnd);
    expect(clock.bootEnd).toBeLessThan(clock.limit);
    expect(await access(clock.readyPath).then(() => true, () => false)).toBe(false);
    progress.phaseStartedMs = workerEnd - phaseMs;
    await writeFile(progressPath, JSON.stringify(progress));
    while (Date.now() < clock.bootEnd + 150) await sleep(10);
    await writeFile(release, "go");
    const result = await run.result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(1);
    expect(outcome(result.lines).phase).toContain("NATIVE_PHASE_TIMEOUT phase=uia");
  } finally {
    await writeFile(release, "go").catch(() => run.child.kill("SIGKILL"));
    const timer = setTimeout(() => run.child.kill("SIGKILL"), 10000);
    try { await run.result; } finally { clearTimeout(timer); }
  }
}, 35000);
