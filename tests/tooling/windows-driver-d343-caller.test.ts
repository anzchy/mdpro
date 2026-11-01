// @vitest-environment node
import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { caller, check } from "./windows-driver-d343-harness";
import { LATCH, latchBytes, outcome } from "./windows-driver-d342-budget-harness";

describe("D343 real Mac encoding to native entry", () => {
  it("passes all smoke lists through 5.1 validation without changing the existing latch", async () => {
    const inputs = [[{ op: "max" }], [{ op: "windows" }], [{ op: "max", note: "中文" }, { op: "wait", ms: 500 }, { op: "windows" }]];
    for (const steps of inputs) {
      const result = await caller(JSON.stringify(steps));
      expect(result.status, result.stderr + result.stdout).toBe(1);
      expect(outcome(result.stdout.trim().split(/\r?\n/))).toMatchObject({ status: "failed", phase: "setup: NATIVE_RECONCILIATION_REQUIRED", completedSteps: 0, inputOutcome: "none", heldInput: "released", cleanup: "not-started" });
      expect(result.dispatches).toHaveLength(1);
      const b64 = result.dispatches[0].StepsB64 as string;
      expect(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))).toEqual(steps);
      await check([{ id: "actual caller bytes", b64 }]);
      expect(await latchBytes(result.dir)).toBe(LATCH);
      expect((await readdir(result.dir)).sort()).toEqual(["bin", "bridge.ps1", "dispatches.jsonl", "native-session-blocked.json", "native-validation.ps1", "ui-run.ps1"]);
    }
  }, 15000);
});
