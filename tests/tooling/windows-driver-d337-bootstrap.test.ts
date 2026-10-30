// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runJob } from "./windows-driver-native-job-harness";

// The Scheduler-started bootstrap (NativeJobScope.Main) on the real C#, kernel entry points
// doubled. Its status is the worker's status, so a failed wait or an unproved termination
// must be a bootstrap failure, never a child exit code or a silent success.
function bootstrap(setup: string, argumentsExpression = "$arguments") {
  return runJob(`
      ${setup}
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${argumentsExpression}))
      $rc=[NativeJobScope]::Main([string[]]@($scope.Name,$node,$encoded))
      $childPid=[NativeJobScope]::LastPid
      $alive=$false; try { $alive=-not [Diagnostics.Process]::GetProcessById($childPid).HasExited } catch {}
      @{ rc=$rc; childPid=$childPid; alive=$alive; effect=(Test-Path "$PSScriptRoot/effect-$childPid") } | ConvertTo-Json -Compress
    `);
}

describe("D337 bootstrap termination edges", () => {
  it("returns the owned child's own exit code after a successful wait", async () => {
    const result = await bootstrap("", `'-e "process.exit(3)"'`);
    expect(result.trace).toContain("assign:self");
    expect(result.value.rc, result.stderr).toBe(3);
    expect(result.stderr).not.toContain("NATIVE_BOOTSTRAP_FAILED");
  }, 15000);

  it("a failed wait is a bootstrap failure that terminates the live child, never STILL_ACTIVE", async () => {
    const result = await bootstrap("[NativeJobScope]::FailWait=$true");
    expect(result.value.rc, result.stderr).not.toBe(259);
    expect(result.value.rc).toBe(1);
    expect(result.stderr).toContain("NATIVE_BOOTSTRAP_FAILED");
    expect(result.trace).toContain("terminate:" + String(result.value.childPid));
    expect(result.value.alive).toBe(false);
  }, 15000);

  it("an unproved termination after a launch failure is reported, not hidden behind the launch error", async () => {
    const result = await bootstrap("[NativeJobScope]::FailResume=$true; [NativeJobScope]::FailTerminate=$true");
    expect(result.value.rc, result.stderr).toBe(1);
    expect(result.stderr).toContain("NATIVE_BOOTSTRAP_FAILED");
    expect(result.stderr).toContain("NATIVE_BOOTSTRAP_CLEANUP_FAILED pid=" + String(result.value.childPid));
    // Truthful: the suspended child really survived, and it never received its resume gate.
    expect(result.value.alive).toBe(true);
    expect(result.value.effect).toBe(false);
  }, 15000);
});
