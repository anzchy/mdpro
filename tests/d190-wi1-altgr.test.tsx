/**
 * D190 WI-1, audit b98: AltGr must not trigger app shortcuts off-Mac.
 *
 * On Windows, AltGr arrives as ctrlKey + altKey, which is exactly what a
 * "Cmd+Option+<key>" binding wants there. #38's fix (`8abf5c5`) excluded
 * altKey globally; `429da1e` dropped that. `matchesShortcut` compares
 * `event.key`, so an AltGr chord that produces a character ("₺", "@") cannot
 * equal the binding's key. The overlap is AltGr on a key with no AltGr
 * mapping, where `event.key` stays the base letter.
 *
 * Specification (Win32):
 *   (a) "₺" with Ctrl+Alt+AltGraph does not fire Cmd+Option+T.
 *   (b) "@" with Ctrl+Alt+AltGraph fires nothing.
 *   (c) "t" with Ctrl+Alt+AltGraph does not fire Cmd+Option+T.
 *   (d) "t"/"T" with Ctrl+Alt and no AltGraph fires onInsertTable.
 * macOS control: Option is not AltGr, so an AltGraph flag there changes
 * nothing for Cmd+Option+T.
 *
 * AltGraph is set with jsdom's `modifierAltGraph` init flag, which
 * `getModifierState("AltGraph")` reports (asserted below).
 *
 * Mock boundary: `@tauri-apps/api/core` only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { v1TableDefaults } from "./support/bindingV1Defaults";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: ipc.invoke, isTauri: true }),
);

type HookModule = typeof import("../src/hooks/useKeyboardShortcuts");

const ORIGINAL_PLATFORM = window.navigator.platform;

async function loadHookFor(platform: string): Promise<HookModule> {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  vi.resetModules();
  return import("../src/hooks/useKeyboardShortcuts");
}

const HANDLER_NAMES = [
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
] as const;
type HandlerName = (typeof HANDLER_NAMES)[number];

interface PressInit extends KeyboardEventInit {
  modifierAltGraph?: boolean;
}

/** Mount the real hook, press one key, return the handlers that fired and the event. */
function pressWith(hook: HookModule, init: PressInit): { fired: HandlerName[]; event: KeyboardEvent } {
  const handlers = Object.fromEntries(HANDLER_NAMES.map((n) => [n, vi.fn()])) as Record<
    HandlerName,
    ReturnType<typeof vi.fn>
  >;
  const { unmount } = renderHook(() => hook.useKeyboardShortcuts({
    ...handlers, shortcuts: v1TableDefaults(/Mac/i.test(navigator.platform) ? "macos" : "windows"),
  }));
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  unmount();
  return { fired: HANDLER_NAMES.filter((n) => handlers[n].mock.calls.length > 0), event };
}

afterEach(() => {
  ipc.invoke.mockClear();
});

afterAll(() => {
  Object.defineProperty(window.navigator, "platform", { value: ORIGINAL_PLATFORM, configurable: true });
});

describe("Windows (Win32): AltGr never fires an app shortcut", () => {
  let hook: HookModule;

  beforeAll(async () => {
    hook = await loadHookFor("Win32");
  });

  it("jsdom reports AltGraph from the modifierAltGraph init flag", () => {
    const e = new KeyboardEvent("keydown", { key: "t", ctrlKey: true, altKey: true, modifierAltGraph: true } as PressInit);
    expect(e.getModifierState("AltGraph")).toBe(true);
    expect(new KeyboardEvent("keydown", { key: "t" }).getModifierState("AltGraph")).toBe(false);
  });

  it('(a) AltGr+T typing "₺" does not fire Cmd+Option+T', () => {
    const { fired, event } = pressWith(hook, { key: "₺", ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(fired).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('(b) AltGr typing "@" fires nothing', () => {
    const { fired, event } = pressWith(hook, { key: "@", ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(fired).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('(c) AltGr on an unmapped key ("t") does not fire Cmd+Option+T', () => {
    for (const key of ["t", "T"]) {
      const { fired, event } = pressWith(hook, { key, ctrlKey: true, altKey: true, modifierAltGraph: true });
      expect(fired).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("(c') AltGr + ArrowUp does not fire the Cmd+Option+Up table action", () => {
    const { fired } = pressWith(hook, { key: "ArrowUp", ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(fired).toEqual([]);
  });

  it("(d) Ctrl+Alt+T without AltGraph fires onInsertTable", () => {
    for (const key of ["t", "T"]) {
      const { fired, event } = pressWith(hook, { key, ctrlKey: true, altKey: true });
      expect(fired).toEqual(["onInsertTable"]);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});

describe("macOS control (MacIntel): Option is not AltGr", () => {
  let hook: HookModule;

  beforeAll(async () => {
    hook = await loadHookFor("MacIntel");
  });

  it("Cmd+Option+T fires onInsertTable with or without an AltGraph flag", () => {
    expect(pressWith(hook, { key: "t", metaKey: true, altKey: true }).fired).toEqual(["onInsertTable"]);
    expect(
      pressWith(hook, { key: "t", metaKey: true, altKey: true, modifierAltGraph: true }).fired,
    ).toEqual(["onInsertTable"]);
  });
});
