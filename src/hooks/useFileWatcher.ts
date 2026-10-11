/**
 * Purpose: subscribe the active document to the Rust watcher's `file:changed`
 * broadcast, drop events for other paths, and debounce the rest into `event`
 * state for App.tsx's reload decision.
 *
 * @module src/hooks/useFileWatcher
 * @coordinates-with src-tauri/src/services/file_watcher.rs — emits `file:changed`.
 * @coordinates-with src/utils/fileChangeLog.ts — builds the `file.change.received`
 *   line (D32 diagnostics).
 * @coordinates-with src/utils/currentWindowLabel.ts — the window label, with the
 *   "unknown" fallback.
 *
 * Pipeline: file:changed -> path filter -> 300ms debounce -> setEvent. Every
 *   event logs one `file.change.received` line: other-path | scheduled, and
 *   `delivered` after setEvent.
 *
 * Key decisions:
 * - **No save-suppression window (D86 WI-4).** Our own ⌘S is recognised in Rust:
 *   the self-write mark held while `save_file` writes (`self_write`) and the
 *   baseline bound to the written bytes (`ignored_unchanged`). The 3 s window
 *   that used to sit here also swallowed a real external change landing right
 *   after a save, which Rust never re-reports (ADR-0068 decision 7).
 * - **Logging never alters control flow.** Each log call sits beside the
 *   existing return / schedule / setEvent; `setEvent` stays first in the timer.
 * - **`delivered` reuses its `scheduled` actionId** (a `const` captured by the
 *   timer), so a superseded event is a scheduled line with no delivered twin.
 * - **Window label falls back to "unknown"** when `getCurrentWindow()` throws, so
 *   a missing window never costs the event.
 */
import { useEffect, useState, useRef } from "react";
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
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  };
}
