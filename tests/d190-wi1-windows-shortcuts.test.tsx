/**
 * D190 WI-1 (Windows audit W1, filed earlier as D50): app shortcuts never fire
 * off macOS.
 *
 * `matchesShortcut` in `src/hooks/useKeyboardShortcuts.ts` maps "Cmd" to
 * `ctrlKey` off-Mac and then, on the next line, demands `ctrlKey === wantCtrl`.
 * A "Cmd+S" binding has `wantCtrl = false`, so Ctrl+S on Windows is rejected by
 * the second check after passing the first. The #38 fix (`8abf5c5`) had this
 * right; WI-9 (`429da1e`, 2026-03-31) reintroduced it when it replaced the
 * hard-coded keys with `matchesShortcut`.
 *
 * The specification pinned here, per platform:
 *   - Off-Mac, "Cmd" and "Ctrl" both name the Ctrl key (the primary modifier),
 *     so "Cmd+S", "Ctrl+S" and "Cmd+Ctrl+S" all mean Ctrl+S. The Windows key
 *     (`metaKey`) is never a shortcut modifier there: pressed alone with S, or
 *     together with Ctrl+S, nothing fires.
 *   - On macOS, "Cmd" is `metaKey` and "Ctrl" is `ctrlKey`, two distinct
 *     modifiers that must each match exactly (the pre-existing behaviour).
 *   - Every default app binding the hook dispatches fires on Windows when its
 *     Cmd is pressed as Ctrl.
 *   - Property over the modifier domain: for a "Cmd+S" binding, of the 16
 *     Meta/Ctrl/Alt/Shift combinations exactly one fires — Ctrl alone on
 *     Windows, Meta alone on macOS.
 *
 * Platform: `isMac` is a module-level constant read from
 * `navigator.platform`, so each describe block sets the platform, calls
 * `vi.resetModules()` and imports the hook afresh.
 *
 * Mock boundary: `@tauri-apps/api/core` only (the logging IPC). The hook, the
 * logging service, the stores and the modal guard are real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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

type HandlerName =
  | "onNew"
  | "onHighlight"
  | "onExportHtml"
  | "onToggleSidebar"
  | "onOpen"
  | "onSave"
  | "onClose"
  | "onCycleViewMode"
  | "onOpenPreferences"
  | "onInsertTable"
  | "onTableAction";

const HANDLER_NAMES: HandlerName[] = [
  "onNew",
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
];

function makeHandlers(): Record<HandlerName, ReturnType<typeof vi.fn>> {
  return Object.fromEntries(HANDLER_NAMES.map((name) => [name, vi.fn()])) as Record<
    HandlerName,
    ReturnType<typeof vi.fn>
  >;
}

function firedHandlers(handlers: Record<HandlerName, ReturnType<typeof vi.fn>>): HandlerName[] {
  return HANDLER_NAMES.filter((name) => handlers[name].mock.calls.length > 0);
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

interface Outcome {
  fired: HandlerName[];
  prevented: boolean;
  calls: Record<HandlerName, ReturnType<typeof vi.fn>>;
}

/** Mount the real hook, press one key, report what fired, unmount. */
function pressWith(hook: HookModule, init: KeyboardEventInit, shortcuts?: KeyboardShortcuts): Outcome {
  const handlers = makeHandlers();
  const { unmount } = renderHook(() =>
    hook.useKeyboardShortcuts(shortcuts ? { ...handlers, shortcuts } : handlers),
  );
  const event = press(init);
  unmount();
  return { fired: firedHandlers(handlers), prevented: event.defaultPrevented, calls: handlers };
}

/** The 16 Meta/Ctrl/Alt/Shift combinations. */
const MODIFIER_COMBOS: KeyboardEventInit[] = Array.from({ length: 16 }, (_, bits) => ({
  metaKey: (bits & 1) !== 0,
  ctrlKey: (bits & 2) !== 0,
  altKey: (bits & 4) !== 0,
  shiftKey: (bits & 8) !== 0,
}));

afterEach(() => {
  ipc.invoke.mockClear();
  document.body.innerHTML = "";
});

afterAll(() => {
  Object.defineProperty(window.navigator, "platform", { value: ORIGINAL_PLATFORM, configurable: true });
});

describe("Windows (navigator.platform = Win32)", () => {
  let hook: HookModule;
  let prefs: PrefsModule;

  beforeAll(async () => {
    ({ hook, prefs } = await loadHookFor("Win32"));
  });

  it.each([
    { binding: "Cmd+S", handler: "onSave", init: { key: "s", ctrlKey: true } },
    { binding: "Cmd+N", handler: "onNew", init: { key: "n", ctrlKey: true } },
    { binding: "Cmd+O", handler: "onOpen", init: { key: "o", ctrlKey: true } },
    { binding: "Cmd+W", handler: "onClose", init: { key: "w", ctrlKey: true } },
    { binding: "Cmd+Shift+E", handler: "onExportHtml", init: { key: "E", ctrlKey: true, shiftKey: true } },
    { binding: "Cmd+Shift+L", handler: "onToggleSidebar", init: { key: "L", ctrlKey: true, shiftKey: true } },
    { binding: "Cmd+Shift+H", handler: "onHighlight", init: { key: "H", ctrlKey: true, shiftKey: true } },
    { binding: "Cmd+,", handler: "onOpenPreferences", init: { key: ",", ctrlKey: true } },
    { binding: "Cmd+/", handler: "onCycleViewMode", init: { key: "/", ctrlKey: true } },
    { binding: "Cmd+Option+T", handler: "onInsertTable", init: { key: "t", ctrlKey: true, altKey: true } },
    {
      binding: "Cmd+Option+Up",
      handler: "onTableAction",
      init: { key: "ArrowUp", ctrlKey: true, altKey: true },
    },
  ] as const)("default $binding fires $handler on Ctrl", ({ handler, init }) => {
    const outcome = pressWith(hook, init);
    expect(outcome.fired).toEqual([handler]);
    expect(outcome.calls[handler].mock.calls).toHaveLength(1);
    expect(outcome.prevented).toBe(true);
  });

  it("the defaults above are the shipped bindings (guards the table against drift)", () => {
    const d = prefs.DEFAULT_KEYBOARD_SHORTCUTS;
    expect([d.fileSave, d.fileNew, d.fileOpen, d.fileClose, d.fileExportHtml]).toEqual([
      "Cmd+S",
      "Cmd+N",
      "Cmd+O",
      "Cmd+W",
      "Cmd+Shift+E",
    ]);
    expect([d.viewToggleSidebar, d.formatHighlight, d.filePreferences, d.viewCycleViewMode]).toEqual([
      "Cmd+Shift+L",
      "Cmd+Shift+H",
      "Cmd+,",
      "Cmd+/",
    ]);
    expect([d.paragraphTable, d.tableInsertRowAbove]).toEqual(["Cmd+Option+T", "Cmd+Option+Up"]);
  });

  it("the Windows key (metaKey) + S fires nothing and leaves the default alone", () => {
    const outcome = pressWith(hook, { key: "s", metaKey: true });
    expect(outcome.fired).toEqual([]);
    expect(outcome.prevented).toBe(false);
  });

  it("Ctrl + Windows key + S fires nothing (metaKey is never a shortcut modifier off-Mac)", () => {
    const outcome = pressWith(hook, { key: "s", ctrlKey: true, metaKey: true });
    expect(outcome.fired).toEqual([]);
    expect(outcome.prevented).toBe(false);
  });

  it("a bare S and Ctrl+Shift+S do not fire the Cmd+S binding", () => {
    expect(pressWith(hook, { key: "s" }).fired).toEqual([]);
    expect(pressWith(hook, { key: "S", ctrlKey: true, shiftKey: true }).fired).toEqual([]);
  });

  it('a literal "Ctrl+S" binding fires on Ctrl+S', () => {
    const shortcuts = { ...prefs.DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Ctrl+S" };
    const outcome = pressWith(hook, { key: "s", ctrlKey: true }, shortcuts);
    expect(outcome.fired).toEqual(["onSave"]);
    expect(outcome.prevented).toBe(true);
  });

  it('"Cmd+Ctrl+S" collapses to Ctrl+S off-Mac (both tokens name the Ctrl key)', () => {
    const shortcuts = { ...prefs.DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Ctrl+S" };
    expect(pressWith(hook, { key: "s", ctrlKey: true }, shortcuts).fired).toEqual(["onSave"]);
    expect(pressWith(hook, { key: "s", ctrlKey: true, metaKey: true }, shortcuts).fired).toEqual([]);
  });

  it("property: of the 16 modifier combinations, only Ctrl alone fires a Cmd+S binding", () => {
    const firing = MODIFIER_COMBOS.filter(
      (mods) => pressWith(hook, { key: "s", ...mods }).fired.includes("onSave"),
    );
    expect(firing).toEqual([{ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }]);
  });
});

describe("macOS control (navigator.platform = MacIntel)", () => {
  let hook: HookModule;
  let prefs: PrefsModule;

  beforeAll(async () => {
    ({ hook, prefs } = await loadHookFor("MacIntel"));
  });

  it("Cmd (metaKey) + S fires onSave", () => {
    const outcome = pressWith(hook, { key: "s", metaKey: true });
    expect(outcome.fired).toEqual(["onSave"]);
    expect(outcome.prevented).toBe(true);
  });

  it("Ctrl+S does not fire the Cmd+S binding", () => {
    const outcome = pressWith(hook, { key: "s", ctrlKey: true });
    expect(outcome.fired).toEqual([]);
    expect(outcome.prevented).toBe(false);
  });

  it('a literal "Ctrl+S" binding needs ctrlKey and not metaKey', () => {
    const shortcuts = { ...prefs.DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Ctrl+S" };
    expect(pressWith(hook, { key: "s", ctrlKey: true }, shortcuts).fired).toEqual(["onSave"]);
    expect(pressWith(hook, { key: "s", metaKey: true }, shortcuts).fired).toEqual([]);
    expect(pressWith(hook, { key: "s", metaKey: true, ctrlKey: true }, shortcuts).fired).toEqual([]);
  });

  it('"Cmd+Ctrl+S" needs both metaKey and ctrlKey on macOS', () => {
    const shortcuts = { ...prefs.DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Ctrl+S" };
    expect(pressWith(hook, { key: "s", metaKey: true, ctrlKey: true }, shortcuts).fired).toEqual(["onSave"]);
    expect(pressWith(hook, { key: "s", ctrlKey: true }, shortcuts).fired).toEqual([]);
    expect(pressWith(hook, { key: "s", metaKey: true }, shortcuts).fired).toEqual([]);
  });

  it("property: of the 16 modifier combinations, only Meta alone fires a Cmd+S binding", () => {
    const firing = MODIFIER_COMBOS.filter(
      (mods) => pressWith(hook, { key: "s", ...mods }).fired.includes("onSave"),
    );
    expect(firing).toEqual([{ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }]);
  });
});
