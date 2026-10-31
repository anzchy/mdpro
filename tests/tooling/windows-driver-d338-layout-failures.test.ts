// @vitest-environment node
/**
 * D338 K3, an accepted request is not an activation: a rejected request fails at once; a request
 * that is accepted but changes nothing, changes only the driver's thread or the owner's outer
 * thread, or applies another layout of the same language, fails with LAYOUT_NOT_OBSERVED within
 * the phase budget, reporting the requested KLID and the loaded, before and observed HKLs. A
 * missing or foreign input window and an unreadable HKL fail before any request. No case sends a
 * key, and none reports activation. Production ui.ps1 under pwsh with Win32 doubles; the fake's own
 * per-thread state is the independent observation.
 */
import { describe, expect, it, vi } from "vitest";
import type { LayoutScenario } from "./windows-driver-native-layout-fake";
import { CN, DE, DE_VARIANT, US, finalHkl, hex, identity, layoutScene, requests, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const PHASE_MS = 1500;
const chord = { op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true, _identity: identity };
const steps = [{ op: "setLayout", window: "A", klid: "00000407", _identity: identity }, chord];
type Layout = NonNullable<LayoutScenario["layout"]>;

async function failing(layout: Layout, code: RegExp) {
  const result = await runLayout(steps, layout, {}, { phaseMs: PHASE_MS });
  const text = result.log.join("\n");
  expect(result.status, text).toBe(1);
  expect(text).toMatch(new RegExp(code.source + String.raw`[\s\S]*ABORTED at step 1`));
  expect(text).not.toContain("setLayout requested=");
  expect(scans(result.trace)).toEqual([]);
  expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
  return result;
}

describe("D338 K3 a request that is not observed on the input thread fails, bounded", () => {
  it("rejected: LAYOUT_REQUEST_REJECTED with the before and observed values, without polling", async () => {
    const layout = layoutScene({ request: { 9: "reject" } });
    const result = await failing(layout, new RegExp(`LAYOUT_REQUEST_REJECTED requested=00000407 loaded=${hex(DE)} before=${hex(CN)} observed=${hex(CN)}`));
    expect(requests(result.trace)).toEqual([`111:${DE}`]);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
  });

  it.each([
    ["accepted with no effect", { 9: "noop" }, CN, [9, CN]],
    ["changes only the driver's thread", { 9: "driver" }, CN, [99, DE]],
    ["changes only the owner's outer thread", { 9: "outer" }, CN, [7, DE]],
    ["applies another German layout with the same language word", { 9: "variant" }, DE_VARIANT, [9, DE_VARIANT]],
  ] as const)("a request that is %s: LAYOUT_NOT_OBSERVED within the phase budget", async (_name, request, observed, [thread, state]) => {
    const layout = layoutScene({ request });
    const result = await failing(layout,
      new RegExp(`LAYOUT_NOT_OBSERVED requested=00000407 loaded=${hex(DE)} before=${hex(CN)} observed=${hex(observed)} input=111 thread=9`));
    expect(result.outcome.elapsedMs).toBeLessThan(PHASE_MS + 6000);
    const restores = thread === 9 && state !== CN;
    expect(requests(result.trace)).toEqual(restores ? [`111:${DE}`, `111:${CN}`] : [`111:${DE}`]);
    expect(result.trace.includes(`layout-state:${thread}:${state}`)).toBe(state !== layout.threads[thread]);
    expect(finalHkl(result.trace, layout, thread)).toBe(restores ? CN : state);
    expect(finalHkl(result.trace, layout, 9)).not.toBe(DE);
  });
});

describe("D338 K3 no request without a readable input context", () => {
  it.each([
    ["no focus window", { zeroFocus: true }, /LAYOUT_INPUT_UNREADABLE/],
    ["a focus window outside the owner", { foreignFocus: true }, /LAYOUT_INPUT_OUTSIDE input=222/],
    ["an unreadable HKL", { zeroHkl: true }, /LAYOUT_HKL_UNREADABLE input=111 thread=9/],
  ] as const)("%s: fails before any load or request", async (_name, extra, code) => {
    const layout = layoutScene(extra);
    const result = await failing(layout, code);
    expect(result.trace.filter((line) => line.startsWith("layout-load:"))).toEqual([]);
    expect(requests(result.trace)).toEqual([]);
    expect([finalHkl(result.trace, layout, 9), finalHkl(result.trace, layout, 19)]).toEqual([CN, US]);
  });
});
