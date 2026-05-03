/**
 * MCP Events Hook
 *
 * Listens for MCP events from Rust (write_document, insert_content,
 * create_document, table_action) and applies them to the frontend
 * document state plus the live editor view.
 */

import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { replaceAll } from "@milkdown/kit/utils";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { loggingService } from "../services/loggingService";
import { applyMcpTableAction, type McpTableAction } from "../utils/tableMcp";

/**
 * Insert position for MCP insert_content.
 */
type InsertPosition = "cursor" | "start" | "end" | number;

/**
 * Event payload for mcp:write_document.
 */
interface WriteDocumentEvent {
  document_id: string;
  content: string;
  window_label: string | null;
}

/**
 * Event payload for mcp:insert_content.
 */
interface InsertContentEvent {
  document_id: string;
  text: string;
  position: InsertPosition;
  window_label: string | null;
}

/**
 * Event payload for mcp:create_document.
 */
interface CreateDocumentEvent {
  document_id: string;
  content: string;
  window_label: string | null;
}

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

/**
 * Hook to listen for MCP events and apply them to documents.
 *
 * Call this at the app level to enable MCP write operations.
 */
export function useMcpEvents() {
  const updateDocumentContent = useDocumentStore((state) => state.updateDocumentContent);
  const upsertDocument = useDocumentStore((state) => state.upsertDocument);
  const setActiveDocumentId = useDocumentStore((state) => state.setActiveDocumentId);

  const windowLabelRef = useRef<string>("main");

  // Get window label on mount
  useEffect(() => {
    const getWindowLabel = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        windowLabelRef.current = getCurrentWindow().label;
      } catch {
        // Keep default "main" if not in Tauri context
      }
    };
    getWindowLabel();
  }, []);

  // Handle write document event
  const handleWriteDocument = useCallback(
    (event: WriteDocumentEvent) => {
      // Check if this event is for our window
      if (event.window_label && event.window_label !== windowLabelRef.current) {
        return;
      }

      const doc = useDocumentStore.getState().getDocumentById(event.document_id);
      if (!doc) {
        loggingService.logEventSync({ level: "warn", event: "mcp.write", status: "fail", context: { documentId: event.document_id, reason: "not found" } });
        return;
      }

      // Update document content
      updateDocumentContent(event.document_id, event.content);

      // Only push the change into the live editor when the target document is
      // currently active — otherwise we would overwrite the wrong visible buffer.
      const activeDocId = useDocumentStore.getState().activeDocumentId;
      const currentEditorView = useEditorStore.getState().editorView;
      if (currentEditorView && event.document_id === activeDocId) {
        const transaction = currentEditorView.state.update({
          changes: {
            from: 0,
            to: currentEditorView.state.doc.length,
            insert: event.content,
          },
        });
        currentEditorView.dispatch(transaction);
      }
    },
    [updateDocumentContent]
  );

  // Handle insert content event
  const handleInsertContent = useCallback(
    (event: InsertContentEvent) => {
      // Check if this event is for our window
      if (event.window_label && event.window_label !== windowLabelRef.current) {
        return;
      }

      const doc = useDocumentStore.getState().getDocumentById(event.document_id);
      if (!doc) {
        loggingService.logEventSync({ level: "warn", event: "mcp.insert", status: "fail", context: { documentId: event.document_id, reason: "not found" } });
        return;
      }

      // Only use the live editor cursor when this document is the active one;
      // otherwise fall back to end-of-document to avoid cross-document corruption.
      const activeDocIdForInsert = useDocumentStore.getState().activeDocumentId;
      const isActiveDoc = event.document_id === activeDocIdForInsert;
      const currentEditorView = useEditorStore.getState().editorView;

      // Calculate insert offset
      let offset: number;
      if (event.position === "cursor") {
        offset = isActiveDoc ? (currentEditorView?.state.selection.main.head ?? 0) : doc.content.length;
      } else if (event.position === "start") {
        offset = 0;
      } else if (event.position === "end") {
        offset = doc.content.length;
      } else {
        offset = Math.min(event.position, doc.content.length);
      }

      // Insert the text
      const newContent =
        doc.content.slice(0, offset) + event.text + doc.content.slice(offset);
      updateDocumentContent(event.document_id, newContent);

      // Only push into the live editor when this is the active document.
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
    },
    [updateDocumentContent]
  );

  // Handle create document event
  const handleCreateDocument = useCallback(
    (event: CreateDocumentEvent) => {
      // Check if this event is for our window (or no specific window)
      if (event.window_label && event.window_label !== windowLabelRef.current) {
        return;
      }

      // Create a new document
      const newDoc = {
        id: event.document_id,
        path: null,
        content: event.content,
        encoding: "UTF-8",
        isModified: event.content.length > 0,
        lastSaved: null,
        fileSize: null,
      };

      upsertDocument(newDoc);
      setActiveDocumentId(event.document_id);
    },
    [upsertDocument, setActiveDocumentId]
  );

  // Handle table action event (Phase 3 WI-3.3).
  const handleTableAction = useCallback(
    (event: TableActionEvent) => {
      processTableActionEvent(event, {
        currentWindowLabel: windowLabelRef.current,
        updateDocumentContent,
      });
    },
    [updateDocumentContent],
  );

  // Set up event listeners
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      // Listen for write_document
      const writeUnlisten = await listen<WriteDocumentEvent>(
        "mcp:write_document",
        (event) => handleWriteDocument(event.payload)
      );
      unlisteners.push(writeUnlisten);

      // Listen for insert_content
      const insertUnlisten = await listen<InsertContentEvent>(
        "mcp:insert_content",
        (event) => handleInsertContent(event.payload)
      );
      unlisteners.push(insertUnlisten);

      // Listen for create_document
      const createUnlisten = await listen<CreateDocumentEvent>(
        "mcp:create_document",
        (event) => handleCreateDocument(event.payload)
      );
      unlisteners.push(createUnlisten);

      // Listen for table_action (WI-3.3)
      const tableUnlisten = await listen<TableActionEvent>(
        "mcp:table_action",
        (event) => handleTableAction(event.payload),
      );
      unlisteners.push(tableUnlisten);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [handleWriteDocument, handleInsertContent, handleCreateDocument, handleTableAction]);
}
