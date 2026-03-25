import { useEffect, useMemo, useRef } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import DOMPurify from "dompurify";
import { imagePasteMilkdownPlugin } from "../../plugins/milkdown/imagePastePlugin";
import { typoraKeymapMilkdownPlugin } from "../../plugins/milkdown/typoraKeymapPlugin";
import { milkdownHighlightCommand } from "../../plugins/milkdown/milkdownHighlightCommand";
import { useMilkdownImages } from "../../hooks/useMilkdownImages";
import { useDocumentStore } from "../../stores/documentStore";
import { loggingService } from "../../services/loggingService";

// ---------------------------------------------------------------------------
// Security helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Sanitize HTML string using DOMPurify before it is parsed by ProseMirror.
 * Strips event-handler attributes (onerror, onclick, …), script tags, and
 * dangerous href protocols (javascript:, data:).
 * Called by the transformPastedHTML ProseMirror plugin (issue #7).
 */
export function sanitizePastedHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    // Forbid all on* event attributes
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus",
      "onblur", "onkeydown", "onkeyup", "onkeypress", "onsubmit",
      "onchange", "onmouseenter", "onmouseleave", "onmousedown",
      "onmouseup", "ondblclick", "oncontextmenu", "oninput",
      "onpaste", "ondrop", "ondragstart"],
    // Remove script / style / iframe entirely
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
  });
  // Strip non-image data: URIs from src attributes (data:image/ are legitimate;
  // data:text/html or similar could embed raw markup even if it can't run in img context)
  return sanitized.replace(/\s+src=["']data:(?!image\/)[^"']*["']/gi, "");
}

/**
 * Returns true when an href is safe to open.
 * Blocks javascript:, data:, and vbscript: protocols (issue #10).
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false;
  // Trim whitespace — bypass attempts like "  javascript:alert(1)"
  const trimmed = href.trim().toLowerCase();
  if (trimmed.startsWith("javascript:")) return false;
  if (trimmed.startsWith("data:")) return false;
  if (trimmed.startsWith("vbscript:")) return false;
  return true;
}

// ProseMirror plugin that sanitizes HTML pasted from the clipboard (#7)
const pasteHtmlSanitizerPlugin = new Plugin({
  props: {
    transformPastedHTML(html: string): string {
      return sanitizePastedHtml(html);
    },
  },
});

const pasteHtmlSanitizerMilkdownPlugin = $prose(() => pasteHtmlSanitizerPlugin);


interface MilkdownEditorInnerProps {
  highlightRequest?: number;
}

function MilkdownEditorInner({ highlightRequest }: MilkdownEditorInnerProps) {
  const documents = useDocumentStore((state) => state.documents);
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

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
        .use(history)
        .use(listener)
        .use(typoraKeymapMilkdownPlugin)
        .use(pasteHtmlSanitizerMilkdownPlugin)
        .use(imagePasteMilkdownPlugin);
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

  // Wire Milkdown listener → documentStore so Cmd+S always saves what is on screen.
  // Uses a ref to avoid registering multiple callbacks on the same instance.
  const registeredInstanceRef = useRef<Editor | null>(null);
  useEffect(() => {
    const instance = editor.get();
    if (!instance || instance === registeredInstanceRef.current) return;
    registeredInstanceRef.current = instance;

    // Capture the owning document id at listener registration time so that
    // markdownUpdated always writes back to the correct document even if the
    // user switches tabs before the callback fires.
    const owningDocumentId = activeDocumentId;
    instance.action((ctx) => {
      const manager = ctx.get(listenerCtx);
      manager.markdownUpdated((_ctx, markdown) => {
        const { updateDocumentContent: update } = useDocumentStore.getState();
        if (owningDocumentId) {
          update(owningDocumentId, markdown);
        }
      });
    });

    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.listener.registered",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { documentId: activeDocumentId },
    });
  }, [editor, activeDocumentId]);

  // Resolve local image paths to Tauri asset:// URLs after Milkdown renders
  useMilkdownImages(editor, activeDocument?.path ?? null, activeDocumentId);

  // Block javascript: and data: link clicks in the WYSIWYG editor (#10).
  // Mirrors the link-click guard in Preview.tsx.
  useEffect(() => {
    const container = document.getElementById("milkdown-container");
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link || !(link instanceof HTMLAnchorElement)) return;
      const href = link.getAttribute("href") ?? "";
      if (!isSafeHref(href)) {
        // Silently block dangerous protocol links
        event.preventDefault();
        event.stopPropagation();
        loggingService.logEventSync({
          level: "warn",
          event: "editor.milkdown.link.blocked",
          status: "fail",
          actionId: loggingService.generateActionId(),
          context: { href: href.substring(0, 100) },
        });
        return;
      }
      // Safe link — open externally
      event.preventDefault();
      import("@tauri-apps/plugin-opener")
        .then(({ openUrl }) => openUrl(link.href))
        .catch(() => window.open(link.href, "_blank", "noopener,noreferrer"));
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [activeDocumentId]);

  // ⌘⇧H highlight in WYSIWYG mode — wraps selected text with ==markers==
  // In source/split mode the CodeMirror highlightCommand handles this instead
  // (see Editor.tsx). When highlightRequest increments we obtain the
  // ProseMirror view through the Milkdown editor's action API and delegate.
  useEffect(() => {
    if (highlightRequest === undefined) return;
    const instance = editor.get();
    if (!instance) return;
    instance.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      milkdownHighlightCommand(view);
    });
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.highlight",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { highlightRequest },
    });
  }, [highlightRequest]);

  return <Milkdown />;
}

interface MilkdownEditorProps {
  highlightRequest?: number;
}

export function MilkdownEditor({ highlightRequest }: MilkdownEditorProps) {
  // Get activeDocumentId to use as key - forces full recreation when document changes
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

  return (
    <div id="milkdown-container" className="milkdown-editor">
      {/* Key forces MilkdownProvider to recreate when document changes */}
      <MilkdownProvider key={activeDocumentId ?? "empty"}>
        <MilkdownEditorInner highlightRequest={highlightRequest} />
      </MilkdownProvider>
    </div>
  );
}
