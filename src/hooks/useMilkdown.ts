import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditor } from "@milkdown/react";
import {
  commandsCtx,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  commonmark,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { $useKeymap } from "@milkdown/kit/utils";
import { inlineEditPlugin } from "../components/Editor/plugins/inlineEditPlugin";

interface UseMilkdownOptions {
  markdown: string;
  documentId: string | null;
  onMarkdownChange?: (markdown: string) => void;
  onDirty?: () => void;
}

export interface MilkdownApi {
  getMarkdown: () => string | null;
}

const typoraKeymap = $useKeymap("typora", {
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
        // User cancelled or entered empty string
        if (href === null || href.trim() === "") return false;
        // Add https:// if no protocol specified
        let url = href.trim();
        if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) {
          url = "https://" + url;
        }
        return commands.call(toggleLinkCommand.key, { href: url });
      };
    },
  },
});

export function useMilkdown({
  markdown,
  documentId,
  onMarkdownChange,
  onDirty,
}: UseMilkdownOptions): MilkdownApi & { loading: boolean } {
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const onDirtyRef = useRef(onDirty);
  const lastMarkdownRef = useRef(markdown);
  const editorInstanceRef = useRef<Editor | null>(null);

  useEffect(() => {
    onMarkdownChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  useEffect(() => {
    onDirtyRef.current = onDirty;
  }, [onDirty]);

  const initialMarkdown = useMemo(() => markdown, [documentId]);

  useEffect(() => {
    lastMarkdownRef.current = initialMarkdown;
  }, [initialMarkdown]);

  const editor = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown);
        })
        .use(commonmark)
        .use(history)
        .use(listener)
        .use(typoraKeymap)
        .use(inlineEditPlugin),
    [documentId],
  );

  const getMarkdown = useCallback(() => {
    const instance = editor.get();
    if (!instance) return null;
    return instance.action((ctx) => {
      const serializer = ctx.get(serializerCtx);
      const view = ctx.get(editorViewCtx);
      return serializer(view.state.doc);
    });
  }, [editor]);

  useEffect(() => {
    const instance = editor.get();
    if (!instance || instance === editorInstanceRef.current) return;
    editorInstanceRef.current = instance;

    instance.action((ctx) => {
      const manager = ctx.get(listenerCtx);
      manager.updated(() => {
        onDirtyRef.current?.();
      });
      manager.markdownUpdated((_ctx, nextMarkdown) => {
        if (nextMarkdown === lastMarkdownRef.current) return;
        lastMarkdownRef.current = nextMarkdown;
        onMarkdownChangeRef.current?.(nextMarkdown);
      });
    });
  }, [editor]);

  return { loading: editor.loading, getMarkdown };
}
