/**
 * Audit b186 F1: a logical match on any binding beats a K8 physical match on
 * any other, over the whole binding set and never by branch order. The hook
 * runs pass 1 logical only, pass 2 physical only if nothing matched, then the
 * off-Mac relaxed pass. The matcher's `physical` option gates the code match.
 *
 * Pairs (A is earlier in the hook's branch order, B later; B wins):
 *  a. Codex: New "Cmd+Shift+0" vs Save "Cmd+Shift+=", German Shift+0 (key "=", Digit0)
 *  b. German: Open "Cmd+Shift+/" vs Save "Cmd+Shift+_", Shift+Slash (key "_")
 *  c. French: New "Cmd+Shift+." vs Close "Cmd+Shift+/", Shift+Period (key "/")
 *
 * Mock boundary: `@tauri-apps/api/core` (logging sink) and
 * `@tauri-apps/api/event` only.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import type { KeyboardShortcuts } from "../src/types/preferences";
import { matchesShortcut, type KeyLike } from "../src/utils/shortcutMatch";

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

function press(hook: HookModule, custom: Partial<KeyboardShortcuts>, init: KeyboardEventInit) {
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
  const counts = Object.fromEntries(Object.entries(handlers).map(([n, fn]) => [n, fn.mock.calls.length]));
  return { counts, defaultPrevented: event.defaultPrevented };
}

const only = (name: string, counts: Record<string, number>) =>
  Object.fromEntries(Object.keys(counts).map((k) => [k, k === name ? 1 : 0]));

interface Pair {
  readonly id: string;
  readonly custom: Partial<KeyboardShortcuts>;
  readonly key: string;
  readonly code: string;
  readonly winner: string;
}

const PAIRS: readonly Pair[] = [
  { id: "a Codex German Shift+0", custom: { fileNew: "Cmd+Shift+0", fileSave: "Cmd+Shift+=" }, key: "=", code: "Digit0", winner: "onSave" },
  { id: "b German Shift+Slash", custom: { fileOpen: "Cmd+Shift+/", fileSave: "Cmd+Shift+_" }, key: "_", code: "Slash", winner: "onSave" },
  { id: "c French Shift+Period", custom: { fileNew: "Cmd+Shift+.", fileClose: "Cmd+Shift+/" }, key: "/", code: "Period", winner: "onClose" },
];

const PLATFORMS: ReadonlyArray<readonly [string, KeyboardEventInit]> = [
  ["MacIntel", { metaKey: true }],
  ["Win32", { ctrlKey: true }],
];

describe("F1 logical match beats a physical match on another binding", () => {
  for (const [platform, mods] of PLATFORMS) {
    for (const p of PAIRS) {
      it(`${p.id} on ${platform}: the logical binding runs once, the physical one never`, async () => {
        const hook = await loadHookFor(platform);
        const out = press(hook, p.custom, { key: p.key, code: p.code, shiftKey: true, ...mods });
        expect(out.counts).toEqual(only(p.winner, out.counts));
        expect(out.defaultPrevented).toBe(true);
      });
    }
  }

  it("the physical binding still runs when no binding matches logically (both platforms)", async () => {
    for (const [platform, mods] of PLATFORMS) {
      const hook = await loadHookFor(platform);
      const out = press(hook, { fileNew: "Cmd+Shift+0" }, { key: "=", code: "Digit0", shiftKey: true, ...mods });
      expect(out.counts, platform).toEqual(only("onNew", out.counts));
    }
  });

  it("off-Mac the physical pass wins before the relaxed pass (K8 kept)", async () => {
    const hook = await loadHookFor("Win32");
    const out = press(hook, { fileNew: "Cmd+=", fileSave: "Cmd+Shift+0" }, {
      key: "=",
      code: "Digit0",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(out.counts).toEqual(only("onSave", out.counts));
  });
});

function ev(key: string, code: string, isMac: boolean): KeyLike {
  return { key, code, metaKey: isMac, ctrlKey: !isMac, altKey: false, shiftKey: true };
}

describe("F1 matcher: the code match runs only when asked", () => {
  it("physical:false refuses a code-only match; physical:true accepts it", () => {
    for (const isMac of [true, false]) {
      const e = ev("=", "Digit0", isMac);
      expect(matchesShortcut(e, "Cmd+Shift+0", { isMac, relaxed: false, physical: false })).toBe(false);
      expect(matchesShortcut(e, "Cmd+Shift+0", { isMac, relaxed: false, physical: true })).toBe(true);
      expect(matchesShortcut(e, "Cmd+Shift+=", { isMac, relaxed: false, physical: false })).toBe(true);
    }
  });

  it("with physical:false a shifted event matches Cmd+Shift+k exactly when its key is k (S4, 21 keys × 2 layouts × 2 platforms)", () => {
    const keys: ReadonlyArray<readonly [string, string, string, string]> = [
      ["0", "Digit0", ")", "="], ["1", "Digit1", "!", "!"], ["2", "Digit2", "@", '"'], ["3", "Digit3", "#", "§"],
      ["4", "Digit4", "$", "$"], ["5", "Digit5", "%", "%"], ["6", "Digit6", "^", "&"], ["7", "Digit7", "&", "/"],
      ["8", "Digit8", "*", "("], ["9", "Digit9", "(", ")"], ["`", "Backquote", "~", "°"], ["-", "Minus", "_", "?"],
      ["=", "Equal", "+", "`"], ["[", "BracketLeft", "{", "Ü"], ["]", "BracketRight", "}", "*"],
      ["\\", "Backslash", "|", "'"], [";", "Semicolon", ":", "Ö"], ["'", "Quote", '"', "Ä"],
      [",", "Comma", "<", ";"], [".", "Period", ">", ":"], ["/", "Slash", "?", "_"],
    ];
    const failures: string[] = [];
    let checks = 0;
    for (const isMac of [true, false]) {
      for (const [k, code, us, de] of keys) {
        for (const typed of [us, de]) {
          const got = matchesShortcut(ev(typed, code, isMac), `Cmd+Shift+${k}`, { isMac, relaxed: false, physical: false });
          if (got !== (typed.toUpperCase() === k.toUpperCase())) failures.push(`${isMac} ${k} ${typed}`);
          checks++;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checks).toBe(84);
  });
});
