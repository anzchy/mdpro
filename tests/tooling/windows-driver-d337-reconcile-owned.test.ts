// @vitest-environment node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { RUN, exists, identity, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D337 native-reconcile: no process the run owned may be alive", () => {
  it("refuses while a recorded member is alive with the same pid, birth and exe", async () => {
    const survivor = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const dir = await reconcileDir();
      await writeLatch(dir, RUN, {}, await identity(survivor.pid!)); // one member serializes as an object, not an array
      const r = await reconcile(dir, ["-RunId", RUN]);
      expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: `NATIVE_RECONCILE_OWNED_ALIVE pid=${survivor.pid}` });
      expect(r.status).toBe(1);
      expect(await exists(latchPath(dir))).toBe(true);
      expect(await exists(runPath(dir, RUN, "reconciled.json"))).toBe(false);
    } finally { survivor.kill(); }
  }, 20000);
  it("refuses when the run left no owned-process manifest", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN, {}, null);
    const r = await reconcile(dir, ["-RunId", RUN]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_MANIFEST_MISSING" });
    expect(await exists(latchPath(dir))).toBe(true);
  }, 20000);
  it("refuses when the manifest cannot be read", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    await writeFile(runPath(dir, RUN, "owned-processes.json"), "[{\"pid\":");
    const r = await reconcile(dir, ["-RunId", RUN]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_MANIFEST_INVALID" });
    expect(await exists(latchPath(dir))).toBe(true);
  }, 20000);
});
