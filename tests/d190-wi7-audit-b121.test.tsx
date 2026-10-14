/**
 * D190-WI-7, audit b121.
 *
 * M1: the off-Mac relaxed match (a symbol typed with Shift still matches a
 * binding without Shift, audit b120) ran inside the hook's first-match-wins
 * chain. A custom binding that wants the Shift, e.g. Preferences on
 * "Cmd+Shift+/" (German Ctrl+Shift+7), was taken first by view-cycle's
 * relaxed "Cmd+/". Exact matching now runs across every binding first; the
 * relaxed match is a fallback only when nothing matched exactly.
 *
 * M4: off-Mac the matcher refuses every AltGraph keydown, so a binding the
 * recorder stored from an AltGr chord could never fire. The recorder now
 * refuses AltGr chords off-Mac. macOS Option is not AltGr and is unaffected.
 *
 * Mock boundary: `@tauri-apps/api/core` only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { recordedShortcut, type RecordedKey } from "../src/utils/platformLabels";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
);

type HookModule = typeof import("../src/hooks/useKeyboardShortcuts");
const ORIGINAL_PLATFORM = window.navigator.platform;

async function loadHookFor(platform: string): Promise<HookModule> {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  vi.resetModules();
  return import("../src/hooks/useKeyboardShortcuts");
}

function press(hook: HookModule, init: KeyboardEventInit, filePreferences: string): string[] {
  const onCycleViewMode = vi.fn();
  const onOpenPreferences = vi.fn();
  const shortcuts = { ...DEFAULT_KEYBOARD_SHORTCUTS, filePreferences };
  const { unmount } = renderHook(() =>
    hook.useKeyboardShortcuts({ onCycleViewMode, onOpenPreferences, shortcuts }),
  );
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  unmount();
  return [
    ...(onCycleViewMode.mock.calls.length ? ["cycle"] : []),
    ...(onOpenPreferences.mock.calls.length ? ["preferences"] : []),
  ];
}

afterAll(() => {
  Object.defineProperty(window.navigator, "platform", { value: ORIGINAL_PLATFORM, configurable: true });
});

describe("M1 Windows: an exact Shift match wins over the relaxed symbol match", () => {
  let hook: HookModule;
  beforeAll(async () => {
    hook = await loadHookFor("Win32");
  });

  it("b1 a custom Cmd+Shift+/ binding fires its own action, not view-cycle", () => {
    expect(press(hook, { key: "/", ctrlKey: true, shiftKey: true }, "Cmd+Shift+/")).toEqual([
      "preferences",
    ]);
  });

  it("b2 with no exact binding, the Shift-typed / still falls back to view-cycle", () => {
    expect(press(hook, { key: "/", ctrlKey: true, shiftKey: true }, "Cmd+,")).toEqual(["cycle"]);
  });

  it("b3 an unshifted Ctrl+/ is still view-cycle when Preferences is Cmd+Shift+/", () => {
    expect(press(hook, { key: "/", ctrlKey: true }, "Cmd+Shift+/")).toEqual(["cycle"]);
  });
});

const altGr = (key: string, mods: Partial<RecordedKey>): RecordedKey => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  getModifierState: (k: string) => k === "AltGraph",
  ...mods,
});

describe("M4 the recorder refuses AltGr chords off-Mac", () => {
  it("r1 off-Mac, an AltGr chord (Ctrl+Alt+AltGraph) records nothing", () => {
    expect(recordedShortcut(altGr("t", { ctrlKey: true, altKey: true }), false)).toBeNull();
  });

  it("r2 off-Mac, Ctrl+Alt without AltGraph still records", () => {
    const plain = { ...altGr("t", { ctrlKey: true, altKey: true }), getModifierState: () => false };
    expect(recordedShortcut(plain, false)).toBe("Cmd+Option+T");
  });

  it("r3 macOS ignores AltGraph: ⌘⌥T records", () => {
    expect(recordedShortcut(altGr("t", { metaKey: true, altKey: true }), true)).toBe("Cmd+Option+T");
  });
});
