// @vitest-environment node
/**
 * D338 K4, a request that is still pending cannot be restored with certainty: when activation times
 * out and A's input thread never moved off its prior HKL, the posted request may still be queued
 * and apply after the run. Cleanup then reads the prior HKL but never claims restoration: it fails
 * with LAYOUT_RESTORE_UNCERTAIN and the observed value, and cleanup is `failed`. A late request that
 * settles inside the poll, and a request the window rejected, leave nothing pending and restore
 * normally. Production ui.ps1 under pwsh with Win32 doubles; the fake's per-thread state is the
 * observation.
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, finalHkl, hex, identity, layoutScene, requests, runLayout } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const PHASE_MS = 1500;
const NEVER = 1_000_000;
const set = { op: "setLayout", window: "A", klid: "00000407", _identity: identity };
const restored = `layout-restore input=111 thread=9 prior=${hex(CN)} observed=${hex(CN)} restored`;

describe("D338 K4 a request pending at the activation timeout makes the restore uncertain", () => {
  it.each([
    ["queued and not applied before the run ends", { request: { 9: "late" as const }, lateReads: NEVER }],
    ["accepted with no visible effect", { request: { 9: "noop" as const } }],
  ])("a request %s: LAYOUT_RESTORE_UNCERTAIN, never restored, cleanup failed", async (_name, extra) => {
    const layout = layoutScene(extra);
    const result = await runLayout([set], layout, {}, { phaseMs: PHASE_MS });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toMatch(/LAYOUT_NOT_OBSERVED requested=00000407[\s\S]*ABORTED at step 1/);
    expect(text).toContain(`LAYOUT_RESTORE_UNCERTAIN input=111 thread=9 prior=${hex(CN)} observed=${hex(CN)} reason=request-pending`);
    expect(text).not.toMatch(/ restored$/m);
    expect(requests(result.trace)).toEqual([`111:${DE}`]);
    expect(result.outcome).toMatchObject({ status: "failed", cleanup: "failed" });
  });
});

describe("D338 K4 nothing pending, normal restore", () => {
  it("a late request that settles inside the poll: activated, then restored to CN", async () => {
    const layout = layoutScene({ request: { 9: "late" }, lateReads: 3 });
    const result = await runLayout([set], layout, {}, { phaseMs: PHASE_MS });
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(result.log.join("\n")).toContain(`observed=${hex(DE)}`);
    expect(result.log).toContain(restored);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
    expect(result.outcome).toMatchObject({ cleanup: "complete" });
  });

  it("a rejected request: nothing was queued, so the unchanged prior is restored", async () => {
    const layout = layoutScene({ request: { 9: "reject" } });
    const result = await runLayout([set], layout, {}, { phaseMs: PHASE_MS });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toMatch(/LAYOUT_REQUEST_REJECTED/);
    expect(result.log).toContain(restored);
    expect(result.outcome).toMatchObject({ cleanup: "complete" });
  });
});
