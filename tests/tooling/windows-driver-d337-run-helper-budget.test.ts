// @vitest-environment node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareNative } from "./windows-driver-native-harness";
import { kernelSource } from "./windows-driver-native-job-harness";

// RunHelper on the real ui.ps1 dispatch with the real NativeJobScope; only kernel entry
// points are doubled. Windows job termination is asynchronous, so cleanup must wait within
// the transaction's cleanup reservation, not the already-expired phase deadline, and a
// cleanup failure must never hide the phase that timed out.
async function runHelper(helperBody: string, env: Record<string, string>) {
  const fixture = await prepareNative([]);
  const helper = path.join(fixture.dir, "helper.cjs");
  await writeFile(helper, `const fs=require('fs'),p=require('path');const root=process.env.JOB_TEST_ROOT;
fs.appendFileSync(p.join(root,'helper-pid'),process.pid+'\\n');${helperBody}`);
  await writeFile(fixture.stepsPath, JSON.stringify([{ op: "run", exe: process.execPath, args: '"' + helper + '"' }]));
  await writeFile(path.join(fixture.dir, "kernel.cs"), await kernelSource());
  await writeFile(path.join(fixture.dir, "trace"), "");
  let script = await readFile(fixture.scriptPath, "utf8");
  script = script.replace('if ($env:MDPRO_NATIVE_JOB) { . "$PSScriptRoot\\native-job.ps1" }', `
Add-Type -Path "$PSScriptRoot/kernel.cs"
$scope=New-Object NativeJobScope ("Global\\mdpro-driver-"+("a"*32))
$env:MDPRO_NATIVE_JOB=$scope.Name
$env:MDPRO_NATIVE_CLEANUP_DEADLINE_MS=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+[long]$env:JOB_TEST_CLEANUP_MS).ToString()
`);
  // Observe helper liveness after RunHelper returned, before the fixture reaper runs.
  script = script.replace("Finish-Outcome $failed", `$alive=@()
if (Test-Path "$env:JOB_TEST_ROOT/helper-pid") { foreach ($id in [IO.File]::ReadAllLines("$env:JOB_TEST_ROOT/helper-pid")) {
  try { $p=[Diagnostics.Process]::GetProcessById([int]$id); if (-not $p.HasExited) { $alive += $id } } catch {} } }
[IO.File]::WriteAllText("$env:JOB_TEST_ROOT/alive-after", ($alive -join ","))
$scope.Stop(); [NativeJobScope]::ReapFixtures()
Finish-Outcome $failed`);
  await writeFile(fixture.scriptPath, script);
  const result = await new Promise<{ status: number | null; stderr: string }>((done) => {
    const child = spawn("pwsh", ["-NoProfile", "-File", fixture.scriptPath, "-Steps", fixture.stepsPath, "-Out", fixture.outPath,
      "-PhaseMs", "400", "-CleanupMs", "3000"], {
      env: { ...process.env, JOB_TEST_ROOT: fixture.dir, MDPRO_TEST_SCENARIO: "{}", MDPRO_TEST_TRACE: fixture.tracePath, ...env },
    });
    let stderr = "";
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("close", (status) => done({ status, stderr }));
  });
  const log = (JSON.parse(await readFile(fixture.outPath, "utf8")) as string[]).join("\n");
  const trace = await readFile(path.join(fixture.dir, "trace"), "utf8");
  const read = (name: string) => readFile(path.join(fixture.dir, name), "utf8").catch(() => null);
  return { ...result, log, trace, alive: await read("alive-after"), pids: await read("helper-pid") };
}

describe("D337 RunHelper budgets", () => {
  it("reports the run-helper phase timeout and drains an asynchronously terminated helper within the cleanup reservation", async () => {
    const r = await runHelper("setInterval(()=>{},1000);", { JOB_TEST_STOP_DELAY_MS: "300", JOB_TEST_CLEANUP_MS: "10000" });
    expect(r.status, r.stderr).toBe(1);
    expect(r.trace).toContain("job-stop-async:300");
    expect(r.log).toMatch(/ERROR run: .*NATIVE_PHASE_TIMEOUT phase=run-helper/);
    expect(r.log).not.toContain("NATIVE_HELPER_CLEANUP_FAILED");
    expect(r.log).toContain("ABORTED at step 1");
    expect(r.pids?.trim()).toMatch(/^\d+$/);
    expect(r.alive).toBe("");
  }, 30000);

  it("keeps the timed-out phase when the owned helper outlives the cleanup reservation", async () => {
    const r = await runHelper("setInterval(()=>{},1000);", { JOB_TEST_STOP_DELAY_MS: "8000", JOB_TEST_CLEANUP_MS: "1500" });
    expect(r.status, r.stderr).toBe(1);
    expect(r.log).toMatch(/ERROR run: .*NATIVE_PHASE_TIMEOUT phase=run-helper; NATIVE_HELPER_CLEANUP_FAILED/);
    expect(r.log).toContain("ABORTED at step 1");
    // The failure is truthful: the helper really is still alive when RunHelper gives up.
    expect(r.alive).toBe(r.pids?.trim());
  }, 30000);

  it("refuses an invalid poll override before starting any helper", async () => {
    const r = await runHelper("fs.writeFileSync(p.join(root,'helper-effect'),'ran');", { MDPRO_NATIVE_POLL_MS: "0", JOB_TEST_CLEANUP_MS: "10000" });
    expect(r.status, r.stderr).toBe(1);
    expect(r.log).toMatch(/ERROR run: .*NATIVE_BUDGET_INVALID/);
    expect(r.pids).toBeNull();
    expect(r.trace).not.toContain("create:");
  }, 30000);
});
