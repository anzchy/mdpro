import { $useKeymap } from "@milkdown/kit/utils";
import { commandsCtx } from "@milkdown/kit/core";
import {
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { createPlugin } from "../core/pluginTypes";

const createTyporaKeymap = () =>
  $useKeymap("typora", {
    heading1: {
      shortcuts: "Mod-1",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 1);
      },
    },
    heading2: {
      shortcuts: "Mod-2",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 2);
      },
    },
    heading3: {
      shortcuts: "Mod-3",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 3);
      },
    },
    heading4: {
      shortcuts: "Mod-4",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 4);
      },
    },
    heading5: {
      shortcuts: "Mod-5",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 5);
      },
    },
    heading6: {
      shortcuts: "Mod-6",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 6);
      },
    },
    paragraph: {
      shortcuts: "Mod-0",
      command: (ctx) => {
        const commands = ctx.get(commandsCtx);
        return () => commands.call(wrapInHeadingCommand.key, 0);
      },
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
