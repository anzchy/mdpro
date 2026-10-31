// @vitest-environment node
/**
 * D338 K5, every exit restores the first prior layout or fails explicitly: after a successful run,
 * an abort after activation and a failed activation, cleanup posts the context's first captured
 * prior HKL to its input window and claims restoration only after an independent read of the input
 * thread equals it twice across a settle wait. A second activation never replaces that baseline.
 * An already-active layout changes nothing, before or after. A restore that is rejected or has no
 * effect fails the run with LAYOUT_RESTORE_FAILED and the observed HKL, and cleanup is `failed`.
 * The driver never unloads or reloads a layout on these paths (the language list is untouched).
 * Production ui.ps1 under pwsh with Win32 doubles; the fake's per-thread state is the observation.
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, requests, runLayout } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const PHASE_MS = 1500;
const FR = 0x040c040c;
const set = (klid: string) => ({ op: "setLayout", window: "A", klid, _identity: identity });
const chord = (hkl: number) => ({ op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(hkl), nofocus: true, _identity: identity });
const restored = (prior: number) => `layout-restore input=111 thread=9 prior=${hex(prior)} observed=${hex(prior)} restored`;
const noUnload = (trace: string[]) => expect(trace.filter((line) => line.startsWith("layout-unload:"))).toEqual([]);

describe("D338 K5 cleanup restores the first prior layout on every exit", () => {
  it.each([
    ["the run completes", [set("00000407"), chord(DE)], {}, 0],
    ["a later step aborts", [set("00000407"), chord(US)], {}, 1],
    ["activation itself fails", [set("00000407"), chord(DE)], { request: { 9: "variant" as const } }, 1],
  ])("%s: A's input thread is CN again, independently read", async (_name, steps, extra, status) => {
    const layout = layoutScene(extra);
    const result = await runLayout(steps, layout, {}, { phaseMs: PHASE_MS });
    expect(result.status, result.log.join("\n")).toBe(status);
    expect(result.log).toContain(restored(CN));
    expect(requests(result.trace).at(-1)).toBe(`111:${CN}`);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
    expect(result.outcome).toMatchObject({ cleanup: "complete" });
    noUnload(result.trace);
  });

  it("two activations restore the first baseline, never the intermediate layout", async () => {
    const layout = layoutScene({ load: { "00000407": DE, "0000040C": FR }, list: [CN, US, DE, FR] });
    const result = await runLayout([set("00000407"), set("0000040C")], layout, {}, { phaseMs: PHASE_MS });
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(requests(result.trace)).toEqual([`111:${DE}`, `111:${FR}`, `111:${CN}`]);
    expect(result.log).toContain(restored(CN));
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
  });

  it("an already-active layout sends no request at activation or at cleanup", async () => {
    const layout = layoutScene({ threads: { 7: US, 8: US, 9: DE, 19: US, 99: US } });
    const result = await runLayout([set("00000407"), chord(DE)], layout, {}, { phaseMs: PHASE_MS });
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(requests(result.trace)).toEqual([]);
    expect(result.trace.filter((line) => line.startsWith("layout-state:"))).toEqual([]);
    expect(result.log).toContain(restored(DE));
  });
});

describe("D338 K5 a restore that does not take effect fails explicitly", () => {
  it.each([
    ["rejected", "reject" as const],
    ["accepted with no effect", "noop" as const],
  ])("%s: LAYOUT_RESTORE_FAILED with the observed HKL, cleanup failed, no restored claim", async (_name, mode) => {
    const layout = layoutScene({ restore: { 9: mode } });
    const result = await runLayout([set("00000407"), chord(DE)], layout, {}, { phaseMs: PHASE_MS });
    const text = result.log.join("\n");
    expect(result.status, text).toBe(1);
    expect(text).toContain(`LAYOUT_RESTORE_FAILED input=111 thread=9 prior=${hex(CN)} observed=${hex(DE)}`);
    expect(text).not.toMatch(/ restored$/m);
    expect(result.outcome).toMatchObject({ status: "failed", cleanup: "failed" });
    expect(finalHkl(result.trace, layout, 9)).toBe(DE);
    expect(result.outcome.elapsedMs).toBeLessThan(PHASE_MS + 8000);
  });
});
