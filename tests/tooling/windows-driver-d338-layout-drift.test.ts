// @vitest-environment node
/**
 * D338 K4, the activated input context keeps its lifetime: `setLayout` pins A's input child (111)
 * with a driver property and every later read of that context (the activation poll, the HKL read
 * before each physical event, the cleanup restore) requires the same window with the same pin.
 * An input child destroyed and re-created under the same HWND fails with LAYOUT_INPUT_REPLACED:
 * no key reaches it, nothing is activated on it, and cleanup never posts a restore into it, so the
 * restore fails explicitly instead. The pin is removed at cleanup. Focus moving to B during the
 * poll stops the run with no request to B and no key. Production ui.ps1 under pwsh with Win32
 * doubles; the fake's per-thread state and window properties are the observation.
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, requests, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const PHASE_MS = 1500;
const set = { op: "setLayout", window: "A", klid: "00000407", _identity: identity };
const chord = { op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true, _identity: identity };
const replacedRestore = new RegExp(`LAYOUT_RESTORE_FAILED input=111 thread=9 prior=${hex(CN)} observed=unknown reason=.*LAYOUT_INPUT_REPLACED`);

describe("D338 K4 the activated input child is pinned for the run", () => {
  it("pins 111 before the request and removes the pin after the last key", async () => {
    const result = await runLayout([set, chord], layoutScene(), {}, { phaseMs: PHASE_MS });
    expect(result.status, result.log.join("\n")).toBe(0);
    const pin = result.trace.indexOf("layout-pin:111");
    const unpin = result.trace.lastIndexOf("layout-unpin:111");
    expect(pin).toBeGreaterThanOrEqual(0);
    expect(pin).toBeLessThan(result.trace.findIndex((line) => line.startsWith("layout-request:")));
    expect(unpin).toBeGreaterThan(result.trace.findLastIndex((line) => line.startsWith("scan:")));
    expect(result.trace.filter((line) => line === "layout-pin:111").length).toBe(1);
  });

  it("replaced during the activation poll: LAYOUT_INPUT_REPLACED, no key, and no restore posted into the replacement", async () => {
    const layout = layoutScene({ request: { 9: "late" }, lateReads: 3, replaceAt: 2, replaceHwnd: 111 });
    const result = await runLayout([set, chord], layout, {}, { phaseMs: PHASE_MS });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toMatch(/LAYOUT_INPUT_REPLACED input=111[\s\S]*ABORTED at step 1/);
    expect(text).not.toContain("setLayout requested=");
    expect(scans(result.trace)).toEqual([]);
    expect(requests(result.trace)).toEqual([`111:${DE}`]);
    expect(text).toMatch(replacedRestore);
    expect(text).not.toMatch(/ restored$/m);
    expect(result.outcome).toMatchObject({ status: "failed", cleanup: "failed", inputOutcome: "none" });
  });

  it("replaced after activation, before the first key: no scan, and the layout left on it is reported, not restored", async () => {
    const layout = layoutScene({ replaceAt: 3, replaceHwnd: 111 });
    const result = await runLayout([set, chord], layout, {}, { phaseMs: PHASE_MS });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toContain(`setLayout requested=00000407 loaded=${hex(DE)} before=${hex(CN)} observed=${hex(DE)}`);
    expect(text).toMatch(/LAYOUT_INPUT_REPLACED input=111[\s\S]*ABORTED at step 2/);
    expect(scans(result.trace)).toEqual([]);
    expect(requests(result.trace)).toEqual([`111:${DE}`]);
    expect(finalHkl(result.trace, layout, 9)).toBe(DE);
    expect(text).toMatch(replacedRestore);
    expect(result.outcome).toMatchObject({ status: "failed", cleanup: "failed" });
  });
});

describe("D338 K4 focus drift during activation", () => {
  it("focus moves to B during the poll: the run stops with no request to B and no key", async () => {
    const layout = layoutScene({ request: { 9: "noop" }, focusDriftAt: 2 });
    const result = await runLayout([set, chord], layout, {}, { phaseMs: PHASE_MS });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toMatch(/IDENTITY_NATIVE_FOREGROUND_CHANGED[\s\S]*ABORTED at step 1/);
    expect(text).not.toContain("setLayout requested=");
    expect(requests(result.trace).filter((request) => request.startsWith("222:"))).toEqual([]);
    expect(scans(result.trace)).toEqual([]);
    expect(finalHkl(result.trace, layout, 19)).toBe(US);
  });
});
