/**
 * D190-WI-7, audit b120 Medium: off-Mac, a binding on a symbol key must fire
 * when the layout needs Shift to type that symbol.
 *
 * ADR-0096 makes Ctrl+/ the only view-switch key on Windows and Linux. On a
 * German layout "/" is Shift+7, so the keydown carries key "/" with shiftKey
 * true, and `matchesShortcut` refused it because "Cmd+/" does not want Shift.
 * The fix (off-Mac only): when `event.key` already is the bound symbol, Shift
 * is not compared. Letters keep the exact Shift check ("Cmd+S" is not
 * Ctrl+Shift+S), and macOS is unchanged.
 *
 * The CodeMirror `Mod-/` binding (Editor.tsx) is not this path; this pins the
 * window hook, which owns the key outside the source editor.
 *
 * Platform: `isMac` is read at module load, so each block sets
 * `navigator.platform` and imports the hook afresh (as d190-wi1b does).
 * Mock boundary: `@tauri-apps/api/core` only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

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

/** Mount the real hook with onCycleViewMode and onSave, press one key, report which fired. */
function press(hook: HookModule, init: KeyboardEventInit): string[] {
  const onCycleViewMode = vi.fn();
  const onSave = vi.fn();
  const { unmount } = renderHook(() => hook.useKeyboardShortcuts({ onCycleViewMode, onSave }));
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  unmount();
  return [
    ...(onCycleViewMode.mock.calls.length ? ["cycle"] : []),
    ...(onSave.mock.calls.length ? ["save"] : []),
  ];
}

afterAll(() => {
  Object.defineProperty(window.navigator, "platform", { value: ORIGINAL_PLATFORM, configurable: true });
});

describe("Windows: a Shift-typed symbol still matches its binding", () => {
  let hook: HookModule;
  beforeAll(async () => {
    hook = await loadHookFor("Win32");
  });

  it("s1 Ctrl + '/' typed with Shift (German layout) cycles the view", () => {
    expect(press(hook, { key: "/", ctrlKey: true, shiftKey: true })).toEqual(["cycle"]);
  });

  it("s2 Ctrl + '/' without Shift (US layout) still cycles", () => {
    expect(press(hook, { key: "/", ctrlKey: true })).toEqual(["cycle"]);
  });

  it("s3 a letter binding still requires its Shift state: Ctrl+Shift+S is not Save", () => {
    expect(press(hook, { key: "S", ctrlKey: true, shiftKey: true })).toEqual([]);
    expect(press(hook, { key: "s", ctrlKey: true })).toEqual(["save"]);
  });

  it("s4 Shift does not make a different symbol match: Ctrl+Shift+'?' is not Ctrl+/", () => {
    expect(press(hook, { key: "?", ctrlKey: true, shiftKey: true })).toEqual([]);
  });
});

describe("macOS: unchanged, Shift is compared exactly", () => {
  let hook: HookModule;
  beforeAll(async () => {
    hook = await loadHookFor("MacIntel");
  });

  it("m1 ⌘/ cycles and ⌘⇧ with key '/' does not", () => {
    expect(press(hook, { key: "/", metaKey: true })).toEqual(["cycle"]);
    expect(press(hook, { key: "/", metaKey: true, shiftKey: true })).toEqual([]);
  });
});
