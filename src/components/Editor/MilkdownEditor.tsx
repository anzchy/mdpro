import { useEffect, useMemo } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  defaultValueCtx,
  Editor,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { useDocumentStore } from "../../stores/documentStore";
import { loggingService } from "../../services/loggingService";

function MilkdownEditorInner() {
  const { documents, activeDocumentId } = useDocumentStore(
    (state) => ({
      documents: state.documents,
      activeDocumentId: state.activeDocumentId,
    }),
  );

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );

  const initialMarkdown = useMemo(
    () => activeDocument?.content ?? "",
    [activeDocument?.content],
  );

  // Log when MilkdownEditor mounts/updates for debugging
  useEffect(() => {
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.mount",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        documentId: activeDocumentId,
        hasContent: initialMarkdown.length > 0,
        contentLength: initialMarkdown.length,
      },
    });
  }, [activeDocumentId, initialMarkdown.length]);

  // Check DOM structure after editor mounts to debug rendering issues
  useEffect(() => {
    const timer = setTimeout(() => {
      const root = document.querySelector(".milkdown-editor");
      const milkdownRoot = root?.querySelector("[data-milkdown-root]");
      const prosemirror = root?.querySelector(".ProseMirror");

      loggingService.logEventSync({
        level: "info",
        event: "editor.milkdown.dom.check",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          hasRoot: !!root,
          hasMilkdownRoot: !!milkdownRoot,
          hasProseMirror: !!prosemirror,
          proseMirrorChildCount: prosemirror?.childNodes.length ?? 0,
          proseMirrorInnerHTML: prosemirror?.innerHTML?.substring(0, 300) ?? null,
        },
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [activeDocumentId]);

  // Use useEditor directly (simplified, no useMilkdown wrapper)
  const editor = useEditor(
    (root) => {
      loggingService.logEventSync({
        level: "info",
        event: "editor.milkdown.factory.direct",
        status: "start",
        actionId: loggingService.generateActionId(),
        context: {
          hasRoot: !!root,
          initialMarkdownLength: initialMarkdown.length,
        },
      });
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown);
        })
        .use(commonmark)
        .use(gfm)
        .use(history);
    },
    [activeDocumentId],
  );

  // Log editor state
  useEffect(() => {
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.direct.state",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        editorLoading: editor.loading,
        hasInstance: !!editor.get(),
      },
    });
  }, [editor.loading]);

  return <Milkdown />;
}

export function MilkdownEditor() {
  // Get activeDocumentId to use as key - forces full recreation when document changes
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

  return (
    <div className="milkdown-editor">
      {/* Key forces MilkdownProvider to recreate when document changes */}
      <MilkdownProvider key={activeDocumentId ?? "empty"}>
        <MilkdownEditorInner />
      </MilkdownProvider>
    </div>
  );
}
