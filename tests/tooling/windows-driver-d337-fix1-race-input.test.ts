// @vitest-environment node
/**
 * D337 fix 1 (MH1, logical keys and mouse): the held-input progress write is durable before the
 * final HWND, foreground and point checks, and nothing else happens between those checks and the
 * key or button down. A foreground switch or an overlay injected exactly at that write (the old
 * gap) therefore sends no key and no button, and the run reports no input. Production ui.ps1
 * under pwsh with Win32 doubles.
 */
import { describe, expect, it, vi } from "vitest";
import { runNative } from "./windows-driver-native-harness";

vi.setConfig({ testTimeout: 30_000 });

describe("D337 fix 1 a transition at the held-input progress write never reaches a down event", () => {
  it("a foreground switch at the logical chord's held write sends no key", async () => {
    const result = await runNative([{ op: "chord", keys: ["ctrl+a"] }],
      { progressTransition: { phase: "input:logical-chord", held: 1, foreground: 202 } });
    expect(result.trace.filter((line) => line.startsWith("key:"))).toEqual([]);
  });

  it("an overlay at the mouse click's held write sends no button", async () => {
    const result = await runNative([{ op: "clickat", x: 100, y: 100 }],
      { progressTransition: { phase: "input:mouse-click", held: 1, overlay: true } });
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual([]);
  });
});
