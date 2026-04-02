/**
 * MCP Sync Hook
 *
 * Syncs document state from frontend Zustand to Rust Shadow Store.
 * Uses debounce (300ms) for content changes, immediate for structural changes.
 */

import { useEffect, useRef, useCallback } from "react";
import { useDocumentStore } from "../stores/documentStore";
import { mcpService, type McpDocumentState } from "../services/mcpService";
import { loggingService } from "../services/loggingService";

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
 * Get cursor position from editor view (if available).
 * Returns 0 if not available.
 */
function getCursorPosition(): number {
  // EditorStore cursor position could be added here if needed
  // For now, return 0 as cursor position is tracked separately
  return 0;
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
    return documents.map((doc) => ({
      id: doc.id,
      title: getTitleFromPath(doc.path),
      path: doc.path,
      content: doc.content,
      cursor: getCursorPosition(),
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
