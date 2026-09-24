/**
 * MCP Sync Hook
 *
 * Purpose: Syncs document state from frontend Zustand to the Rust shadow store,
 * keyed by this window's label. Debounced (300ms) for content changes,
 * immediate for structural changes (open/close, tab switch, a path change).
 *
 * Key decisions:
 * - External-open routing depends on this hook (ADR-0033 Decision 4): Rust
 *   answers "which window holds this path" from the entries synced here. So
 *   the hook is mounted unconditionally in App (never behind an MCP
 *   preference), the window label is resolved synchronously before the first
 *   sync (an async lookup filed early syncs under "main"), and a `path` change
 *   (Save As) syncs at once rather than waiting for the content debounce.
 *   Pinned by tests/useMcpSync.routing.test.ts.
 * - `routable` (ADR-0033 Decision 3) is in the payload and so in the dedupe
 *   hash. App feeds it from `useOpenInWindow`; with no argument it is false.
 *   A flip syncs at once, so Rust never routes on a stale flag.
 * - `forceSync` bypasses the dedupe hash (Decision 4): Rust drops a window's
 *   entry on `CloseRequested`, and a cancelled close must re-register the same
 *   payload. It records the hash it sent, so the next unchanged `syncNow` is
 *   still deduped, and clears any pending debounce.
 *   Pinned by tests/useMcpSync.routable.test.ts.
 *
 * @coordinates-with src/hooks/useOpenInWindow.ts — supplies `routable`
 * @coordinates-with src/hooks/useWindowCloseGuard.ts — `onCloseCancelled` → `forceSync` (via App)
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { mcpService, type McpDocumentState, type SyncDocumentsPayload } from "../services/mcpService";
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
 * This window's label, read synchronously. Outside Tauri (browser dev, tests
 * without a window mock) the getter throws, and the label falls back to "main".
 */
function resolveWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
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

export interface McpSyncOptions {
  /** This window can receive `file:open-in-window` (from `useOpenInWindow`). Default false. */
  routable?: boolean;
}

/**
 * Hook to sync document state to MCP Shadow Store.
 *
 * Call this at the app level to enable MCP document access.
 */
export function useMcpSync({ routable = false }: McpSyncOptions = {}) {
  const documents = useDocumentStore((state) => state.documents);
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncRef = useRef<string | null>(null);
  // Resolved once, on the first render, so the very first sync carries it.
  const [windowLabel] = useState(resolveWindowLabel);

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

  // Perform the actual sync. `force` skips the dedupe check but still records
  // the hash, so an unchanged sync after it stays deduped. The hash is recorded
  // before the await, so a second immediate sync in the same tick (e.g. on
  // open) is deduped; if the IPC call then fails, the catch forgets the hash
  // (only if no newer sync replaced it), so an identical retry goes out and a
  // failed `routable: true` sync cannot leave Rust unroutable.
  // Pinned by tests/useMcpSync.retry.test.ts.
  const doSync = useCallback(async (force = false) => {
    const mcpDocs = convertToMcpDocuments();
    const payload: SyncDocumentsPayload = {
      windowLabel,
      documents: mcpDocs,
      activeDocumentId,
      routable,
    };

    // Create a hash to avoid redundant syncs
    const hash = JSON.stringify(payload);
    if (!force && hash === lastSyncRef.current) {
      return;
    }
    lastSyncRef.current = hash;

    try {
      await mcpService.syncDocuments(payload);
    } catch (err) {
      if (lastSyncRef.current === hash) {
        lastSyncRef.current = null;
      }
      // Log error but don't throw - MCP sync is best-effort
      loggingService.logEventSync({ level: "warn", event: "mcp.sync", status: "fail", context: { error: err instanceof Error ? err.message : String(err) } });
    }
  }, [convertToMcpDocuments, activeDocumentId, windowLabel, routable]);

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

  // Immediate sync for structural changes; `force` bypasses the dedupe hash.
  const syncImmediately = useCallback(
    (force: boolean) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return doSync(force);
    },
    [doSync],
  );
  const immediateSync = useCallback(() => {
    void syncImmediately(false);
  }, [syncImmediately]);
  // Re-register this window even when nothing changed (a cancelled close).
  const forceSync = useCallback(() => syncImmediately(true), [syncImmediately]);

  // Track the routable flag (ADR-0033 Decision 3): a flip syncs at once.
  const prevRoutableRef = useRef(routable);
  useEffect(() => {
    if (routable !== prevRoutableRef.current) {
      prevRoutableRef.current = routable;
      immediateSync();
    }
  }, [routable, immediateSync]);

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

  // Track path changes (Save As) — immediate, so routing never lags the rename.
  // The content hash above ignores `path`, so the debounce would not fire.
  const pathSignature = JSON.stringify(documents.map((d) => [d.id, d.path]));
  const prevPathSignatureRef = useRef(pathSignature);
  useEffect(() => {
    if (pathSignature !== prevPathSignatureRef.current) {
      prevPathSignatureRef.current = pathSignature;
      immediateSync();
    }
  }, [pathSignature, immediateSync]);

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
    forceSync,
  };
}
