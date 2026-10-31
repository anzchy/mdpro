// @vitest-environment node
/**
 * D338 fix 1 (MH1, physical keys): the held-input progress write is durable before the final HWND,
 * foreground and input-thread HKL checks, and nothing else happens between those checks and the
 * scan. An HKL change on A's input thread injected exactly at that write (the old gap) therefore
 * sends no scan: the chord stops with PHYSICAL_HKL_MISMATCH. Production ui.ps1 under pwsh.
 */
import { describe, expect, it, vi } from "vitest";
import { DE, US, hex, identity, layoutScene, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const chord = { op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true, _identity: identity };

describe("D338 fix 1 a transition at the held-input progress write never reaches a scan", () => {
  it("an HKL change on the input thread at the first held write sends no scan", async () => {
    const layout = layoutScene({ threads: { 7: US, 8: US, 9: DE, 19: US, 99: US } });
    const result = await runLayout([chord], layout,
      { progressTransition: { phase: "input:physical-chord", held: 1, hkl: { thread: 9, value: US } } }, { phaseMs: 1500 });
    expect(scans(result.trace)).toEqual([]);
  });
});
