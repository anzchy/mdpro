// @vitest-environment node
/**
 * D338 K7, one context's restore cannot hide or stop another's: A (input 111, thread 9, CN) and B
 * (input 222, thread 19, US) are both changed. A failed restore of either is reported with that
 * context's own input, thread, prior and observed HKL, and the other context is still restored and
 * read back. A request still pending on one context makes only that context's restore uncertain.
 * Production ui.ps1 under pwsh with Win32 doubles; label B binds in-run on its own fake page.
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, runLayout } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 90_000 });

const PHASE_MS = 1500;
const set = (window: "A" | "B") => ({ op: "setLayout", window, klid: "00000407", _identity: identity });
const focus = (window: "A" | "B") => ({ op: "focus", window, _identity: identity });
const both = [focus("A"), set("A"), focus("B"), set("B")];
const restoredA = `layout-restore input=111 thread=9 prior=${hex(CN)} observed=${hex(CN)} restored`;
const restoredB = `layout-restore input=222 thread=19 prior=${hex(US)} observed=${hex(US)} restored`;
const failedA = `LAYOUT_RESTORE_FAILED input=111 thread=9 prior=${hex(CN)} observed=${hex(DE)}`;
const failedB = `LAYOUT_RESTORE_FAILED input=222 thread=19 prior=${hex(US)} observed=${hex(DE)}`;

describe("D338 K7 a failed restore names its own context and the other is still restored", () => {
  it.each([
    ["A's restore is rejected", { 9: "reject" as const }, failedA, restoredB, 9, 19],
    ["B's restore is rejected (B is restored first)", { 19: "reject" as const }, failedB, restoredA, 19, 9],
  ])("%s", async (_name, restore, failed, restored, failedThread, restoredThread) => {
    const layout = layoutScene({ restore });
    const result = await runLayout(both, layout, {}, { phaseMs: PHASE_MS, pageB: true });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toContain(failed);
    expect(result.log).toContain(restored);
    expect(finalHkl(result.trace, layout, failedThread)).toBe(DE);
    expect(finalHkl(result.trace, layout, restoredThread)).toBe(layout.threads[restoredThread]);
    expect(result.outcome).toMatchObject({ status: "failed", cleanup: "failed" });
  });

  it("both restores fail: both contexts are reported, neither claimed", async () => {
    const layout = layoutScene({ restore: { 9: "noop", 19: "noop" } });
    const result = await runLayout(both, layout, {}, { phaseMs: PHASE_MS, pageB: true });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toContain(failedA);
    expect(text).toContain(failedB);
    expect(text).not.toMatch(/ restored$/m);
    expect(result.outcome).toMatchObject({ cleanup: "failed" });
  });
});

describe("D338 K7 a pending request is tracked per context", () => {
  it("B's activation times out with its request pending: B is uncertain, A is restored", async () => {
    const layout = layoutScene({ request: { 19: "noop" } });
    const result = await runLayout(both, layout, {}, { phaseMs: PHASE_MS, pageB: true });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toMatch(/LAYOUT_NOT_OBSERVED requested=00000407[^\n]* input=222 thread=19[\s\S]*ABORTED at step 4/);
    expect(text).toContain(`LAYOUT_RESTORE_UNCERTAIN input=222 thread=19 prior=${hex(US)} observed=${hex(US)} reason=request-pending`);
    expect(result.log).toContain(restoredA);
    expect(text).not.toContain("LAYOUT_RESTORE_UNCERTAIN input=111");
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
    expect(result.outcome).toMatchObject({ cleanup: "failed" });
  });
});
