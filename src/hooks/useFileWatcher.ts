/**
 * Purpose: subscribe the active document to the Rust watcher's `file:changed`
 * broadcast, drop events for other paths and events right after our own save,
 * and debounce the rest into `event` state for App.tsx's reload decision.
 *
 * @module src/hooks/useFileWatcher
 * @coordinates-with src-tauri/src/services/file_watcher.rs — emits `file:changed`.
 * @coordinates-with src/utils/fileChangeLog.ts — builds the `file.change.received`
 *   line (D32 diagnostics).
 * @coordinates-with src/utils/currentWindowLabel.ts — the window label, with the
 *   "unknown" fallback.
 *
 * Pipeline: file:changed -> path filter -> save-suppress window -> 300ms
 *   debounce -> setEvent. Every event logs one `file.change.received` line:
 *   other-path | save-suppressed | scheduled, and `delivered` after setEvent.
 *
 * Key decisions:
 * - **Logging never alters control flow.** Each log call sits beside the
 *   existing return / schedule / setEvent; `setEvent` stays first in the timer.
 * - **`delivered` reuses its `scheduled` actionId** (a `const` captured by the
 *   timer), so a superseded event is a scheduled line with no delivered twin.
 * - **Window label falls back to "unknown"** when `getCurrentWindow()` throws, so
 *   a missing window never costs the event.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { loggingService } from "../services/loggingService";
import { currentWindowLabel } from "../utils/currentWindowLabel";
import {
  buildFileChangeReceivedLog,
  type FileChangeReceivedOutcome,
} from "../utils/fileChangeLog";

export interface FileChangedEvent {
  path: string;
  changeType: "modified" | "deleted" | "renamed";
  newPath?: string;
  timestamp: number;
}

// Suppress window in ms after a save operation
const SAVE_SUPPRESS_WINDOW_MS = 3000;

const FRONTEND_DEBOUNCE_MS = 300;

function logReceived(
  event: FileChangedEvent,
  activePath: string,
  outcome: FileChangeReceivedOutcome,
  actionId: string = loggingService.generateActionId(),
): void {
  loggingService.logEventSync(
    buildFileChangeReceivedLog({
      event,
      activePath,
      outcome,
      windowLabel: currentWindowLabel(),
      actionId,
    }),
  );
}

export function useFileWatcher(activePath: string | null) {
  const [event, setEvent] = useState<FileChangedEvent | null>(null);
  const lastSaveTimestampRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Call this when saving to suppress the next file change event
  const markSaveInProgress = useCallback(() => {
    lastSaveTimestampRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!activePath) return;
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    listen<FileChangedEvent>("file:changed", (payload) => {
      if (cancelled) return;
      if (payload.payload.path !== activePath) {
        logReceived(payload.payload, activePath, "other-path");
        return;
      }

      // Suppress external change events shortly after we saved
      const timeSinceSave = Date.now() - lastSaveTimestampRef.current;
      if (timeSinceSave < SAVE_SUPPRESS_WINDOW_MS) {
        logReceived(payload.payload, activePath, "save-suppressed");
        return;
      }

      const actionId = loggingService.generateActionId();
      logReceived(payload.payload, activePath, "scheduled", actionId);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setEvent(payload.payload);
        logReceived(payload.payload, activePath, "delivered", actionId);
      }, FRONTEND_DEBOUNCE_MS);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch(() => {
        // Ignore if events are not supported.
      });

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      unlistenFn?.();
    };
  }, [activePath]);

  return {
    event,
    clearEvent: () => setEvent(null),
    markSaveInProgress,
  };
}
