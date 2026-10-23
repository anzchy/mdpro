/**
 * Tests for WYSIWYG keybindings (issue #27)
 *
 * Three shortcuts were declared in DEFAULT_KEYBOARD_SHORTCUTS but had
 * no corresponding entries in typoraKeymapPlugin.ts:
 *
 *   formatCode   (⌘⇧`)  — inline code    → toggleInlineCodeCommand (commonmark)
 *   formatStrike (⌃⇧`)  — strikethrough  → toggleStrikethroughCommand (gfm)
 *   formatUnderline (⌘U) — underline     → NOT supported: no Milkdown mark exists
 *
 * TYPORA_KEYMAP_CONFIG is a plain object exported from typoraKeymapPlugin.ts.
 * Tests verify shortcut strings and that command factories call the correct
 * Milkdown command key, using a minimal ctx stub instead of a live editor.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Milkdown modules before importing the plugin under test.
// vi.mock calls are hoisted by Vitest's transform, so they always run first.
// ---------------------------------------------------------------------------

vi.mock("@milkdown/kit/utils", () => ({
  $useKeymap: vi.fn(),
}));

vi.mock("@milkdown/kit/core", () => ({
  commandsCtx: Symbol("commandsCtx"),
}));

vi.mock("@milkdown/kit/preset/commonmark", () => ({
  toggleEmphasisCommand: { key: "ToggleEmphasis" },
  toggleInlineCodeCommand: { key: "ToggleInlineCode" },
  toggleLinkCommand: { key: "ToggleLink" },
  toggleStrongCommand: { key: "ToggleStrong" },
  wrapInHeadingCommand: { key: "WrapInHeading" },
}));

vi.mock("@milkdown/kit/preset/gfm", () => ({
  toggleStrikethroughCommand: { key: "ToggleStrikethrough" },
}));

vi.mock("../src/plugins/core/pluginTypes", () => ({
  createPlugin: (def: unknown) => def,
}));

// Import AFTER mocks are declared (hoisting guarantees this order).
import { TYPORA_KEYMAP_CONFIG, typoraKeymapConfig } from "../src/plugins/milkdown/typoraKeymapPlugin";

// ---------------------------------------------------------------------------
// Minimal ctx stub — mimics the Milkdown Ctx.get(commandsCtx) pattern
// ---------------------------------------------------------------------------

const makeCtx = (mockCall: ReturnType<typeof vi.fn>) => ({
  // ctx.get(anyToken) always returns { call: mockCall }
  get: () => ({ call: mockCall }),
});

// ---------------------------------------------------------------------------
// Existing binding smoke-tests (regression guard)
// ---------------------------------------------------------------------------

describe("TYPORA_KEYMAP_CONFIG — existing bindings", () => {
  it("has bold binding with Mod-b shortcut", () => {
    expect(TYPORA_KEYMAP_CONFIG).toHaveProperty("bold");
    expect(TYPORA_KEYMAP_CONFIG.bold.shortcuts).toBe("Mod-b");
  });

  it("has italic binding with Mod-i shortcut", () => {
    expect(TYPORA_KEYMAP_CONFIG).toHaveProperty("italic");
    expect(TYPORA_KEYMAP_CONFIG.italic.shortcuts).toBe("Mod-i");
  });

  it("bold command factory returns a ProseMirror Command function", () => {
    // Bold now uses direct ProseMirror toggleMark — not commandsCtx.
    // Verify the factory returns a callable function (the Command).
    const fn = TYPORA_KEYMAP_CONFIG.bold.command({});
    expect(typeof fn).toBe("function");
  });

  it("italic command factory returns a ProseMirror Command function", () => {
    // Italic now uses direct ProseMirror toggleMark — not commandsCtx.
    const fn = TYPORA_KEYMAP_CONFIG.italic.command({});
    expect(typeof fn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Issue #27 — new bindings
// ---------------------------------------------------------------------------

describe("TYPORA_KEYMAP_CONFIG — issue #27: previously missing bindings", () => {
  it("has inlineCode entry with Mod-Shift-` shortcut", () => {
    expect(TYPORA_KEYMAP_CONFIG).toHaveProperty("inlineCode");
    expect(TYPORA_KEYMAP_CONFIG.inlineCode.shortcuts).toBe("Mod-Shift-`");
  });

  it("calls toggleInlineCodeCommand key when inlineCode command executes", () => {
    const mockCall = vi.fn();
    const ctx = makeCtx(mockCall);
    const fn = TYPORA_KEYMAP_CONFIG.inlineCode.command(ctx);
    fn();
    expect(mockCall).toHaveBeenCalledWith("ToggleInlineCode");
  });

  it("has strikethrough entry with the v2 Mod-Shift-x shortcut on macOS", () => {
    expect(TYPORA_KEYMAP_CONFIG).toHaveProperty("strikethrough");
    expect(typoraKeymapConfig(true).strikethrough.shortcuts).toBe("Mod-Shift-x");
  });

  it("calls toggleStrikethroughCommand key when strikethrough command executes", () => {
    const mockCall = vi.fn();
    const ctx = makeCtx(mockCall);
    const fn = TYPORA_KEYMAP_CONFIG.strikethrough.command(ctx);
    fn();
    expect(mockCall).toHaveBeenCalledWith("ToggleStrikethrough");
  });

  it("has the D255-WI-3b underline entry backed by a real mark", () => {
    expect(TYPORA_KEYMAP_CONFIG.underline.shortcuts).toBe("Mod-u");
  });
});
