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
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDocumentStore } from "../../stores/documentStore";
import { loggingService } from "../../services/loggingService";

// Image path resolution helpers
function isRemoteUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:");
}

function isAssetUrl(src: string): boolean {
  return src.startsWith("asset://") || src.startsWith("tauri://");
}

function resolveImagePath(src: string, documentPath: string | null): string {
  if (isRemoteUrl(src) || isAssetUrl(src)) return src;

  if (src.startsWith("/")) {
    try {
      return convertFileSrc(src);
    } catch {
      return src;
    }
  }

  if (documentPath) {
    const docDir = documentPath.substring(0, documentPath.lastIndexOf("/"));
    let resolvedPath: string;

    if (src.startsWith("./")) {
      resolvedPath = `${docDir}/${src.substring(2)}`;
    } else if (src.startsWith("../")) {
      const parts = docDir.split("/");
      let srcParts = src.split("/");
      while (srcParts[0] === "..") {
        parts.pop();
        srcParts = srcParts.slice(1);
      }
      resolvedPath = `${parts.join("/")}/${srcParts.join("/")}`;
    } else {
      resolvedPath = `${docDir}/${src}`;
    }

    try {
      return convertFileSrc(resolvedPath);
    } catch {
      return src;
    }
  }

  return src;
}

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

  // Process images after Milkdown renders to resolve local paths
  useEffect(() => {
    if (editor.loading) return;

    const documentPath = activeDocument?.filePath ?? null;

    // Small delay to ensure Milkdown has rendered the content
    const timer = setTimeout(() => {
      const container = document.getElementById("milkdown-container");
      if (!container) return;

      const images = container.querySelectorAll("img");
      images.forEach((img) => {
        const originalSrc = img.getAttribute("src");
        if (!originalSrc) return;

        // Skip if already processed (has asset:// or http(s)://)
        if (isAssetUrl(originalSrc) || (isRemoteUrl(originalSrc) && !originalSrc.startsWith("data:"))) {
          return;
        }

        const resolvedSrc = resolveImagePath(originalSrc, documentPath);
        if (resolvedSrc !== originalSrc) {
          img.setAttribute("src", resolvedSrc);
          loggingService.logEventSync({
            level: "info",
            event: "editor.milkdown.image.resolve",
            status: "success",
            actionId: loggingService.generateActionId(),
            context: {
              originalSrc,
              resolvedSrc,
              documentPath,
            },
          });
        }
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [editor.loading, activeDocument?.filePath, activeDocumentId]);

  return <Milkdown />;
}

export function MilkdownEditor() {
  // Get activeDocumentId to use as key - forces full recreation when document changes
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

  return (
    <div id="milkdown-container" className="milkdown-editor">
      {/* Key forces MilkdownProvider to recreate when document changes */}
      <MilkdownProvider key={activeDocumentId ?? "empty"}>
        <MilkdownEditorInner />
      </MilkdownProvider>
    </div>
  );
}
