// @vitest-environment node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";
import { RUN, exists, identity, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D337 native-reconcile: a proven-over run's latch is moved, never deleted or replayed", () => {
  it("moves a confirmed held-input latch to runs/<id>/reconciled.json and lets the next run start", async () => {
    const fixture = await supervisorFixture("held");
    await fixture.start().result;
    const before = await readFile(latchPath(fixture.dir));
    const members = await readFile(path.join(fixture.dir, "members"), "utf8");
    const r = await reconcile(fixture.dir, ["-RunId", fixture.runId, "-InputReleasedConfirmed"]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ runId: fixture.runId, status: "reconciled",
      checks: { lock: "held", runId: "match", task: "absent", owned: "none-alive", heldInput: "operator-confirmed" } });
    expect(r.status).toBe(0);
    expect(await exists(latchPath(fixture.dir))).toBe(false);
    expect(await readFile(runPath(fixture.dir, fixture.runId, "reconciled.json"))).toEqual(before);
    const record = JSON.parse((await readFile(runPath(fixture.dir, fixture.runId, "reconcile-checks.json"), "utf8")).replace(/^﻿/, ""));
    expect(record).toMatchObject({ runId: fixture.runId, inputReleasedConfirmed: true, checks: { task: "absent", owned: "none-alive" } });
    expect(await readFile(path.join(fixture.dir, "members"), "utf8")).toBe(members); // no worker was started again
    const next = await fixture.start("d".repeat(32)).result;
    expect(next.lines.join(" ")).not.toContain("NATIVE_RECONCILIATION_REQUIRED");
    expect(await exists(runPath(fixture.dir, "d".repeat(32), "result.json"))).toBe(true);
  }, 40000);
  it("a recorded pid now held by a process of a different birth does not block", async () => {
    const other = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      const dir = await reconcileDir();
      await writeLatch(dir, RUN, {}, [{ ...identity(other.pid!), birth: "1" }]);
      const r = await reconcile(dir, ["-RunId", RUN]);
      expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "reconciled", checks: { owned: "none-alive", heldInput: "released" } });
      expect(r.status).toBe(0);
      expect(await exists(latchPath(dir))).toBe(false);
    } finally { other.kill(); }
  }, 20000);
});
