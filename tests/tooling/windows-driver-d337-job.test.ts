// @vitest-environment node
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runJob } from "./windows-driver-native-job-harness";

describe("D337 production kernel containment policy", () => {
  it("a stale kernel PID observation cannot authorize a replacement lifetime", async () => {
    const canary = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const result = await runJob(`
        [NativeJobScope]::ReportedPid=${canary.pid}
        [NativeJobScope]::RejectMember=$true
        @{ members=@($scope.Snapshot()).Count } | ConvertTo-Json -Compress
      `);
      expect(result.status, result.stderr).toBe(0);
      expect(result.value.members).toBe(0);
      expect(canary.exitCode).toBeNull();
      expect(() => process.kill(canary.pid!, 0)).not.toThrow();
    } finally { canary.kill(); }
  }, 15000);

  it("pins membership before resume, stops the owned lifetime, and leaves an unrelated process alive", async () => {
    const canary = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const result = await runJob(`
        $child=$scope.StartOwned($node,$arguments)
        $end=[DateTime]::UtcNow.AddSeconds(3)
        while(-not (Test-Path "$PSScriptRoot/effect-$($child.Id)")) {
          if([DateTime]::UtcNow -ge $end){throw "fixture effect missing"}; [Threading.Thread]::Sleep(10)
        }
        $members=@($scope.Snapshot())
        $effect=[IO.File]::ReadAllText("$PSScriptRoot/effect-$($child.Id)")
        $scope.Stop()
        @{ effect=$effect; members=$members; after=@($scope.Snapshot()).Count;
           flags=[NativeJobScope]::ObservedFlags; creation=[NativeJobScope]::LastCreationFlags } | ConvertTo-Json -Compress -Depth 6
      `);
      expect(result.status, result.stderr).toBe(0);
      expect(result.value.effect).toBe("owned");
      expect(result.value.after).toBe(0);
      expect(result.value.members).toEqual([expect.objectContaining({ pid: expect.any(Number), birth: expect.any(String), exe: process.execPath })]);
      expect(Number(result.value.flags) & 0x2000).toBe(0x2000);
      expect(Number(result.value.flags) & 0x1000).toBe(0);
      expect(Number(result.value.creation) & 4).toBe(4);
      expect(() => process.kill(canary.pid!, 0)).not.toThrow();
    } finally { canary.kill(); }
  }, 15000);

  it("an assignment refusal destroys the suspended child before any input effect", async () => {
    const result = await runJob(`
      [NativeJobScope]::FailAssign=$true
      $errorText=""
      try { [void]$scope.StartOwned($node,$arguments) } catch { $errorText=$_.Exception.Message }
      $childId=[NativeJobScope]::LastPid
      @{ error=$errorText; effect=(Test-Path "$PSScriptRoot/effect-$childId");
         alive=($null -ne (Get-Process -Id $childId -ErrorAction SilentlyContinue)) } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.error).not.toBe("");
    expect(result.value.effect).toBe(false);
    expect(result.value.alive).toBe(false);
    expect(result.trace.some((line) => line.startsWith("resume:"))).toBe(false);
  }, 15000);

  it("an unreadable kernel inventory throws rather than claiming zero owned members", async () => {
    const result = await runJob(`
      [NativeJobScope]::FailQuery=$true
      $errorText=""
      try { [void]$scope.Snapshot() } catch { $errorText=$_.Exception.Message }
      @{ error=$errorText } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.error).not.toBe("");
  }, 15000);

  it("an unassigned child that cannot be terminated makes cleanup explicitly unproved", async () => {
    const result = await runJob(`
      [NativeJobScope]::FailAssign=$true
      [NativeJobScope]::FailTerminate=$true
      $startError=""; $inventoryError=""; $stopError=""
      try { [void]$scope.StartOwned($node,$arguments) } catch { $startError=$_.Exception.Message }
      try { [void]$scope.Snapshot() } catch { $inventoryError=$_.Exception.Message }
      try { $scope.Stop() } catch { $stopError=$_.Exception.Message }
      $childId=[NativeJobScope]::LastPid
      @{ startError=$startError; inventoryError=$inventoryError; stopError=$stopError;
         effect=(Test-Path "$PSScriptRoot/effect-$childId") } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.startError).toContain("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED");
    expect(result.value.inventoryError).toContain("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED");
    expect(result.value.stopError).toContain("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED");
    expect(result.value.effect).toBe(false);
    expect(result.trace.some((line) => line.startsWith("resume:"))).toBe(false);
  }, 15000);

  it("explicit application breakaway survives stopping the driver's job", async () => {
    const result = await runJob(`
      $env:MDPRO_NATIVE_JOB=$scope.Name
      [NativeJobScope]::LaunchApp($node,$arguments)
      $appId=[NativeJobScope]::LastPid
      $end=[DateTime]::UtcNow.AddSeconds(3)
      while(-not (Test-Path "$PSScriptRoot/effect-$appId")) {
        if([DateTime]::UtcNow -ge $end){throw "fixture app effect missing"}; [Threading.Thread]::Sleep(10)
      }
      $scope.Stop()
      @{ alive=($null -ne (Get-Process -Id $appId -ErrorAction SilentlyContinue));
         effect=[IO.File]::ReadAllText("$PSScriptRoot/effect-$appId");
         creation=[NativeJobScope]::LastCreationFlags; members=@($scope.Snapshot()).Count } | ConvertTo-Json -Compress
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.alive).toBe(true);
    expect(result.value.effect).toBe("unowned");
    expect(result.value.members).toBe(0);
    expect(Number(result.value.creation) & 0x1000000).toBe(0x1000000);
  }, 15000);
});
