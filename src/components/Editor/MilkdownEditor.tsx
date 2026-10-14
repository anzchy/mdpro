import "./MilkdownEditor.css";
import { useEffect, useMemo } from "react";
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
import { imageAttr } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { Plugin } from "@milkdown/kit/prose/state";
import { TableView } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";
import DOMPurify from "dompurify";
import { imagePasteMilkdownPlugin } from "../../plugins/milkdown/imagePastePlugin";
import { typoraKeymapMilkdownPlugin } from "../../plugins/milkdown/typoraKeymapPlugin";
import { inlineEditMilkdownPlugin } from "../../plugins/milkdown/inlineEditPlugin";
import { milkdownHighlightCommand } from "../../plugins/milkdown/milkdownHighlightCommand";
import { highlightMarkPlugin } from "../../plugins/milkdown/highlightMarkPlugin";
import { editSyncMilkdownPlugin } from "../../plugins/milkdown/editSync/plugin";
import { tableParityPlugins } from "../../plugins/milkdown/table/parityPlugins";
import {
  commonmarkWithBlankLineGaps,
  emptyParagraphEdgeSerializerPlugins,
} from "../../plugins/milkdown/emptyParagraph";
import { useMilkdownImages } from "../../hooks/useMilkdownImages";
import { useMilkdownLinkClickGuard } from "../../hooks/useMilkdownLinkClickGuard";
import { useMilkdownTableCursorRestore } from "../../hooks/useMilkdownTableCursorRestore";
import { useMilkdownFocusRestore } from "../../hooks/useMilkdownFocusRestore";
import { useMilkdownScrollRestore } from "../../hooks/useMilkdownScrollRestore";
import { useMilkdownDebugLogging } from "../../hooks/useMilkdownDebugLogging";
import { useDocumentStore } from "../../stores/documentStore";
import { useMilkdownEditorStore } from "../../stores/milkdownEditorStore";
import { loggingService } from "../../services/loggingService";
import { getImageResizeDomAttrs } from "../../plugins/milkdown/imageResizePlugin";

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

// ProseMirror plugin that sanitizes HTML pasted from the clipboard (#7)
const pasteHtmlSanitizerPlugin = new Plugin({
  props: {
    transformPastedHTML(html: string): string {
      return sanitizePastedHtml(html);
    },
  },
});

const pasteHtmlSanitizerMilkdownPlugin = $prose(() => pasteHtmlSanitizerPlugin);

/**
 * Register prosemirror-tables' `TableView` as the nodeView for `table`
 * nodes. Bug #2/#3 root-cause fix (2026-05-04) — without this, every
 * GFM table renders as a bare `<table>` directly inside `.ProseMirror`
 * with no `<colgroup>` and no `.column-resize-handle` decorations,
 * which means:
 *   - column drag-resize doesn't work (no handles in DOM)
 *   - the wide-table CSS targeting `.tableWrapper` never applies
 *
 * Why this is needed: in `prosemirror-tables@1.8.5` the columnResizing
 * plugin's `state.init` reads `plugin.spec.props.nodeViews` to inject
 * `TableView`, but the plugin's `props` doesn't pre-initialize that
 * object — so the assignment is no-op and the nodeView is never
 * registered. We register it explicitly here, matching the contract
 * `columnResizing` expects (TableView constructor: `(node,
 * defaultCellMinWidth)`).
 */
const tableNodeViewPlugin = $prose(
  () =>
    new Plugin({
      props: {
        nodeViews: {
          table: (node) => new TableView(node, 100),
        },
      },
    }),
);


interface MilkdownEditorInnerProps {
  highlightRequest?: number;
  /** The generation this instance was keyed with (D37 FR-1): a prop, never a store read. */
  generation: number;
}

function MilkdownEditorInner({ highlightRequest, generation }: MilkdownEditorInnerProps) {
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

  useMilkdownDebugLogging(activeDocumentId, initialMarkdown.length);

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
        // ADR-0091 (D188): empty paragraphs are written as blank lines and read back by
        // count; the preset's `<br />` empty-line plugin is swapped out of commonmark.
        .use(commonmarkWithBlankLineGaps)
        .use(gfm)
        .use(emptyParagraphEdgeSerializerPlugins)
        // ADR-0067: ragged tables widen at parse time; empty cells serialize blank. After gfm.
        .use(tableParityPlugins)
        .use(tableNodeViewPlugin)
        .use(history)
        // D15: edits reach documentStore through the view lifecycle, bound to this
        // editor's document — never through a React effect (see editSync/plugin.ts).
        .use(editSyncMilkdownPlugin(activeDocumentId))
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

  // Resolve local image paths to Tauri asset:// URLs after Milkdown renders
  useMilkdownImages(editor, activeDocument?.path ?? null, activeDocumentId);

  // Enforce the link-click scheme allowlist and route clicks by resolved
  // origin — external handoff, in-document, or blocked (#10, ADR-0002);
  // WI-2.6 cursor restore on mode toggle; D37 focus + caret restore after a
  // wholesale rebuild (consumes the carry armed for this generation); WI-8 scroll
  // restore on mode toggle (after the cursor restores, so the scroll position
  // wins). All extracted to hook files to keep this component under the 300-line
  // guideline.
  useMilkdownLinkClickGuard(activeDocumentId);
  useMilkdownTableCursorRestore(editor, activeDocumentId);
  useMilkdownFocusRestore(editor, activeDocumentId, generation);
  useMilkdownScrollRestore(editor, activeDocumentId);

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
  // D15-WI-5: bumped only by a wholesale replacement (reloadEditor), never by typing.
  const generation = useMilkdownEditorStore((state) =>
    activeDocumentId ? (state.editorGenerations[activeDocumentId] ?? 0) : 0,
  );

  return (
    <div id="milkdown-container" className="milkdown-editor">
      {/* Key forces MilkdownProvider to recreate on a document change or a reload */}
      <MilkdownProvider key={`${activeDocumentId ?? "empty"}#${generation}`}>
        <MilkdownEditorInner highlightRequest={highlightRequest} generation={generation} />
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
