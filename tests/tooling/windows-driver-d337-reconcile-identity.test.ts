// @vitest-environment node
/// <reference lib="es2023.array" />
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN, exists, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D337 native-reconcile: the latch must name the run being reconciled", () => {
  it("refuses a run id the latch does not name and leaves the latch in place", async () => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const r = await reconcile(dir, ["-RunId", "b".repeat(32)]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_RUN_MISMATCH" });
    expect(r.status).toBe(1);
    expect(await exists(latchPath(dir))).toBe(true);
    expect(await exists(runPath(dir, RUN, "reconciled.json"))).toBe(false);
  }, 20000);
  it("refuses when no latch exists", async () => {
    const dir = await reconcileDir();
    const r = await reconcile(dir, ["-RunId", RUN]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_NOT_LATCHED" });
    expect(r.status).toBe(1);
  }, 20000);
  it.each(["../" + RUN, RUN.toUpperCase(), ""])("rejects malformed run id %j with status 2 before taking the lock", async (id) => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN);
    const r = await reconcile(dir, ["-RunId", id]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_INVALID" });
    expect(r.status).toBe(2);
    expect(await exists(path.join(dir, "native-session.lock"))).toBe(false);
    expect(await exists(latchPath(dir))).toBe(true);
  }, 20000);
});
