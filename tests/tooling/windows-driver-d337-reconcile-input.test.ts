// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";
import { RUN, exists, latchPath, reconcile, reconcileDir, runPath, writeLatch } from "./windows-driver-native-reconcile-harness";

describe("D337 native-reconcile: uncertain held input needs the operator's confirmation", () => {
  it("refuses a real held-input latch without -InputReleasedConfirmed and replays nothing", async () => {
    const fixture = await supervisorFixture("held");
    await fixture.start().result;
    const latch = JSON.parse((await readFile(latchPath(fixture.dir), "utf8")).replace(/^﻿/, ""));
    expect(latch).toMatchObject({ runId: fixture.runId, heldInput: "uncertain" });
    const r = await reconcile(fixture.dir, ["-RunId", fixture.runId]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_INPUT_UNCONFIRMED" });
    expect(r.status).toBe(1);
    expect(await exists(latchPath(fixture.dir))).toBe(true);
    expect(await exists(runPath(fixture.dir, fixture.runId, "reconciled.json"))).toBe(false);
  }, 30000);
  it.each([{ heldInput: "unknown" }, { heldInput: undefined }])("treats latch %o as uncertain", async (fields) => {
    const dir = await reconcileDir();
    await writeLatch(dir, RUN, fields);
    const r = await reconcile(dir, ["-RunId", RUN]);
    expect(r.result, r.stdout + r.stderr).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_INPUT_UNCONFIRMED" });
    expect(await exists(latchPath(dir))).toBe(true);
  }, 20000);
});
