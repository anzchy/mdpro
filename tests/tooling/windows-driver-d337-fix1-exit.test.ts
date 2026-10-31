// @vitest-environment node
/**
 * D337 fix 1 (opus M4): one exit code per meaning. A run the Windows supervisor bounded itself
 * (NATIVE_PHASE_TIMEOUT or NATIVE_TRANSACTION_TIMEOUT, reported with its phase) exits 1, as
 * reference/ops.md states; 124 stays the Mac's own "no answer came back" code. Real ui-run.ps1
 * and supervisor under pwsh, with the Scheduler and kernel job substituted.
 */
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

describe("D337 fix 1 a Windows-bounded timeout exits 1", () => {
  it("a stalled phase ends with exit 1, not 124", async () => {
    const fixture = await supervisorFixture("discovery");
    const result = await fixture.start().result;
    expect(result.status, result.lines.join(" ")).toBe(1);
  }, 20000);
});
