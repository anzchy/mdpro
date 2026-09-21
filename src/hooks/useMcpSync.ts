/**
 * MCP Sync Hook
 *
 * Syncs document state from frontend Zustand to Rust Shadow Store.
 * Uses debounce (300ms) for content changes, immediate for structural changes.
 */

import { useEffect, useRef, useCallback } from "react";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { mcpService, type McpDocumentState } from "../services/mcpService";
import { loggingService } from "../services/loggingService";
import { resolveMcpCursor } from "../utils/mcpCursor";

// Debounce timeout for content changes (ms)
const CONTENT_DEBOUNCE_MS = 300;

/**
 * Get title from file path or return "Untitled".
 */
function getTitleFromPath(path: string | null): string {
  if (!path) return "Untitled";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
}

/**
 * Read the live caret offset, or `undefined` when there is no live editor.
 *
 * Only the CodeMirror source editor writes `editorStore.editorView`, so this
 * is `undefined` in WYSIWYG mode — `resolveMcpCursor` decides what that means.
 */
function liveCaretHead(): number | undefined {
  return useEditorStore.getState().editorView?.state.selection.main.head;
}

/**
 * Hook to sync document state to MCP Shadow Store.
 *
 * Call this at the app level to enable MCP document access.
 */
export function useMcpSync() {
  const documents = useDocumentStore((state) => state.documents);
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncRef = useRef<string>("");
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

  // Convert frontend documents to MCP format
  const convertToMcpDocuments = useCallback((): McpDocumentState[] => {
    // Read the caret once: it belongs to whichever document is focused, and
    // resolveMcpCursor is what decides that the others must not receive it.
    const head = liveCaretHead();

    return documents.map((doc) => ({
      id: doc.id,
      title: getTitleFromPath(doc.path),
      path: doc.path,
      content: doc.content,
      cursor: resolveMcpCursor(doc.content, doc.id === activeDocumentId, head),
      is_dirty: doc.isModified,
      is_active: doc.id === activeDocumentId,
    }));
  }, [documents, activeDocumentId]);

  // Perform the actual sync
  const doSync = useCallback(async () => {
    const mcpDocs = convertToMcpDocuments();
    const payload = {
      windowLabel: windowLabelRef.current,
      documents: mcpDocs,
      activeDocumentId,
    };

    // Create a hash to avoid redundant syncs
    const hash = JSON.stringify(payload);
    if (hash === lastSyncRef.current) {
      return;
    }
    lastSyncRef.current = hash;

    try {
      await mcpService.syncDocuments(payload);
    } catch (err) {
      // Log error but don't throw - MCP sync is best-effort
      loggingService.logEventSync({ level: "warn", event: "mcp.sync", status: "fail", context: { error: err instanceof Error ? err.message : String(err) } });
    }
  }, [convertToMcpDocuments, activeDocumentId]);

  // Debounced sync for content changes
  const debouncedSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      doSync();
      debounceTimerRef.current = null;
    }, CONTENT_DEBOUNCE_MS);
  }, [doSync]);

  // Immediate sync for structural changes
  const immediateSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    doSync();
  }, [doSync]);

  // Track document count changes (open/close)
  const prevDocCountRef = useRef(documents.length);
  useEffect(() => {
    if (documents.length !== prevDocCountRef.current) {
      prevDocCountRef.current = documents.length;
      immediateSync();
    }
  }, [documents.length, immediateSync]);

  // Track active document changes (tab switch)
  const prevActiveIdRef = useRef(activeDocumentId);
  useEffect(() => {
    if (activeDocumentId !== prevActiveIdRef.current) {
      prevActiveIdRef.current = activeDocumentId;
      immediateSync();
    }
  }, [activeDocumentId, immediateSync]);

  // Track content changes (debounced)
  const prevContentHashRef = useRef("");
  useEffect(() => {
    const contentHash = documents.map((d) => `${d.id}:${d.content.length}:${d.isModified}`).join("|");
    if (contentHash !== prevContentHashRef.current) {
      prevContentHashRef.current = contentHash;
      debouncedSync();
    }
  }, [documents, debouncedSync]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Return sync functions for manual triggering if needed
  return {
    syncNow: immediateSync,
    syncDebounced: debouncedSync,
  };
}
