/**
 * Purpose: the window's one `file:changed` listener (D171, ADR-0081). Mounted once
 * for the window's lifetime, it records every event at once against each open
 * document whose path matches (`externalChangeStore`), and hands App the change the
 * active document's prompt should show (`usePresentedFileChange`).
 *
 * @module src/hooks/useFileWatcher
 * @coordinates-with src-tauri/src/services/file_watcher.rs — emits `file:changed`.
 * @coordinates-with src/stores/externalChangeStore.ts — the per-document records.
 * @coordinates-with src/hooks/usePresentedFileChange.ts — the 300 ms presentation
 *   debounce and the `delivered` line.
 * @coordinates-with src/utils/fileChangeCapture.ts — holds unmatched events for an
 *   open or Save As in flight (D111).
 * @coordinates-with src/utils/fileChangeLog.ts — builds the `file.change.received`
 *   line (D32 diagnostics).
 *
 * Pipeline: file:changed -> recordFileChange (immediately, every matching open
 *   document) -> usePresentedFileChange(active document) -> `change` / `event`. Every
 *   event logs one `file.change.received` line: `other-path` (no open document has
 *   that path; dropped), `captured` (no open document has it yet, held for an open or
 *   Save As in flight, `utils/fileChangeCapture.ts`, D111), `scheduled` (recorded, the active document among them) or
 *   `recorded` (recorded for background documents only); `delivered` when presented.
 *
 * Key decisions:
 * - **Not keyed on the active path (D171).** Keyed on it, the listener dropped every
 *   other path and its teardown on each tab switch cancelled the debounce; Rust
 *   re-baselines when it emits, so those changes were never reported again. The
 *   `activePath` argument is accepted for its callers and ignored.
 * - **Recording is never debounced; only presentation is.** A save during the 300 ms
 *   already sees the record (the save-time check, `utils/externalChangeGuard.ts`).
 * - **The records live as long as the listener**: they are dropped when it mounts and
 *   when it unmounts, so nothing outlives the window's listener.
 * - **No save-suppression window (D86 WI-4).** Our own ⌘S is recognised in Rust (the
 *   self-write mark and the written-bytes baseline, ADR-0068 decision 7).
 * - **Logging never alters control flow.** `delivered` reuses the receipt's actionId,
 *   so a superseded event is a receipt line with no delivered twin.
 * - **`clearEvent` is memoised (D172)** and settles only the change it names:
 *   `clearEvent(path, documentId)` (the prompt's withdrawal) drops that document's
 *   record; `clearEvent(path)` acknowledges the presented change only if it is that
 *   path's; `clearEvent()` acknowledges the presented change.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import {
  acknowledgeFileChange,
  forgetFileChange,
  recordFileChange,
  resetFileChanges,
} from "../stores/externalChangeStore";
import type { FileChangedEvent, PendingFileChange } from "../types/fileChange";
import { captureUnmatched } from "../utils/fileChangeCapture";
import { logFileChangeReceived, usePresentedFileChange } from "./usePresentedFileChange";

export type { FileChangedEvent } from "../types/fileChange";

/** Record one event (or hold it for an open in flight, D111) and log what the receipt did. */
function receive(event: FileChangedEvent): void {
  const actionId = loggingService.generateActionId();
  const { documentIds, activeRecorded } = recordFileChange(event, actionId);
  const outcome =
    documentIds.length > 0
      ? activeRecorded
        ? "scheduled"
        : "recorded"
      : captureUnmatched(event, actionId)
        ? "captured"
        : "other-path";
  logFileChangeReceived(event, outcome, actionId);
}

export interface FileWatcher {
  /** The presented change's event, as Rust emitted it; null when nothing is shown. */
  event: FileChangedEvent | null;
  /** The presented change with its document id and sequence. */
  change: PendingFileChange | null;
  clearEvent: (path?: string, documentId?: string) => void;
}

export function useFileWatcher(_activePath?: string | null): FileWatcher {
  useEffect(() => {
    resetFileChanges();
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    listen<FileChangedEvent>("file:changed", (payload) => {
      if (cancelled) return;
      receive(payload.payload);
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
      unlistenFn?.();
      resetFileChanges();
    };
  }, []);

  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);
  const change = usePresentedFileChange(activeDocumentId);
  const changeRef = useRef(change);
  useLayoutEffect(() => {
    changeRef.current = change;
  });

  const clearEvent = useCallback((path?: string, documentId?: string) => {
    if (documentId !== undefined) {
      forgetFileChange(documentId, "withdrawn");
      return;
    }
    const shown = changeRef.current;
    if (!shown || (path !== undefined && shown.path !== path)) return;
    acknowledgeFileChange(shown.documentId, shown.seq, "ignored");
  }, []);

  return { event: change?.event ?? null, change, clearEvent };
}
