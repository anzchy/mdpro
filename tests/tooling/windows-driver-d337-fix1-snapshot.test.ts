// @vitest-environment node
/**
 * D337 fix 1 (opus M2): a job member whose identity read throws during Snapshot (it exited, or
 * became unreadable, between the kernel list and the read) no longer fails the whole snapshot.
 * Snapshot catches per member and keeps going; a member not proved exited stays reported, so
 * cleanup still waits for it. Real NativeJobScope source with kernel entry points substituted.
 */
import { describe, expect, it } from "vitest";
import { runJob } from "./windows-driver-native-job-harness";

describe("D337 fix 1 Snapshot survives one member's identity read throwing", () => {
  it("reports every live member and raises nothing", async () => {
    const result = await runJob(`
      $a=$scope.StartOwned($node,$arguments); $b=$scope.StartOwned($node,$arguments)
      [NativeJobScope]::ThrowIdentityOnce=$true
      $errorText=""; $members=@()
      try { $members=@($scope.Snapshot()) } catch { $errorText=$_.Exception.Message }
      @{ error=$errorText; pids=@($members | ForEach-Object { $_.pid } | Sort-Object); expected=@(@($a.Id,$b.Id) | Sort-Object) } | ConvertTo-Json -Compress
    `);
    expect({ error: result.value.error, pids: result.value.pids }).toEqual({ error: "", pids: result.value.expected });
  }, 15000);
});
