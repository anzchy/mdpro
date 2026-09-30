/**
 * Purpose: applies one MCP `insert_content` event to the document store and the live
 * editor (D35). Pure and synchronous; `useMcpEvents.ts` is only the listener wrapper
 * that supplies the window label it resolved.
 *
 * Pipeline: guards (window label, document exists) → if the target is active in
 * WYSIWYG, flush every pending Milkdown edit (`flushPendingEdits("mcp-insert")`) →
 * re-read the document → resolve the offset → if WYSIWYG-active,
 * `prepareWholesaleReplace(id, "mcp-insert")` → store write → if source-active with a
 * live CodeMirror view, dispatch the same insert into it.
 *
 * Key decisions:
 * - A WYSIWYG-active insert is a wholesale replace (ADR-0044, decision (a)): the id-keyed
 *   Milkdown editor would otherwise stay on the pre-insert doc, and its edit-sync
 *   controller would later write that stale markdown over the insert. The rebuild drops
 *   undo history and the TOC coordination (collapse state, heading identity). Keyboard
 *   focus and the caret are carried across it when the editor was focused (D37:
 *   `prepareWholesaleReplace` captures them, `useMilkdownFocusRestore` maps the caret
 *   into the rebuilt doc and refocuses); an unfocused editor stays unfocused.
 * - Flush first, then re-read: a pending WYSIWYG edit reaches the store before the
 *   splice, so the discard in the rebuild drops nothing and the offset is relative to
 *   the post-flush content.
 * - A failed flush refuses the insert (decision (b), the openWriteGuard precedent):
 *   proceeding would discard the unflushed edit. The flush is global, so one tab's
 *   failing serializer refuses WYSIWYG inserts into every tab.
 * - Branch on `viewMode === "wysiwyg"`, never on `editorView === null`: source mode
 *   can also have no live view. Source-mode and non-active inserts stay incremental.
 * - The whole step runs in one synchronous block, as `utils/wholesaleReplace.ts` requires.
 * - Logs `mcp.insert` with `{ documentId, wholesale }` or `{ documentId, reason }` only,
 *   never the inserted text or its length.
 *
 * @coordinates-with src/hooks/useMcpEvents.ts — the `mcp:insert_content` listener
 * @coordinates-with src/utils/wholesaleReplace.ts — reason "mcp-insert"; D37 focus capture
 * @coordinates-with src/hooks/useMilkdownFocusRestore.ts — D37 focus/caret restore after the rebuild
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEdits / reloadEditor
 * @coordinates-with src/utils/mcpCursor.ts — the shared "cursor" offset (ADR-0021)
 * @module hooks/mcpInsertContent
 */
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { loggingService } from "../services/loggingService";
import { resolveMcpCursor } from "../utils/mcpCursor";
import { prepareWholesaleReplace } from "../utils/wholesaleReplace";

const INSERT_EVENT = "mcp.insert";
const INSERT_REASON = "mcp-insert";

/** Insert position for MCP insert_content. */
export type InsertPosition = "cursor" | "start" | "end" | number;

/** Event payload for mcp:insert_content. */
export interface InsertContentEvent {
  document_id: string;
  text: string;
  position: InsertPosition;
  window_label: string | null;
}

export interface InsertContentDeps {
  /** The label of the window this hook runs in; foreign-window events are ignored. */
  currentWindowLabel: string;
  /** The documentStore write, injected so the hook passes its selector. */
  updateDocumentContent: (id: string, content: string) => void;
}

function logFail(documentId: string, reason: string): void {
  loggingService.logEventSync({ level: "warn", event: INSERT_EVENT, status: "fail", context: { documentId, reason } });
}

/** Apply one `mcp:insert_content` event. Synchronous; returns nothing. */
export function processInsertContentEvent(
  event: InsertContentEvent,
  deps: InsertContentDeps,
): void {
  if (event.window_label && event.window_label !== deps.currentWindowLabel) {
    return;
  }

  const documentId = event.document_id;
  if (!useDocumentStore.getState().getDocumentById(documentId)) {
    logFail(documentId, "not found");
    return;
  }

  // Only use the live editor cursor when this document is the active one;
  // otherwise fall back to end-of-document to avoid cross-document corruption.
  const isActiveDoc = documentId === useDocumentStore.getState().activeDocumentId;
  const { viewMode, editorView: currentEditorView } = useEditorStore.getState();
  const isWysiwygActive = isActiveDoc && viewMode === "wysiwyg";

  if (isWysiwygActive) {
    const flush = useMilkdownEditorStore.getState().flushPendingEdits(INSERT_REASON);
    if (flush.status === "failed") {
      logFail(documentId, "flush failed");
      return;
    }
  }

  // Re-read: the flush may just have written a pending WYSIWYG edit.
  const doc = useDocumentStore.getState().getDocumentById(documentId);
  if (!doc) return;

  let offset: number;
  if (event.position === "cursor") {
    // Shared with useMcpSync, which reports this same number to the Rust
    // shadow store (D10(c), ADR-0021).
    offset = resolveMcpCursor(
      doc.content,
      isActiveDoc,
      currentEditorView?.state.selection.main.head
    );
  } else if (event.position === "start") {
    offset = 0;
  } else if (event.position === "end") {
    offset = doc.content.length;
  } else {
    offset = Math.min(event.position, doc.content.length);
  }

  const newContent =
    doc.content.slice(0, offset) + event.text + doc.content.slice(offset);
  if (isWysiwygActive) {
    prepareWholesaleReplace(documentId, INSERT_REASON); // D35 / ADR-0044
  }
  deps.updateDocumentContent(event.document_id, newContent);

  // Only push into the live CodeMirror view when this is the active document
  // (unchanged; in WYSIWYG there is no view, so this is the source-mode path).
  if (currentEditorView && isActiveDoc) {
    const transaction = currentEditorView.state.update({
      changes: {
        from: offset,
        to: offset,
        insert: event.text,
      },
      selection: { anchor: offset + event.text.length },
    });
    currentEditorView.dispatch(transaction);
  }

  loggingService.logEventSync({
    level: "info",
    event: INSERT_EVENT,
    status: "success",
    context: { documentId, wholesale: isWysiwygActive },
  });
}
