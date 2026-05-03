import "./MilkdownEditor.css";
import { useEffect, useMemo, useRef } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { ImageContextMenu } from "./ImageContextMenu";
import { LinkInsertModal } from "./LinkInsertModal";
import { TableContextMenu } from "./TableContextMenu";
import { TableInsertModal } from "./TableInsertModal";
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark, imageAttr } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import DOMPurify from "dompurify";
import { imagePasteMilkdownPlugin } from "../../plugins/milkdown/imagePastePlugin";
import { typoraKeymapMilkdownPlugin } from "../../plugins/milkdown/typoraKeymapPlugin";
import { inlineEditMilkdownPlugin } from "../../plugins/milkdown/inlineEditPlugin";
import { milkdownHighlightCommand } from "../../plugins/milkdown/milkdownHighlightCommand";
import { highlightMarkPlugin } from "../../plugins/milkdown/highlightMarkPlugin";
import { useMilkdownImages } from "../../hooks/useMilkdownImages";
import { useDocumentStore } from "../../stores/documentStore";
import { useMilkdownEditorStore } from "../../stores/milkdownEditorStore";
import { loggingService } from "../../services/loggingService";
import { getImageResizeDomAttrs } from "../../plugins/milkdown/imageResizePlugin";
import { consumePendingTableCell } from "../../utils/cursorSync/table";
import { restoreCellInMilkdownEditor } from "../../utils/cursorSync/tableMilkdown";

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
          proseMirrorInnerHTMLLength: prosemirror?.innerHTML?.length ?? 0,
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
          ctx.set(imageAttr.key, getImageResizeDomAttrs);
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use(typoraKeymapMilkdownPlugin)
        .use(pasteHtmlSanitizerMilkdownPlugin)
        .use(imagePasteMilkdownPlugin)
        .use(highlightMarkPlugin)
        .use(inlineEditMilkdownPlugin);
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

  // Expose the active editor via milkdownEditorStore so app-level callbacks
  // (e.g. App.tsx onInsertTable) can dispatch commands. Audit fix H6: the
  // store's registerEditor now returns its own cleanup function that only
  // clears the slot when our getter is still active. The previous code
  // captured the pre-register snapshot, so its identity check never matched
  // and the cleanup never fired.
  useEffect(() => {
    const getter = () => editor.get() ?? null;
    return useMilkdownEditorStore.getState().registerEditor(getter);
  }, [editor]);

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

  // WI-2.6: when arriving in WYSIWYG mode and the source-side capture
  // recorded a cell, navigate to the matching cell once the editor is
  // ready. Audit-fix M2: scope consume to the active document so a
  // re-mount after a doc-switch can't steal a stale capture.
  // Audit-fix M3: drop the unstable `editor` object from the dep array;
  // `editor.loading` flipping is the only signal we react to and a
  // stable activeDocumentId keeps the effect from firing twice when
  // useEditor returns a new wrapper but loading hasn't actually changed.
  useEffect(() => {
    if (editor.loading) return;
    const instance = editor.get();
    if (!instance) return;
    const pending = consumePendingTableCell(activeDocumentId);
    if (!pending) return;
    restoreCellInMilkdownEditor(instance, pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.loading, activeDocumentId]);

  // ⌘⇧H highlight in WYSIWYG mode — applies ProseMirror highlight mark via toggleMark.
  // In source/split mode the CodeMirror highlightCommand handles this instead
  // (see Editor.tsx). When highlightRequest increments we obtain the
  // ProseMirror view through the Milkdown editor's action API and delegate.
  useEffect(() => {
    if (highlightRequest === undefined) return;
    const instance = editor.get();
    if (!instance) return;
    let applied = false;
    instance.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      applied = milkdownHighlightCommand(view);
    });
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.highlight",
      status: applied ? "success" : "fail",
      actionId: loggingService.generateActionId(),
      context: { highlightRequest },
    });
  }, [highlightRequest]);

  return (
    <>
      <Milkdown />
      <ImageContextMenu editor={editor} activeDocumentId={activeDocumentId} />
    </>
  );
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
      {/* Inline URL modal for ⌘K link insert — replaces window.prompt (#25) */}
      <LinkInsertModal />
      {/* Inline picker modal for ⌘⌥T table insert — table-CRUD WI-1.1 (#390) */}
      <TableInsertModal />
      {/* Right-click table context menu — table-CRUD WI-1.3 (#390) */}
      <TableContextMenu />
    </div>
  );
}
