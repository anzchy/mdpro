// @vitest-environment node
/**
 * D338 K7, a batch restores every context it changed, each to its own first baseline: A (input 111,
 * thread 9) starts on CN and B (input 222, thread 19) on US. Whichever is changed first, and on a
 * revisit of the first one, each context keeps the prior HKL captured at its first activation, so
 * cleanup returns A to CN and B to US, in reverse order of first activation, each claimed only on
 * its own independent readback. An abort right after the second context changed restores both.
 * Production ui.ps1 under pwsh with Win32 doubles; label B binds in-run on its own fake page. The
 * fake's per-thread state is the observation. Distinct per-thread layouts model driver bookkeeping,
 * not a claim that Windows isolates layouts per window (R-5).
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, requests, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 90_000 });

const PHASE_MS = 1500;
type Label = "A" | "B";
const set = (window: Label) => ({ op: "setLayout", window, klid: "00000407", _identity: identity });
const focus = (window: Label) => ({ op: "focus", window, _identity: identity });
const chord = (window: Label, hkl: number) => ({ op: "physicalChord", window, keys: ["AltRight", "KeyQ"], hkl: hex(hkl), nofocus: true, _identity: identity });
const restoredA = `layout-restore input=111 thread=9 prior=${hex(CN)} observed=${hex(CN)} restored`;
const restoredB = `layout-restore input=222 thread=19 prior=${hex(US)} observed=${hex(US)} restored`;
const other = (label: Label): Label => (label === "A" ? "B" : "A");
/** The first context changed, then the second, then the first again (a revisit). */
const visits = (first: Label) => [focus(first), set(first), focus(other(first)), set(other(first)), focus(first), set(first)];
const restoreTail = (first: Label) => first === "A" ? [`222:${US}`, `111:${CN}`] : [`111:${CN}`, `222:${US}`];

describe("D338 K7 every context changed in a batch is restored to its own first baseline", () => {
  it.each(["A", "B"] as const)("%s first, then the other, then a revisit: A is CN and B is US again", async (first) => {
    const layout = layoutScene();
    const result = await runLayout(visits(first), layout, {}, { phaseMs: PHASE_MS, pageB: true });
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(result.log.join("\n")).toMatch(/setLayout requested=00000407 [^\n]* input=222 thread=19/);
    expect(result.log).toContain(restoredA);
    expect(result.log).toContain(restoredB);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
    expect(finalHkl(result.trace, layout, 19)).toBe(US);
    // The revisit finds DE already active: it posts nothing and never recaptures DE as a baseline.
    expect(requests(result.trace)).toEqual(first === "A"
      ? [`111:${DE}`, `222:${DE}`, ...restoreTail(first)]
      : [`222:${DE}`, `111:${DE}`, ...restoreTail(first)]);
    expect(result.outcome).toMatchObject({ cleanup: "complete" });
  });

  it.each(["A", "B"] as const)("%s first, abort right after the second changed: both restored, no key sent", async (first) => {
    const layout = layoutScene();
    const second = other(first);
    const steps = [focus(first), set(first), focus(second), set(second), chord(second, US)];
    const result = await runLayout(steps, layout, {}, { phaseMs: PHASE_MS, pageB: true });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toMatch(/PHYSICAL_HKL_MISMATCH[\s\S]*ABORTED at step 5/);
    expect(scans(result.trace)).toEqual([]);
    expect(result.log).toContain(restoredA);
    expect(result.log).toContain(restoredB);
    expect(requests(result.trace).slice(-2)).toEqual(restoreTail(first));
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
    expect(finalHkl(result.trace, layout, 19)).toBe(US);
    expect(result.outcome).toMatchObject({ cleanup: "complete" });
  });
});
