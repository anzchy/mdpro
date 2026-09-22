/**
 * Purpose: the single capture call a Source ⇄ WYSIWYG transition makes on the
 * OUTGOING editor (WI-8). Meant to run inside `editorStore`'s
 * `runViewModeTransition`, synchronously inside `set()`, while the outgoing
 * editor is still mounted — so every trigger (⌃2/⌃4, cycleViewMode, the menu,
 * the large-document degrade) passes through it.
 *
 * Key decisions:
 *   - **Always writes the slot, null included**, so a stale anchor from an
 *     earlier transition can never be applied by a later mount.
 *   - **Never throws** into the store's `set()`: a failed capture writes null
 *     and is logged as `fail`.
 *   - One log line per transition (not a hot path).
 *
 * @module src/utils/scrollAnchor/capture
 * @coordinates-with src/stores/editorStore.ts (caller: runViewModeTransition)
 * @coordinates-with src/utils/scrollAnchor/source.ts, milkdown.ts, anchor.ts
 */
import type { EditorView } from "@codemirror/view";
import type { Editor } from "@milkdown/kit/core";
import type { ViewMode } from "../../types/editor";
import { loggingService } from "../../services/loggingService";
import { useDocumentStore } from "../../stores/documentStore";
import { useMilkdownEditorStore } from "../../stores/milkdownEditorStore";
import { setPendingScrollAnchor, type ScrollAnchor } from "./anchor";
import { captureMilkdownScrollAnchorFromEditor } from "./milkdown";
import { captureSourceScrollAnchor } from "./source";

function captureFrom(
  fromMode: ViewMode,
  cmView: EditorView | null,
  documentId: string,
): ScrollAnchor | null {
  if (fromMode === "source") {
    return cmView ? captureSourceScrollAnchor(cmView, documentId) : null;
  }
  const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
  return editor ? captureMilkdownScrollAnchorFromEditor(editor, documentId) : null;
}

/** Capture the outgoing editor's top-line anchor into the one-shot slot. */
export function captureScrollAnchorForTransition(
  fromMode: ViewMode,
  cmView: EditorView | null,
): void {
  const documentId = useDocumentStore.getState().activeDocumentId;
  let anchor: ScrollAnchor | null = null;
  let error: string | undefined;
  try {
    anchor = documentId ? captureFrom(fromMode, cmView, documentId) : null;
  } catch (caught) {
    anchor = null;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  setPendingScrollAnchor(anchor);
  loggingService.logEventSync({
    level: error ? "error" : "info",
    event: "editor.scroll_anchor.capture",
    status: error ? "fail" : "success",
    actionId: loggingService.generateActionId(),
    context: {
      fromMode,
      documentId,
      block: anchor?.block != null,
      heading: anchor?.heading != null,
    },
    error,
  });
}
