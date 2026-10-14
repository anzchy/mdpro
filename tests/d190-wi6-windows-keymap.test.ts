/**
 * D190-WI-6 (W6, ADR-0096): on Windows and Linux every WYSIWYG chord names one
 * command. `Mod` is Ctrl there, so the macOS pair inline code ⌘⇧` /
 * strikethrough ⌃⇧` collapsed into one chord, Ctrl+Shift+`. Strikethrough
 * moves to Alt+Shift+5 off-Mac (Typora's Windows key); inline code keeps
 * Ctrl+Shift+`; Ctrl+1–6 stay headings (the user's ruling: 「Headings win,
 * Ctrl+/ toggles (Recommended)」).
 *
 * Each case resolves a real keydown through prosemirror-keymap's own
 * `keydownHandler`, with the key, keyCode and modifiers a US-layout Windows
 * keyboard sends, so the test exercises the library's chord normalisation
 * rather than comparing strings (the audit's synthetic key had the wrong
 * keyCode). jsdom's `navigator.platform` is not "Mac", so `Mod` resolves to
 * Ctrl here, as on Windows; k0 pins that. jsdom, not node: the plugin reads
 * `navigator.platform` at load (ADR-0049).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@milkdown/kit/utils", () => ({ $useKeymap: vi.fn() }));
vi.mock("@milkdown/kit/core", () => ({ commandsCtx: Symbol("commandsCtx") }));
vi.mock("@milkdown/kit/preset/commonmark", () => ({
  toggleInlineCodeCommand: { key: "ToggleInlineCode" },
}));
vi.mock("@milkdown/kit/preset/gfm", () => ({
  toggleStrikethroughCommand: { key: "ToggleStrikethrough" },
  goToNextTableCellCommand: { key: "NextCell" },
  goToPrevTableCellCommand: { key: "PrevCell" },
  addRowAfterCommand: { key: "AddRowAfter" },
  exitTable: { key: "ExitTable" },
}));
vi.mock("../src/plugins/core/pluginTypes", () => ({ createPlugin: (def: unknown) => def }));

import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { typoraKeymapConfig } from "../src/plugins/milkdown/typoraKeymapPlugin";

type Key = { key: string; keyCode: number; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean };

/** Every config entry whose chord the keydown triggers. */
function entriesFiredBy(isMac: boolean, key: Key): string[] {
  const event = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...key };
  return Object.entries(typoraKeymapConfig(isMac))
    .filter(([, entry]) => {
      const handler = keydownHandler({ [entry.shortcuts]: () => true });
      return handler({ state: {} } as never, event as unknown as KeyboardEvent);
    })
    .map(([name]) => name);
}

const CTRL_SHIFT_BACKTICK: Key = { key: "~", keyCode: 192, ctrlKey: true, shiftKey: true };
const ALT_SHIFT_5: Key = { key: "%", keyCode: 53, altKey: true, shiftKey: true };
const ctrlDigit = (d: number): Key => ({ key: String(d), keyCode: 48 + d, ctrlKey: true });

describe("D190-WI-6 Windows/Linux WYSIWYG chords name one command each", () => {
  it("k0 Mod resolves to Ctrl in this environment, as on Windows", () => {
    expect(entriesFiredBy(false, ctrlDigit(1))).toEqual(["heading1"]);
  });

  it("k1 Ctrl+Shift+` is inline code only, not also strikethrough", () => {
    expect(entriesFiredBy(false, CTRL_SHIFT_BACKTICK)).toEqual(["inlineCode"]);
  });

  it("k2 Alt+Shift+5 is strikethrough", () => {
    expect(entriesFiredBy(false, ALT_SHIFT_5)).toEqual(["strikethrough"]);
  });

  it("k3 Ctrl+2 and Ctrl+4 are headings 2 and 4 and nothing else", () => {
    expect(entriesFiredBy(false, ctrlDigit(2))).toEqual(["heading2"]);
    expect(entriesFiredBy(false, ctrlDigit(4))).toEqual(["heading4"]);
  });

  it("k4 no two Ctrl or Alt entries share a chord off-Mac", () => {
    // Tab / Shift-Tab / Escape are shared on purpose: each guarded handler
    // declines outside its context (table, code block) and the next one runs.
    const chords = Object.values(typoraKeymapConfig(false))
      .map((e) => e.shortcuts.replace(/^Mod-/, "Ctrl-"))
      .filter((c) => /^(Ctrl|Alt)-/.test(c));
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("k5 macOS keeps ⌃⇧` for strikethrough and ⌘⇧` for inline code", () => {
    const mac = typoraKeymapConfig(true);
    expect(mac.strikethrough.shortcuts).toBe("Ctrl-Shift-`");
    expect(mac.inlineCode.shortcuts).toBe("Mod-Shift-`");
  });
});
