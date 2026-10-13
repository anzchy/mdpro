/**
 * D190 WI-1b: New Window (Ctrl+Shift+N) from the keyboard on Windows.
 *
 * Native menu accelerators never fire on Windows: while WebView2 has focus
 * the key never reaches Tauri's `TranslateAcceleratorW` hook, and wry does not
 * subscribe to `AcceleratorKeyPressed` (D190 row). The menu item
 * `menu.file.new_window` (CmdOrCtrl+Shift+N, `src-tauri/src/menu.rs`) emits
 * `menu:action` "file.new_window", which `useMenuEvents` routes to App's
 * `openNewWindow`. Off-Mac the keydown hook must cover it instead.
 *
 * Specification:
 *   - Win32: the `fileNewWindow` binding (default "Cmd+Shift+N", already a
 *     configurable entry) fires `onNewWindow` once on Ctrl+Shift+N, and a
 *     custom binding is honoured; Ctrl+N still fires only `onNew`; AltGr and
 *     the Windows key never fire it.
 *   - macOS: the native accelerator owns Cmd+Shift+N, so the hook must not
 *     fire `onNewWindow` nor prevent the default (no double fire); Cmd+N still
 *     fires `onNew`.
 *   - App.tsx passes the hook the same call the menu path uses.
 *
 * Platform: `isMac` is a module-level constant, so each describe block sets
 * `navigator.platform`, calls `vi.resetModules()` and imports the hook afresh.
 *
 * Mock boundary: `@tauri-apps/api/core` only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import type { KeyboardShortcuts } from "../src/types/preferences";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: ipc.invoke, isTauri: true }),
);

type HookModule = typeof import("../src/hooks/useKeyboardShortcuts");
type PrefsModule = typeof import("../src/types/preferences");

const ORIGINAL_PLATFORM = window.navigator.platform;

async function loadHookFor(platform: string): Promise<{ hook: HookModule; prefs: PrefsModule }> {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  vi.resetModules();
  const hook = await import("../src/hooks/useKeyboardShortcuts");
  const prefs = await import("../src/types/preferences");
  return { hook, prefs };
}

const HANDLER_NAMES = [
  "onNew",
  "onNewWindow",
  "onHighlight",
  "onExportHtml",
  "onToggleSidebar",
  "onOpen",
  "onSave",
  "onClose",
  "onCycleViewMode",
  "onOpenPreferences",
  "onInsertTable",
  "onTableAction",
] as const;
type HandlerName = (typeof HANDLER_NAMES)[number];

interface PressInit extends KeyboardEventInit {
  modifierAltGraph?: boolean;
}

interface Outcome {
  fired: HandlerName[];
  calls: Record<HandlerName, ReturnType<typeof vi.fn>>;
  prevented: boolean;
}

/** Mount the real hook with every handler, press one key, unmount. */
function pressWith(hook: HookModule, init: PressInit, shortcuts?: KeyboardShortcuts): Outcome {
  const handlers = Object.fromEntries(HANDLER_NAMES.map((n) => [n, vi.fn()])) as Record<
    HandlerName,
    ReturnType<typeof vi.fn>
  >;
  // `onNewWindow` is the prop under test; the spread keeps this file
  // compiling against the hook's props before and after it gains it.
  const props = { ...handlers, ...(shortcuts ? { shortcuts } : {}) } as Parameters<
    HookModule["useKeyboardShortcuts"]
  >[0];
  const { unmount } = renderHook(() => hook.useKeyboardShortcuts(props));
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  unmount();
  return {
    fired: HANDLER_NAMES.filter((n) => handlers[n].mock.calls.length > 0),
    calls: handlers,
    prevented: event.defaultPrevented,
  };
}

afterEach(() => {
  ipc.invoke.mockClear();
});

afterAll(() => {
  Object.defineProperty(window.navigator, "platform", { value: ORIGINAL_PLATFORM, configurable: true });
});

describe("Windows (Win32): the hook owns New Window", () => {
  let hook: HookModule;
  let prefs: PrefsModule;

  beforeAll(async () => {
    ({ hook, prefs } = await loadHookFor("Win32"));
  });

  it("the default fileNewWindow binding is Cmd+Shift+N", () => {
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.fileNewWindow).toBe("Cmd+Shift+N");
  });

  it("Ctrl+Shift+N calls onNewWindow exactly once and prevents the default", () => {
    const outcome = pressWith(hook, { key: "N", ctrlKey: true, shiftKey: true });
    expect(outcome.fired).toEqual(["onNewWindow"]);
    expect(outcome.calls.onNewWindow.mock.calls).toHaveLength(1);
    expect(outcome.prevented).toBe(true);
  });

  it("a custom fileNewWindow binding is honoured", () => {
    const shortcuts = { ...prefs.DEFAULT_KEYBOARD_SHORTCUTS, fileNewWindow: "Cmd+Option+N" };
    expect(pressWith(hook, { key: "n", ctrlKey: true, altKey: true }, shortcuts).fired).toEqual(["onNewWindow"]);
    expect(pressWith(hook, { key: "N", ctrlKey: true, shiftKey: true }, shortcuts).fired).toEqual([]);
  });

  it("Ctrl+N still calls onNew and not onNewWindow", () => {
    expect(pressWith(hook, { key: "n", ctrlKey: true }).fired).toEqual(["onNew"]);
  });

  it("Ctrl+Shift+N with AltGraph fires nothing", () => {
    const outcome = pressWith(hook, { key: "N", ctrlKey: true, shiftKey: true, altKey: true, modifierAltGraph: true });
    expect(outcome.fired).toEqual([]);
    expect(outcome.prevented).toBe(false);
  });

  it("Win+Shift+N fires nothing", () => {
    const outcome = pressWith(hook, { key: "N", metaKey: true, shiftKey: true });
    expect(outcome.fired).toEqual([]);
    expect(outcome.prevented).toBe(false);
  });
});

describe("macOS (MacIntel): the native menu owns New Window", () => {
  let hook: HookModule;

  beforeAll(async () => {
    ({ hook } = await loadHookFor("MacIntel"));
  });

  it("Cmd+Shift+N does not call onNewWindow and leaves the default alone", () => {
    const outcome = pressWith(hook, { key: "N", metaKey: true, shiftKey: true });
    expect(outcome.fired).toEqual([]);
    expect(outcome.prevented).toBe(false);
  });

  it("Cmd+N still calls onNew", () => {
    expect(pressWith(hook, { key: "n", metaKey: true }).fired).toEqual(["onNew"]);
  });
});

describe("App.tsx wiring", () => {
  const appSrc = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8");

  /** The argument object of the first `<hookName>({ … });` call in App.tsx. */
  function callBlock(hookName: string): string {
    const start = appSrc.indexOf(`${hookName}({`);
    expect(start).toBeGreaterThan(-1);
    const end = appSrc.indexOf("});", start);
    return appSrc.slice(start, end);
  }

  it("passes useKeyboardShortcuts the same onNewWindow call the menu path uses", () => {
    const menuWiring = /onNewWindow:\s*\(\)\s*=>\s*void openNewWindow\(\)/;
    expect(callBlock("useMenuEvents")).toMatch(menuWiring);
    expect(callBlock("useKeyboardShortcuts")).toMatch(menuWiring);
  });
});
