// @vitest-environment node
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runJob } from "./windows-driver-native-job-harness";

// Kernel APIs are controlled; membership, lifetime inspection and cleanup policy are real.
// Real Windows descendant inheritance and Scheduler proof remain I3/I6.
describe("D337 T5 executable lifetime ownership against pre-existing code", () => {
  it("drains the pinned owned child and preserves a simultaneously live unrelated lifetime", async () => {
    const canary = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const result = await runJob(`
        $child=$scope.StartOwned($node,$arguments)
        $before=@($scope.Snapshot())
        $scope.Stop()
        @{ before=$before; after=@($scope.Snapshot()).Count; childAlive=(-not $child.HasExited) } | ConvertTo-Json -Compress -Depth 6
      `);
      expect(result.status, result.stderr).toBe(0);
      expect(result.value.before).toEqual([expect.objectContaining({ birth: expect.any(String), exe: process.execPath, pid: expect.any(Number) })]);
      expect(result.value.after).toBe(0);
      expect(result.value.childAlive).toBe(false);
      expect(() => process.kill(canary.pid!, 0)).not.toThrow();
    } finally { canary.kill(); }
  }, 15000);
  it("refuses an unrelated process returned by a stale job PID list and preserves it", async () => {
    const canary = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const result = await runJob(`
        [NativeJobScope]::ReportedPid=${canary.pid}
        [NativeJobScope]::RejectMember=$true
        $before=@($scope.Snapshot())
        $scope.Stop()
        @{ before=$before.Count; after=@($scope.Snapshot()).Count } | ConvertTo-Json -Compress
      `);
      expect(result.status, result.stderr).toBe(0);
      expect(result.value).toEqual({ before: 0, after: 0 });
      expect(() => process.kill(canary.pid!, 0)).not.toThrow();
    } finally { canary.kill(); }
  }, 15000);
});
