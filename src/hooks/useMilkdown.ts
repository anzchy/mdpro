import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditor } from "@milkdown/react";
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { pluginRegistry } from "../plugins";

interface UseMilkdownOptions {
  markdown: string;
  documentId: string | null;
  onMarkdownChange?: (markdown: string) => void;
  onDirty?: () => void;
}

export interface MilkdownApi {
  getMarkdown: () => string | null;
}

const milkdownPlugins = pluginRegistry.getMilkdownPlugins() as Array<
  Parameters<Editor["use"]>[0]
>;

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
  const initializedRef = useRef(false);

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
      milkdownPlugins.reduce(
        (builder, plugin) => builder.use(plugin),
        Editor.make()
          .config((ctx) => {
            ctx.set(rootCtx, root);
            ctx.set(defaultValueCtx, initialMarkdown);
          })
          .use(gfm)
          .use(history)
          .use(listener),
      ),
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
      const view = ctx.get(editorViewCtx);
      if (initializedRef.current) {
        pluginRegistry.cleanup();
      }
      pluginRegistry.setMilkdownView(view);
      pluginRegistry.initialize({ currentMode: "milkdown", milkdownView: view });
      initializedRef.current = true;
      const manager = ctx.get(listenerCtx);
      let lastSelection = view.state.selection;
      manager.updated(() => {
        onDirtyRef.current?.();
        pluginRegistry.emitEvent("docChange", { mode: "milkdown" });
        const nextSelection = view.state.selection;
        if (!nextSelection.eq(lastSelection)) {
          lastSelection = nextSelection;
          pluginRegistry.emitEvent("selectionChange", { mode: "milkdown" });
        }
      });
      manager.markdownUpdated((_ctx, nextMarkdown) => {
        if (nextMarkdown === lastMarkdownRef.current) return;
        lastMarkdownRef.current = nextMarkdown;
        onMarkdownChangeRef.current?.(nextMarkdown);
      });
      manager.focus?.(() => {
        pluginRegistry.emitEvent("focusChange", { mode: "milkdown", focused: true });
      });
      manager.blur?.(() => {
        pluginRegistry.emitEvent("focusChange", { mode: "milkdown", focused: false });
      });
    });
  }, [editor]);

  useEffect(() => {
    return () => {
      if (initializedRef.current) {
        pluginRegistry.cleanup();
        initializedRef.current = false;
      }
      pluginRegistry.setMilkdownView(null);
    };
  }, []);

  return { loading: editor.loading, getMarkdown };
}
