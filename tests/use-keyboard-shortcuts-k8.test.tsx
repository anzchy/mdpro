/**
 * M1A-WI-9b (K8) through the hook: a custom Shift + digit binding fires from
 * the physical key, exactly once, and wins over a relaxed symbol match.
 *
 * Mock boundary: `@tauri-apps/api/core` (logging sink) and
 * `@tauri-apps/api/event` only.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import type { KeyboardShortcuts } from "../src/types/preferences";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

type HookModule = typeof import("../src/hooks/useKeyboardShortcuts");
const ORIGINAL_PLATFORM = window.navigator.platform;

async function loadHookFor(platform: string): Promise<HookModule> {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  vi.resetModules();
  return import("../src/hooks/useKeyboardShortcuts");
}

afterAll(() => {
  Object.defineProperty(window.navigator, "platform", { value: ORIGINAL_PLATFORM, configurable: true });
});

interface Outcome {
  counts: Record<string, number>;
  defaultPrevented: boolean;
}

function press(hook: HookModule, custom: Partial<KeyboardShortcuts>, init: KeyboardEventInit): Outcome {
  const handlers = {
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onNewWindow: vi.fn(),
    onHighlight: vi.fn(),
    onExportHtml: vi.fn(),
    onToggleSidebar: vi.fn(),
    onCycleViewMode: vi.fn(),
    onOpenPreferences: vi.fn(),
    onInsertTable: vi.fn(),
    onTableAction: vi.fn(),
  };
  const shortcuts = { ...DEFAULT_KEYBOARD_SHORTCUTS, ...custom };
  const { unmount } = renderHook(() => hook.useKeyboardShortcuts({ ...handlers, shortcuts }));
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  unmount();
  const counts = Object.fromEntries(
    Object.entries(handlers).map(([name, fn]) => [name, fn.mock.calls.length]),
  );
  return { counts, defaultPrevented: event.defaultPrevented };
}

const only = (name: string, counts: Record<string, number>) =>
  Object.fromEntries(Object.keys(counts).map((k) => [k, k === name ? 1 : 0]));

describe("K8 through useKeyboardShortcuts", () => {
  it("macOS ⇧⌘0 runs a custom Cmd+Shift+0 Save exactly once", async () => {
    const hook = await loadHookFor("MacIntel");
    const out = press(hook, { fileSave: "Cmd+Shift+0" }, {
      key: ")",
      code: "Digit0",
      metaKey: true,
      shiftKey: true,
    });
    expect(out.counts).toEqual(only("onSave", out.counts));
    expect(out.defaultPrevented).toBe(true);
  });

  it("German Ctrl+Shift+0 runs only the Shift-bound Save when Cmd+= is also bound", async () => {
    const hook = await loadHookFor("Win32");
    const out = press(hook, { fileOpen: "Cmd+=", fileSave: "Cmd+Shift+0" }, {
      key: "=",
      code: "Digit0",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(out.counts).toEqual(only("onSave", out.counts));
    expect(out.defaultPrevented).toBe(true);
  });

  it("Windows US Ctrl+Shift+0 dispatches Save once, not twice", async () => {
    const hook = await loadHookFor("Win32");
    const out = press(hook, { fileSave: "Cmd+Shift+0" }, {
      key: ")",
      code: "Digit0",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(out.counts.onSave).toBe(1);
    expect(out.counts).toEqual(only("onSave", out.counts));
  });
});
