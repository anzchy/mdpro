/**
 * MCP table_action dispatch
 *
 * Purpose: Applies an `mcp:table_action` event to the frontend. It computes the
 * new document content with `applyMcpTableAction`, writes it to documentStore
 * as an ordinary (incremental) edit, and pushes it into the live editor view
 * (CodeMirror in source mode, Milkdown `replaceAll` otherwise) when the target
 * is the active document.
 *
 * Key decisions:
 * - Moved verbatim out of `useMcpEvents.ts` (D35 WI-1, 2026-09-30) to keep the
 *   hook under the 300-line limit. No behaviour change; `useMcpEvents.ts`
 *   re-exports both symbols, so existing imports keep working.
 * - The documentStore write is classified `ordinary` in
 *   tests/wholesale-path-partition.test.ts (table cells only), so it does not
 *   reset TOC coordination.
 *
 * @coordinates-with src/hooks/useMcpEvents.ts — registers the listener and calls this
 * @coordinates-with src/utils/tableMcp.ts — `applyMcpTableAction` computes the content
 * @coordinates-with src/stores/documentStore.ts, editorStore.ts, milkdownEditorStore.ts
 * @module hooks/mcpTableAction
 */

import { replaceAll } from "@milkdown/kit/utils";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { loggingService } from "../services/loggingService";
import { applyMcpTableAction, type McpTableAction } from "../utils/tableMcp";

/**
 * Event payload for mcp:table_action (Phase 3 WI-3.3). Rust HTTP
 * routes validate input then emit this; the frontend computes the
 * new document content via `applyMcpTableAction` and pushes it to
 * documentStore + the live editor.
 */
export interface TableActionEvent {
  document_id: string;
  action: McpTableAction;
  payload: Record<string, unknown>;
  window_label: string | null;
}

/**
 * Pure dispatch logic for `mcp:table_action` extracted from the hook
 * so tests can exercise the WYSIWYG/source branching without mounting
 * a React tree. Reads the same Zustand stores the hook does;
 * `currentWindowLabel` and `updateDocumentContent` are passed in to
 * avoid useEffect / useRef indirection.
 *
 * Audit-fix M3 (2026-05-04): this function early-returns when the
 * Milkdown `replaceAll` throws, so the trailing success log no longer
 * fires after a failed apply.
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
  const doc = useDocumentStore.getState().getDocumentById(event.document_id);
  if (!doc) {
    loggingService.logEventSync({
      level: "warn",
      event: `mcp.table.${event.action}`,
      status: "fail",
      context: { documentId: event.document_id, reason: "not found" },
    });
    return;
  }
  const newContent = applyMcpTableAction(
    doc.content,
    event.action,
    event.payload,
  );
  if (newContent === null) {
    loggingService.logEventSync({
      level: "warn",
      event: `mcp.table.${event.action}`,
      status: "fail",
      context: { documentId: event.document_id, reason: "invalid payload" },
    });
    return;
  }

  deps.updateDocumentContent(event.document_id, newContent);

  // Push into the live editor when this is the active document.
  const activeDocId = useDocumentStore.getState().activeDocumentId;
  if (event.document_id === activeDocId) {
    const viewMode = useEditorStore.getState().viewMode;
    if (viewMode === "source") {
      const cmView = useEditorStore.getState().editorView;
      if (cmView) {
        cmView.dispatch(
          cmView.state.update({
            changes: {
              from: 0,
              to: cmView.state.doc.length,
              insert: newContent,
            },
          }),
        );
      }
    } else {
      // Risk R12: dispatch into the live Milkdown view so MCP table
      // mutations land on screen, not just in the file.
      const editor = useMilkdownEditorStore.getState().getEditor();
      if (editor) {
        try {
          (editor as { action: (fn: ReturnType<typeof replaceAll>) => void })
            .action(replaceAll(newContent));
        } catch (err) {
          loggingService.logEventSync({
            level: "warn",
            event: `mcp.table.${event.action}`,
            status: "fail",
            context: {
              documentId: event.document_id,
              reason: "milkdown replaceAll threw",
              error: err instanceof Error ? err.message : String(err),
            },
          });
          return;
        }
      }
    }
  }

  loggingService.logEventSync({
    level: "info",
    event: `mcp.table.${event.action}`,
    status: "success",
    context: { documentId: event.document_id },
  });
}
