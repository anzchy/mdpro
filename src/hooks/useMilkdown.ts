import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditor } from "@milkdown/react";
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  parserCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { pluginRegistry } from "../plugins";
import { loggingService } from "../services/loggingService";

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
  const lastAppliedDocIdRef = useRef<string | null>(null);
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
    (root) => {
      loggingService.logEventSync({
        level: "info",
        event: "editor.milkdown.factory",
        status: "start",
        actionId: loggingService.generateActionId(),
        context: {
          hasRoot: !!root,
          rootTagName: root?.tagName ?? null,
          initialMarkdownLength: initialMarkdown.length,
          pluginsCount: milkdownPlugins.length,
        },
      });
      try {
        const result = milkdownPlugins.reduce(
          (builder, plugin) => builder.use(plugin),
          Editor.make()
            .config((ctx) => {
              ctx.set(rootCtx, root);
              ctx.set(defaultValueCtx, initialMarkdown);
            })
            .use(gfm)
            .use(history)
            .use(listener),
        );
        loggingService.logEventSync({
          level: "info",
          event: "editor.milkdown.factory",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: { editorCreated: true },
        });
        return result;
      } catch (error) {
        loggingService.logEventSync({
          level: "error",
          event: "editor.milkdown.factory",
          status: "fail",
          actionId: loggingService.generateActionId(),
          context: {},
          error: String(error),
        });
        throw error;
      }
    },
    [documentId],
  );

  // Log editor state for debugging - check immediately and after delay
  useEffect(() => {
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.state",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        documentId,
        markdownLength: markdown.length,
        initialMarkdownLength: initialMarkdown.length,
        editorLoading: editor.loading,
        hasEditorInstance: !!editor.get(),
        checkTime: "immediate",
      },
    });
    // Check again after a delay to see if instance becomes available
    const timer = setTimeout(() => {
      const instance = editor.get();
      loggingService.logEventSync({
        level: "info",
        event: "editor.milkdown.state.delayed",
        status: instance ? "success" : "fail",
        actionId: loggingService.generateActionId(),
        context: {
          documentId,
          editorLoading: editor.loading,
          hasEditorInstance: !!instance,
          checkTime: "500ms",
        },
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [documentId, markdown.length, initialMarkdown.length, editor.loading]);

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
    const instance = editor.get();
    // Log sync effect state for debugging
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.sync.check",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        documentId,
        hasInstance: !!instance,
        editorLoading: editor.loading,
        lastAppliedDocId: lastAppliedDocIdRef.current,
        markdownLength: markdown.length,
        lastMarkdownLength: lastMarkdownRef.current?.length ?? 0,
      },
    });
    if (!instance || !documentId || editor.loading) return;
    const shouldApply =
      lastAppliedDocIdRef.current !== documentId ||
      markdown !== lastMarkdownRef.current;
    if (!shouldApply) return;

    let applied = false;
    instance.action((ctx) => {
      const parser = ctx.get(parserCtx);
      const view = ctx.get(editorViewCtx);
      const doc = parser(markdown);
      if (!doc) return;

      const tr = view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        doc.content,
      );
      view.dispatch(tr);
      applied = true;
    });

    const reason =
      lastAppliedDocIdRef.current !== documentId
        ? "document_switch"
        : "external_update";
    lastAppliedDocIdRef.current = documentId;
    lastMarkdownRef.current = markdown;
    loggingService.logEventSync({
      level: applied ? "info" : "error",
      event: "editor.milkdown.sync",
      status: applied ? "success" : "fail",
      actionId: loggingService.generateActionId(),
      context: {
        documentId,
        contentLength: markdown.length,
        reason,
      },
      error: applied ? undefined : "parser returned null",
    });
  }, [documentId, editor, editor.loading, markdown]);

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
