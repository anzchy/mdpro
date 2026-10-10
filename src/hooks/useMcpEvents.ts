/**
 * MCP Events Hook
 *
 * Listens for MCP events from Rust (write_document, insert_content,
 * create_document, table_action) and applies them to the frontend
 * document state plus the live editor view.
 *
 * The `mcp:insert_content` body (`processInsertContentEvent`) lives in
 * `./mcpInsertContent.ts` (D35 WI-3, 2026-09-30); the listener here only forwards
 * the window label it resolved.
 *
 * The `mcp:table_action` dispatch (`TableActionEvent`, `processTableActionEvent`)
 * lives in `./mcpTableAction.ts` (moved D35 WI-1, 2026-09-30) and is re-exported
 * here so existing imports from this module keep working.
 */

import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useDocumentStore } from "../stores/documentStore";
import { useTOCStore } from "../stores/tocStore";
import { prepareWholesaleReplace } from "../utils/wholesaleReplace";
import { useEditorStore } from "../stores/editorStore";
import { loggingService } from "../services/loggingService";
import { processTableActionEvent, type TableActionEvent } from "./mcpTableAction";
import { processInsertContentEvent, type InsertContentEvent } from "./mcpInsertContent";

export { processTableActionEvent, type TableActionEvent } from "./mcpTableAction";

/**
 * Event payload for mcp:write_document.
 */
interface WriteDocumentEvent {
  document_id: string;
  content: string;
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

      // Update document content. WI-3.5.5 wholesale: the buffer is replaced, so every
      // heading identity from the previous revision is void. Placed after the
      // window-label and not-found guards, and scoped to the *event's* document.
      prepareWholesaleReplace(event.document_id, "mcp-write"); // + WYSIWYG rebuild (D15-WI-5)
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

  // Handle insert content event; the body lives in ./mcpInsertContent.ts (D35).
  const handleInsertContent = useCallback(
    (event: InsertContentEvent) => {
      processInsertContentEvent(event, {
        currentWindowLabel: windowLabelRef.current,
        updateDocumentContent,
      });
    },
    [updateDocumentContent],
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
        lineEnding: "lf",
        isModified: event.content.length > 0,
        lastSaved: null,
        fileSize: null,
      };

      // WI-3.5.5 wholesale: the id comes from Rust and can collide with an open
      // document, in which case `upsertDocument` replaces it in place.
      useTOCStore.getState().resetCoordination(event.document_id);
      upsertDocument(newDoc);
      // D92: a failed WYSIWYG flush refuses the switch (the new tab stays inactive);
      // editorStore follows only a switch that happened, so the stores agree.
      if (setActiveDocumentId(event.document_id)) {
        useEditorStore.getState().setActiveDocumentId(event.document_id);
      }
    },
    [upsertDocument, setActiveDocumentId]
  );

  // Handle table action event (Phase 3 WI-3.3); dispatch lives in ./mcpTableAction.ts.
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
