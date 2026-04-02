/**
 * MCP Events Hook
 *
 * Listens for MCP events from Rust (write_document, insert_content)
 * and applies them to the frontend document state.
 */

import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { loggingService } from "../services/loggingService";

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
 * Hook to listen for MCP events and apply them to documents.
 *
 * Call this at the app level to enable MCP write operations.
 */
export function useMcpEvents() {
  const updateDocumentContent = useDocumentStore((state) => state.updateDocumentContent);
  const upsertDocument = useDocumentStore((state) => state.upsertDocument);

  const setActiveDocumentId = useDocumentStore((state) => state.setActiveDocumentId);
  const editorView = useEditorStore((state) => state.editorView);

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
      if (editorView && event.document_id === activeDocId) {
        const transaction = editorView.state.update({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: event.content,
          },
        });
        editorView.dispatch(transaction);
      }
    },
    [updateDocumentContent, editorView]
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

      // Calculate insert offset
      let offset: number;
      if (event.position === "cursor") {
        offset = isActiveDoc ? (editorView?.state.selection.main.head ?? 0) : doc.content.length;
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
      if (editorView && isActiveDoc) {
        const transaction = editorView.state.update({
          changes: {
            from: offset,
            to: offset,
            insert: event.text,
          },
          selection: { anchor: offset + event.text.length },
        });
        editorView.dispatch(transaction);
      }
    },
    [updateDocumentContent, editorView]
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
    };

    setupListeners();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [handleWriteDocument, handleInsertContent, handleCreateDocument]);
}
