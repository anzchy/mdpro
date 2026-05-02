/**
 * Typora-style Keymap Plugin for Milkdown WYSIWYG mode
 *
 * Purpose: Register ⌘1-6 heading shortcuts, ⌘0 paragraph, ⌘B bold,
 * ⌘I italic, ⌘K link, and code-block Tab indentation in the Milkdown editor.
 *
 * Root cause of issue #31:
 * The editor is initialised with `.use(gfm)` only — the GFM preset does NOT
 * include the commonmark preset.  Commands like `wrapInHeadingCommand` live in
 * commonmark's command registry and are therefore NOT registered.  Calling
 * `commands.call(wrapInHeadingCommand.key, N)` throws `contextNotFound` at
 * runtime, causing the shortcut to silently do nothing.
 *
 * Fix:
 * Bypass the Milkdown command registry entirely for heading/paragraph/bold/
 * italic/link.  Each `command` callback now returns a first-class ProseMirror
 * `Command` function — `(state, dispatch, view?) => boolean` — that uses
 * `setBlockType` / `toggleMark` directly, resolving node/mark types from
 * `state.schema` at dispatch time.  This makes the shortcuts independent of
 * which Milkdown presets are loaded.
 *
 * Exception: inlineCode (⌘⇧`) and strikethrough (⌃⇧`) still use the Milkdown
 * command registry because their ProseMirror mark names in the GFM schema are
 * not stable public API.  These commands are registered by the GFM preset that
 * IS loaded, so they work correctly.
 *
 * Note: underline (⌘U / formatUnderline) is not implemented here.
 * CommonMark and GFM have no underline mark, so there is no Milkdown
 * command to bind. The preference entry exists but is intentionally
 * unbound in WYSIWYG mode.
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 * @coordinates-with src/plugins/index.ts
 */

import { $useKeymap } from "@milkdown/kit/utils";
import { commandsCtx } from "@milkdown/kit/core";
import { toggleInlineCodeCommand } from "@milkdown/kit/preset/commonmark";
import {
  toggleStrikethroughCommand,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  addRowAfterCommand,
  exitTable,
} from "@milkdown/kit/preset/gfm";
import {
  setBlockType,
  toggleMark,
} from "@milkdown/kit/prose/commands";
import { isInTable } from "@milkdown/kit/prose/tables";
import type { Command } from "@milkdown/kit/prose/state";

type EditorStateLike = Parameters<Command>[0];
import { createPlugin } from "../core/pluginTypes";
import { useLinkInsertStore } from "../../stores/linkInsertStore";
import { makeCodeBlockIndentCommand } from "./codeBlockIndentCommand";

export { makeCodeBlockIndentCommand } from "./codeBlockIndentCommand";

// ---------------------------------------------------------------------------
// Exported command factories (used directly in tests and in the keymap below)
// ---------------------------------------------------------------------------

/**
 * Returns a ProseMirror Command that converts the current block to a heading
 * of the given level using `state.schema.nodes.heading`.
 * Returns `false` (no-op) if the heading node type is not in the schema.
 */
export function makeHeadingCommand(level: number): Command {
  return (state, dispatch) => {
    const headingType = state.schema.nodes["heading"];
    if (!headingType) return false;
    return setBlockType(headingType, { level })(state, dispatch);
  };
}

/**
 * Returns a ProseMirror Command that converts the current block to a paragraph.
 * Returns `false` (no-op) if the paragraph node type is not in the schema.
 */
export function makeParagraphCommand(): Command {
  return (state, dispatch) => {
    const paragraphType = state.schema.nodes["paragraph"];
    if (!paragraphType) return false;
    return setBlockType(paragraphType)(state, dispatch);
  };
}

/**
 * Returns a ProseMirror Command that toggles the `strong` mark (bold).
 * Returns `false` if the mark is not in the schema.
 */
export function makeBoldCommand(): Command {
  return (state, dispatch) => {
    const strongMark = state.schema.marks["strong"];
    if (!strongMark) return false;
    return toggleMark(strongMark)(state, dispatch);
  };
}

/**
 * Returns a ProseMirror Command that toggles the `emphasis` mark (italic).
 * Returns `false` if the mark is not in the schema.
 */
export function makeItalicCommand(): Command {
  return (state, dispatch) => {
    const emphasisMark = state.schema.marks["emphasis"];
    if (!emphasisMark) return false;
    return toggleMark(emphasisMark)(state, dispatch);
  };
}

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
 * Gate for the table-tab / table-shift-tab / table-escape handlers.
 *
 * Returns `true` only when the cursor is inside a table cell AND we are not
 * inside a fenced code block AND no IME composition is active. The order
 * matters: code_block check wins over isInTable so a code block embedded
 * in a table cell still gets its Tab indentation behavior (preserves the
 * d170f9c regression test).
 */
function isTableTabHandlerEligible(
  state: EditorStateLike,
  view: Parameters<Command>[2],
): boolean {
  // IME guard — never consume a keystroke that the IME owns.
  if (view?.composing) return false;

  // Code-block guard — walk up from the selection; if we hit a code block
  // before any table, the code-block handler downstream owns the key.
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === "code_block") return false;
  }

  return isInTable(state);
}

/**
 * The raw keymap config passed to $useKeymap — exported so unit tests can
 * verify shortcut strings and command dispatch without requiring a live editor.
 */
export const TYPORA_KEYMAP_CONFIG: Record<string, CommandEntry> = {
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
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return (state: Parameters<Command>[0], _dispatch: Parameters<Command>[1], view: Parameters<Command>[2]) => {
        if (!isTableTabHandlerEligible(state, view)) return false;
        const moved = commands.call(goToNextTableCellCommand.key);
        if (moved) return true;
        // Last cell of last row — append a new row, then move into it (Typora).
        commands.call(addRowAfterCommand.key);
        commands.call(goToNextTableCellCommand.key);
        return true;
      };
    },
  },
  tableShiftTab: {
    shortcuts: "Shift-Tab",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return (state: Parameters<Command>[0], _dispatch: Parameters<Command>[1], view: Parameters<Command>[2]) => {
        if (!isTableTabHandlerEligible(state, view)) return false;
        return commands.call(goToPrevTableCellCommand.key);
      };
    },
  },
  tableExit: {
    shortcuts: "Escape",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return (state: Parameters<Command>[0], _dispatch: Parameters<Command>[1], view: Parameters<Command>[2]) => {
        if (!isTableTabHandlerEligible(state, view)) return false;
        return commands.call(exitTable.key);
      };
    },
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
      const linkMark = state.schema.marks["link"];
      if (!linkMark) return false;

      // Snapshot ProseMirror state/dispatch/view at keypress time.
      // ProseMirror state is immutable so this snapshot is safe; dispatch and
      // view refs remain stable across transactions.
      useLinkInsertStore.getState().setPendingCallback((rawUrl: string) => {
        let url = rawUrl.trim();

        // Block dangerous protocols before applying the mark
        const lower = url.toLowerCase().replace(/\s+/g, "");
        if (
          lower.startsWith("javascript:") ||
          lower.startsWith("data:") ||
          lower.startsWith("vbscript:")
        ) {
          return;
        }

        // Normalize bare hostnames to https://
        if (
          !/^https?:\/\//i.test(url) &&
          !url.startsWith("mailto:") &&
          !url.startsWith("#") &&
          !url.startsWith("/")
        ) {
          url = "https://" + url;
        }

        if (view?.isDestroyed) return;
        toggleMark(linkMark, { href: url })(state, dispatch, view);
      });

      // Return false so ProseMirror does not consume the event — the React
      // modal will handle the user interaction asynchronously.
      return false;
    },
  },
};

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
