/**
 * Typora-style Keymap Plugin for Milkdown WYSIWYG mode
 *
 * Purpose: register Typora-style heading, paragraph, mark, link, table and
 * code-block keys in Milkdown. Shared command factories live in
 * `typoraCommandFactories.ts` and `typoraTableNavigationCommands.ts`; the link modal flow lives in
 * `typoraLinkCommand.ts` for menu and keyboard use (M3b).
 *
 * Historical issue #31: the editor once loaded only `.use(gfm)`, so the
 * commonmark heading command was missing and `commands.call` failed. The
 * current editor also loads `mdproCommonmark`; these direct ProseMirror
 * factories remain shared with the menu dispatcher.
 *
 * Fix:
 * Bypass the Milkdown command registry entirely for heading/paragraph/bold/
 * italic/link.  Each `command` callback now returns a first-class ProseMirror
 * `Command` function — `(state, dispatch, view?) => boolean` — that uses
 * `setBlockType` / `toggleMark` directly, resolving node/mark types from
 * `state.schema` at dispatch time.  This makes the shortcuts independent of
 * which Milkdown presets are loaded.
 *
 * Exception: inlineCode (⌘⇧`) and strikethrough (⌃⇧`; Alt+Shift+5 on
 * Windows / Linux, see `strikethroughShortcut`) still use the Milkdown
 * command registry because their ProseMirror mark names in the GFM schema are
 * not stable public API.  These commands are registered by the GFM preset that
 * IS loaded, so they work correctly.
 *
 * D255-WI-3b adds a real underline mark and the current v1 WYSIWYG keys in
 * `wysiwygKeymapEntries.ts`; M1b will replace these literals with the applied
 * shortcut set.
 *
 * @coordinates-with src/utils/modalTabActionGuard.ts — ⌘K is refused over an open modal (D235-WI-2)
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 * @coordinates-with src/plugins/index.ts
 */

import { $useKeymap } from "@milkdown/kit/utils";
import { commandsCtx } from "@milkdown/kit/core";
import { toggleInlineCodeCommand } from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { Command } from "@milkdown/kit/prose/state";
import { createPlugin } from "../core/pluginTypes";
import { useLinkInsertStore } from "../../stores/linkInsertStore";
import { makeCodeBlockIndentCommand } from "./codeBlockIndentCommand";
import {
  makeBoldCommand,
  makeHeadingCommand,
  makeItalicCommand,
  makeParagraphCommand,
} from "./typoraCommandFactories";
import { makeTyporaLinkPendingCallback } from "./typoraLinkCommand";
import {
  makeTableExitCommand,
  makeTableShiftTabCommand,
  makeTableTabCommand,
} from "./typoraTableNavigationCommands";
import { wysiwygV1Entries } from "./wysiwygKeymapEntries";

export { makeCodeBlockIndentCommand } from "./codeBlockIndentCommand";
export { makeBoldCommand, makeHeadingCommand, makeItalicCommand, makeParagraphCommand } from "./typoraCommandFactories";

// ---------------------------------------------------------------------------
// Keymap config — exported for unit testing via TYPORA_KEYMAP_CONFIG
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MilkdownCtx = any;

type CommandEntry = {
  shortcuts: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  command: (ctx: MilkdownCtx) => any;
};

/**
 * The strikethrough chord for a platform. macOS: ⌃⇧`. Windows / Linux:
 * Alt+Shift+5 (Typora's Windows key), because `Mod` is Ctrl there and
 * Ctrl-Shift-` would be the inline-code chord too (D190-WI-6, ADR-0096).
 */
export function strikethroughShortcut(isMac: boolean): string {
  return isMac ? "Ctrl-Shift-`" : "Alt-Shift-5";
}

const TYPORA_KEYMAP_ENTRIES: Record<string, CommandEntry> = {
  heading1: { shortcuts: "Mod-1", command: () => makeHeadingCommand(1) },
  heading2: { shortcuts: "Mod-2", command: () => makeHeadingCommand(2) },
  heading3: { shortcuts: "Mod-3", command: () => makeHeadingCommand(3) },
  heading4: { shortcuts: "Mod-4", command: () => makeHeadingCommand(4) },
  heading5: { shortcuts: "Mod-5", command: () => makeHeadingCommand(5) },
  heading6: { shortcuts: "Mod-6", command: () => makeHeadingCommand(6) },
  paragraph: { shortcuts: "Mod-0", command: () => makeParagraphCommand() },
  bold: { shortcuts: "Mod-b", command: () => makeBoldCommand() },
  italic: { shortcuts: "Mod-i", command: () => makeItalicCommand() },
  // Table navigation entries are registered BEFORE codeBlockIndent so that
  // ProseMirror's keymap chain consults them first. They short-circuit (return
  // false) when the cursor is inside a fenced code block, preserving d170f9c
  // (code-block Tab indentation). They also short-circuit during IME
  // composition so CJK input owns the keystroke.
  tableTab: {
    shortcuts: "Tab",
    command: makeTableTabCommand,
  },
  tableShiftTab: {
    shortcuts: "Shift-Tab",
    command: makeTableShiftTabCommand,
  },
  tableExit: {
    shortcuts: "Escape",
    command: makeTableExitCommand,
  },
  codeBlockIndent: {
    shortcuts: "Tab",
    command: () => makeCodeBlockIndentCommand("indent"),
  },
  codeBlockOutdent: {
    shortcuts: "Shift-Tab",
    command: () => makeCodeBlockIndentCommand("outdent"),
  },
  inlineCode: {
    shortcuts: "Mod-Shift-`",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleInlineCodeCommand.key);
    },
  },
  strikethrough: {
    shortcuts: "Ctrl-Shift-`",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleStrikethroughCommand.key);
    },
  },
  link: {
    shortcuts: "Mod-k",
    command: () => (state: Parameters<Command>[0], dispatch: Parameters<Command>[1], view: Parameters<Command>[2]) => {
      const pending = makeTyporaLinkPendingCallback(state, dispatch, view, { source: "shortcut" });
      if (pending) useLinkInsertStore.getState().setPendingCallback(pending);
      return false;
    },
  },
};

/** The keymap config for a platform; only the strikethrough chord differs. */
export function typoraKeymapConfig(isMac: boolean): Record<string, CommandEntry> {
  return {
    ...TYPORA_KEYMAP_ENTRIES,
    ...wysiwygV1Entries(isMac),
    strikethrough: { ...TYPORA_KEYMAP_ENTRIES.strikethrough, shortcuts: strikethroughShortcut(isMac) },
  };
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * The raw keymap config passed to $useKeymap — exported so unit tests can
 * verify shortcut strings and command dispatch without requiring a live editor.
 */
export const TYPORA_KEYMAP_CONFIG: Record<string, CommandEntry> = typoraKeymapConfig(IS_MAC);

const createTyporaKeymap = () => $useKeymap("typora", TYPORA_KEYMAP_CONFIG);

/**
 * The Milkdown plugin instance for use directly in editor factories that do
 * not go through the plugin registry (e.g. MilkdownEditor.tsx).
 *
 * Must be module-level so the same instance is reused across editor
 * recreations — matching the pattern in MilkdownEditor.tsx.
 */
export const typoraKeymapMilkdownPlugin = createTyporaKeymap();

export const typoraKeymapPlugin = createPlugin({
  name: "typora-keymap",
  displayName: "Typora Keymap",
  supportedModes: ["milkdown"],
  priority: 90,
  defaultConfig: {
    enabled: true,
  },
  milkdownPlugin: () => createTyporaKeymap(),
});
