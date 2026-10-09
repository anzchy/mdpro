/**
 * MCP table_action dispatch
 *
 * Purpose: Applies an `mcp:table_action` event to the frontend. It computes the
 * new document content with `applyMcpTableAction` from the target's post-flush
 * content, commits it to the live editor (Milkdown in WYSIWYG, CodeMirror in
 * source mode) when the target is the active document, and writes it to
 * documentStore as an ordinary (incremental) edit.
 *
 * Pipeline: window-label guard → document exists → if the target is active in
 * WYSIWYG, flush that document only (`flushPendingEditsFor(id, "mcp-table")`) and
 * refuse on failure → re-read the document, `activeDocumentId`, `viewMode` and the
 * editor → compute → WYSIWYG-active: commit to Milkdown first
 * (`mcpTableApplyMilkdown.ts`), then the store → source-active: store first, then
 * the CodeMirror dispatch → non-active: store only.
 *
 * Key decisions (D58, ADR-0065):
 * - Flush first, targeted: a pending WYSIWYG keystroke reaches the store before the
 *   edit is computed, so it is not overwritten; another tab's flusher never runs, so
 *   it cannot refuse this action. The gate (`isActive && viewMode === "wysiwyg"`) is
 *   read before the flush; the branch is decided on values re-read after it.
 * - WYSIWYG commits the editor before the store, so a refused or failed editor apply
 *   leaves the store untouched. A throw after the view advanced aligns the store with
 *   the editor through a separate reconcile write and logs `storeReconciled: true`.
 * - WYSIWYG-active with no editor is refused ("editor unavailable"), never store-only.
 * - Source mode keeps store-first; a CodeMirror dispatch throw is logged, not thrown.
 *   Source success output is unchanged.
 * - Both store writes are classified `ordinary` in tests/wholesale-path-partition.test.ts
 *   (table cells only), so they do not reset TOC coordination.
 * - Logs `mcp.table.<action>` with `{ documentId }` plus `reason` / `error` /
 *   `storeReconciled` on failure, never cell text.
 * - Moved out of `useMcpEvents.ts` (D35 WI-1), which re-exports both symbols.
 *
 * @coordinates-with src/hooks/useMcpEvents.ts — registers the listener and calls this
 * @coordinates-with src/hooks/mcpTableApplyMilkdown.ts — the WYSIWYG editor phase
 * @coordinates-with src/utils/tableMcp.ts — `applyMcpTableAction` computes the content
 * @coordinates-with src/stores/documentStore.ts, editorStore.ts, milkdownEditorStore.ts
 * @module hooks/mcpTableAction
 */

import type { Editor } from "@milkdown/kit/core";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { loggingService } from "../services/loggingService";
import { applyMcpTableAction, type McpTableAction } from "../utils/tableMcp";
import { REASON_THREW, applyTableToMilkdown } from "./mcpTableApplyMilkdown";

const FLUSH_REASON = "mcp-table";

/**
 * Event payload for mcp:table_action (Phase 3 WI-3.3). Rust HTTP
 * routes validate input then emit this; the frontend computes the
 * new document content via `applyMcpTableAction` and pushes it to
 * the live editor + documentStore.
 */
export interface TableActionEvent {
  document_id: string;
  action: McpTableAction;
  payload: Record<string, unknown>;
  window_label: string | null;
}

/**
 * Pure dispatch logic for `mcp:table_action` extracted from the hook
 * so tests can exercise the branching without mounting a React tree.
 * Reads the same Zustand stores the hook does; `currentWindowLabel` and
 * `updateDocumentContent` are passed in to avoid useEffect / useRef
 * indirection. Never throws; every refusal or failure logs exactly one
 * `mcp.table.<action>` fail entry, and a success logs exactly one success.
 */
export function processTableActionEvent(
  event: TableActionEvent,
  deps: {
    currentWindowLabel: string;
    updateDocumentContent: (id: string, content: string) => void;
  },
): void {
  if (event.window_label && event.window_label !== deps.currentWindowLabel) {
    return;
  }
  const fail = (context: Record<string, unknown>) =>
    loggingService.logEventSync({
      level: "warn",
      event: `mcp.table.${event.action}`,
      status: "fail",
      context: { documentId: event.document_id, ...context },
    });
  const documents = useDocumentStore.getState();
  if (!documents.getDocumentById(event.document_id)) {
    fail({ reason: "not found" });
    return;
  }
  const flushGate =
    event.document_id === documents.activeDocumentId &&
    useEditorStore.getState().viewMode === "wysiwyg";
  if (
    flushGate &&
    useMilkdownEditorStore.getState().flushPendingEditsFor(event.document_id, FLUSH_REASON)
      .status === "failed"
  ) {
    fail({ reason: "flush failed" });
    return;
  }

  // Re-read everything after the flush: it may have written the store, and the
  // branch must follow the state the edit is applied to.
  const doc = useDocumentStore.getState().getDocumentById(event.document_id);
  if (!doc) {
    fail({ reason: "not found" });
    return;
  }
  const newContent = applyMcpTableAction(doc.content, event.action, event.payload);
  if (newContent === null) {
    fail({ reason: "invalid payload" });
    return;
  }
  const isActive = event.document_id === useDocumentStore.getState().activeDocumentId;
  const viewMode = useEditorStore.getState().viewMode;

  if (isActive && viewMode === "wysiwyg") {
    const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
    if (!editor) {
      fail({ reason: "editor unavailable" });
      return;
    }
    const outcome = applyTableToMilkdown(editor, newContent);
    if (outcome.kind === "refused") {
      const { reason, error } = outcome;
      fail(error === undefined ? { reason } : { reason, error });
      return;
    }
    if (outcome.kind === "reconciled") {
      const reconciledMarkdown = outcome.markdown;
      deps.updateDocumentContent(event.document_id, reconciledMarkdown);
      fail({ reason: REASON_THREW, error: outcome.error, storeReconciled: true });
      return;
    }
  }

  deps.updateDocumentContent(event.document_id, newContent);

  const cmView = isActive && viewMode === "source" ? useEditorStore.getState().editorView : null;
  if (cmView) {
    try {
      cmView.dispatch(
        cmView.state.update({
          changes: { from: 0, to: cmView.state.doc.length, insert: newContent },
        }),
      );
    } catch (err) {
      fail({
        reason: "codemirror dispatch threw",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  loggingService.logEventSync({
    level: "info",
    event: `mcp.table.${event.action}`,
    status: "success",
    context: { documentId: event.document_id },
  });
}
