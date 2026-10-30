// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runJob } from "./windows-driver-native-job-harness";

describe("D337 bounded kernel cleanup and termination failures", () => {
  it("rechecks transient termination waits using the override until the owned handle is signaled", async () => {
    const result = await runJob(`
      $env:MDPRO_NATIVE_POLL_MS="7"
      $env:MDPRO_NATIVE_CLEANUP_DEADLINE_MS=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+1500).ToString()
      [NativeJobScope]::FailAssign=$true
      [NativeJobScope]::WaitTimeoutCount=2
      $errorText=""
      try { [void]$scope.StartOwned($node,$arguments) } catch { $errorText=$_.Exception.Message }
      @{ error=$errorText; remaining=@($scope.Snapshot()).Count } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.remaining).toBe(0);
    expect(result.value.error).not.toContain("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED");
    expect(result.trace.filter((v) => v.startsWith("wait:"))).toEqual(["wait:7", "wait:7", "wait:7"]);
  }, 15000);
  it("an app-launch resume failure cannot hide a failed termination", async () => {
    const result = await runJob(`
      $env:MDPRO_NATIVE_JOB=$scope.Name
      [NativeJobScope]::FailResume=$true
      [NativeJobScope]::FailTerminate=$true
      $errorText=""
      try { [NativeJobScope]::LaunchApp($node,$arguments) } catch { $errorText=$_.Exception.Message }
      @{ error=$errorText; effect=(Test-Path "$PSScriptRoot/effect-$([NativeJobScope]::LastPid)") } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.error).toContain("NATIVE_APP_CLEANUP_FAILED");
    expect(result.value.effect).toBe(false);
  }, 15000);
  it("a job termination refusal stays a cleanup failure", async () => {
    const result = await runJob(`
      [NativeJobScope]::FailJobStop=$true
      $errorText=""
      try { $scope.Stop() } catch { $errorText=$_.Exception.Message }
      @{ error=$errorText } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.error).toContain("NATIVE_JOB_STOP_FAILED");
  }, 15000);
});
