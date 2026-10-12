/**
 * Purpose: decide which recorded external change the active document's prompt shows,
 * and when (D171). Recording is immediate (`externalChangeStore`); only this
 * presentation waits `PRESENTATION_DEBOUNCE_MS` after the latest receipt, so a burst
 * of writes prompts once.
 *
 * Pipeline: externalChangeStore slot of the active document → (latest receipt + 300 ms
 *   passed?) present it now : keep the change already shown, or nothing, and present
 *   at the deadline → `file.change.received` `delivered` once per newly presented
 *   (document, seq).
 *
 * Key decisions:
 * - **A change is presented when its document is active.** Activating a document
 *   whose change is older than 300 ms presents it at once; activation never consumes it.
 * - **While a newer change waits out its debounce, the one already shown stays shown**
 *   — unless the user answered it (`settled`), so an acknowledged change is never
 *   re-presented.
 * - **`delivered` reuses the receipt's actionId** and is logged again when the same
 *   change is presented again after a tab round trip.
 *
 * @coordinates-with src/stores/externalChangeStore.ts — the slots and `settled`
 * @coordinates-with src/hooks/useFileWatcher.ts — the caller
 * @coordinates-with src/utils/fileChangeLog.ts — the `file.change.received` builder
 * @module hooks/usePresentedFileChange
 */
import { useEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useExternalChangeStore } from "../stores/externalChangeStore";
import type { FileChangedEvent, PendingFileChange } from "../types/fileChange";
import { currentWindowLabel } from "../utils/currentWindowLabel";
import { buildFileChangeReceivedLog, type FileChangeReceivedOutcome } from "../utils/fileChangeLog";

/** The wait between the latest receipt for a document and its prompt (#211 flicker). */
export const PRESENTATION_DEBOUNCE_MS = 300;

/** Log one `file.change.received` line; `activePath` is read from the store now. */
export function logFileChangeReceived(
  event: FileChangedEvent,
  outcome: FileChangeReceivedOutcome,
  actionId: string = loggingService.generateActionId(),
): void {
  const activePath = useDocumentStore.getState().getActiveDocument()?.path ?? null;
  loggingService.logEventSync(
    buildFileChangeReceivedLog({ event, activePath, outcome, windowLabel: currentWindowLabel(), actionId }),
  );
}

/** The change the prompt for `activeDocumentId` should show now, or null. */
export function usePresentedFileChange(activeDocumentId: string | null): PendingFileChange | null {
  const slot = useExternalChangeStore((s) => (activeDocumentId ? (s.pending[activeDocumentId] ?? null) : null));
  const settledSeq = useExternalChangeStore((s) => (activeDocumentId ? (s.settled[activeDocumentId] ?? 0) : 0));
  const [presented, setPresented] = useState<PendingFileChange | null>(null);

  useEffect(() => {
    if (!slot) {
      setPresented(null);
      return;
    }
    const wait = slot.receivedAt + PRESENTATION_DEBOUNCE_MS - Date.now();
    if (wait <= 0) {
      setPresented(slot);
      return;
    }
    setPresented((prev) =>
      prev && prev.documentId === slot.documentId && prev.seq < slot.seq && prev.seq > settledSeq ? prev : null,
    );
    const timer = setTimeout(() => setPresented(slot), wait);
    return () => clearTimeout(timer);
  }, [slot, settledSeq]);

  const deliveredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!presented) {
      deliveredKeyRef.current = null;
      return;
    }
    const key = `${presented.documentId}:${presented.seq}`;
    if (key === deliveredKeyRef.current) return;
    deliveredKeyRef.current = key;
    logFileChangeReceived(presented.event, "delivered", presented.actionId);
  }, [presented]);

  return presented;
}
