import { $useKeymap } from "@milkdown/kit/utils";
import { commandsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { createPlugin } from "../core/pluginTypes";

/**
 * Builds the command factory for a heading level (1-6).
 * Exported for unit testing.
 */
export function buildHeadingCommand(level: number) {
  return (ctx: Ctx) => {
    const commands = ctx.get(commandsCtx);
    return () => commands.call(wrapInHeadingCommand.key, level);
  };
}

/**
 * Builds the command factory for converting a block to paragraph (⌘0).
 * Uses turnIntoTextCommand which calls setBlockType(paragraph) — the correct
 * approach. Exported for unit testing.
 *
 * NOTE: wrapInHeadingCommand(0) would also work (it branches on level < 1),
 * but using turnIntoTextCommand makes the intent explicit and avoids relying
 * on an undocumented edge-case in wrapInHeadingCommand.
 */
export function buildParagraphCommand(ctx: Ctx) {
  const commands = ctx.get(commandsCtx);
  return () => commands.call(turnIntoTextCommand.key);
}

const createTyporaKeymap = () =>
  $useKeymap("typora", {
    heading1: {
      shortcuts: "Mod-1",
      command: buildHeadingCommand(1),
    },
    heading2: {
      shortcuts: "Mod-2",
      command: buildHeadingCommand(2),
    },
    heading3: {
      shortcuts: "Mod-3",
      command: buildHeadingCommand(3),
    },
    heading4: {
      shortcuts: "Mod-4",
      command: buildHeadingCommand(4),
    },
    heading5: {
      shortcuts: "Mod-5",
      command: buildHeadingCommand(5),
    },
    heading6: {
      shortcuts: "Mod-6",
      command: buildHeadingCommand(6),
    },
    paragraph: {
      shortcuts: "Mod-0",
      command: buildParagraphCommand,
    },
    bold: {
      shortcuts: "Mod-b",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(toggleStrongCommand.key);
      },
    },
    italic: {
      shortcuts: "Mod-i",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(toggleEmphasisCommand.key);
      },
    },
    link: {
      shortcuts: "Mod-k",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => {
          const href = window.prompt("Enter URL (e.g., https://example.com)");
          if (href === null || href.trim() === "") return false;
          let url = href.trim();
          if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) {
            url = "https://" + url;
          }
          return commands.call(toggleLinkCommand.key, { href: url });
        };
      },
    },
  });

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
