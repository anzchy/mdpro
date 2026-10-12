/**
 * Purpose: log one `file.change.decision` line (D32 diagnostics) each time the
 * reload decision for the current (file-change event, active document) pair
 * changes. Observe-only: it never touches App.tsx's prompt / reload effect.
 *
 * @module src/hooks/useFileChangeDecisionLog
 * @coordinates-with src/hooks/useExternalChangePrompt.ts — the one caller, next to
 *   `useFileWatcher`; its own decision effect acts on the same inputs (moved out of
 *   App.tsx in D171).
 * @coordinates-with src/utils/dataLossGuards.ts — `decideFileChange`, the same
 *   function App.tsx acts on, so the logged action cannot drift from the real one.
 * @coordinates-with src/utils/fileChangeLog.ts — the line builder and the
 *   `decisionLogKey` dedupe key.
 * @coordinates-with src/utils/currentWindowLabel.ts — window label, "unknown"
 *   fallback.
 *
 * Pipeline: (fileChangeEvent, activeDocument) -> decideFileChange ->
 *   decisionLogKey -> (key changed?) buildFileChangeDecisionLog ->
 *   loggingService.logEventSync
 *
 * Key decisions:
 * - **One line per run of equal `decisionLogKey`s.** Typing, `isModified`
 *   toggles and new object identities keep the key, so they log nothing; a
 *   tab away-and-back, a Save As (action flips), or a new event timestamp
 *   changes it and re-logs — the re-log with an old `eventTimestamp` is the
 *   stale-event (H6) signal.
 * - **A null event or null document resets the key**, so the same pair
 *   returning after an Ignore/clear is a new run and logs again.
 * - **Never throws out of render or effect.** The window label degrades to
 *   "unknown"; `logEventSync` swallows invoke failures.
 * - **Lives outside the decision effect's file** so that file has one
 *   `decideFileChange(` (source-text tests pin it, dh8).
 */
import { useEffect, useRef } from "react";
import { loggingService } from "../services/loggingService";
import type { Document } from "../types/document";
import { currentWindowLabel } from "../utils/currentWindowLabel";
import { decideFileChange } from "../utils/dataLossGuards";
import { buildFileChangeDecisionLog, decisionLogKey } from "../utils/fileChangeLog";
import type { FileChangedEvent } from "./useFileWatcher";

export function useFileChangeDecisionLog(
  fileChangeEvent: FileChangedEvent | null,
  activeDocument: Document | null,
): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fileChangeEvent || !activeDocument) {
      lastKeyRef.current = null;
      return;
    }
    const decision = decideFileChange(fileChangeEvent, activeDocument);
    const key = decisionLogKey(fileChangeEvent, activeDocument.id, decision.action);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    loggingService.logEventSync(
      buildFileChangeDecisionLog({
        event: fileChangeEvent,
        activeDoc: activeDocument,
        decision,
        windowLabel: currentWindowLabel(),
        actionId: loggingService.generateActionId(),
      }),
    );
  }, [fileChangeEvent, activeDocument]);
}
