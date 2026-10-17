/**
 * Audit b186 round 2: a keydown an editor keymap already consumed
 * (`defaultPrevented`) never reaches a fallback match. Milkdown's
 * Mod-Shift-` (inline Code) calls preventDefault without stopping
 * propagation, so on a German layout (key "`", code "Equal") the window
 * listener's K8 physical pass fired a stored custom Save "Cmd+Shift+=".
 *
 * The skip covers the physical pass (K8) and the off-Mac relaxed pass
 * (audit b121) only. The logical pass is unchanged: CodeMirror's searchKeymap
 * Mod-Shift-l and the add-cursor Mod-Alt-Arrow keys preventDefault on hook
 * chords today (C11, C17), and the hook still runs there until M1b removes
 * those editor bindings.
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

/** Dispatch on an element inside the page; `consumed` adds an earlier listener
 *  there that preventDefaults, as an editor keymap does, then lets it bubble. */
function press(hook: HookModule, custom: Partial<KeyboardShortcuts>, init: KeyboardEventInit, consumed: boolean) {
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
  const target = document.createElement("div");
  document.body.appendChild(target);
  if (consumed) target.addEventListener("keydown", (e) => e.preventDefault());
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  unmount();
  target.remove();
  return Object.fromEntries(Object.entries(handlers).map(([n, fn]) => [n, fn.mock.calls.length]));
}

const PLATFORMS = [
  { name: "macOS", platform: "MacIntel", mod: { metaKey: true } },
  { name: "Windows", platform: "Win32", mod: { ctrlKey: true } },
] as const;

describe("K8 physical pass skips a consumed keydown (audit b186 round 2)", () => {
  // German Shift+` on the Equal key: Milkdown's Mod-Shift-` toggles inline Code.
  const custom = { fileSave: "Cmd+Shift+=" };
  const german = { key: "`", code: "Equal", shiftKey: true };

  for (const p of PLATFORMS) {
    it(`${p.name}: consumed by the editor, a custom Save on Cmd+Shift+= does not run`, async () => {
      const hook = await loadHookFor(p.platform);
      const counts = press(hook, custom, { ...german, ...p.mod }, true);
      expect(counts.onSave).toBe(0);
      expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });

    it(`${p.name}: not consumed, the physical match still runs Save once (K8 unchanged)`, async () => {
      const hook = await loadHookFor(p.platform);
      const counts = press(hook, custom, { ...german, ...p.mod }, false);
      expect(counts.onSave).toBe(1);
    });
  }
});

describe("off-Mac relaxed pass skips a consumed keydown", () => {
  // German ";" is Shift+Comma; a binding without Shift reaches it only in the relaxed pass.
  const custom = { fileSave: "Cmd+;", viewCycleViewMode: "Cmd+Shift+F12" };
  const event = { key: ";", code: "Comma", shiftKey: true, ctrlKey: true };

  it("Windows: consumed, a custom Save on Cmd+; typed as Shift+, does not run", async () => {
    const hook = await loadHookFor("Win32");
    expect(press(hook, custom, event, true).onSave).toBe(0);
  });

  it("Windows: not consumed, the relaxed pass still runs Save once (audit b121 unchanged)", async () => {
    const hook = await loadHookFor("Win32");
    expect(press(hook, custom, event, false).onSave).toBe(1);
  });
});

describe("the logical pass is unchanged for a consumed keydown (C11 stays M1b's)", () => {
  for (const p of PLATFORMS) {
    it(`${p.name}: Cmd+Shift+L consumed by CodeMirror's searchKeymap still toggles the sidebar`, async () => {
      const hook = await loadHookFor(p.platform);
      const counts = press(hook, {}, { key: "L", code: "KeyL", shiftKey: true, ...p.mod }, true);
      expect(counts.onToggleSidebar).toBe(1);
    });
  }
});
