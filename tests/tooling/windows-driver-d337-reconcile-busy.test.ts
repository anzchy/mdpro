// @vitest-environment node
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN, exists, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D337 native-reconcile: the session lock is taken first", () => {
  it("refuses with NATIVE_SESSION_BUSY while another holder has the session lock, leaving the latch", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const lock = path.join(dir, "native-session.lock"), ready = path.join(dir, "holder-ready");
    const holder = spawn("pwsh", ["-NoProfile", "-Command",
      `$f=[IO.File]::Open('${lock}','OpenOrCreate','ReadWrite','None'); [IO.File]::WriteAllText('${ready}','1'); Start-Sleep 30`]);
    try {
      const end = Date.now() + 10000;
      while (!await exists(ready)) { if (Date.now() > end) throw new Error("holder never took the lock"); await new Promise((r) => setTimeout(r, 25)); }
      const r = await reconcile(dir, ["-RunId", RUN]);
      expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_SESSION_BUSY" });
      expect(r.status).toBe(1);
      expect(await exists(latchPath(dir))).toBe(true);
      expect(await exists(runPath(dir, RUN, "reconciled.json"))).toBe(false);
    } finally { holder.kill(); }
  }, 20000);
});
