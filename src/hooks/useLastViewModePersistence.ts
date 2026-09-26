/**
 * Purpose: persist the window's view mode as `lastViewMode`, and re-apply the
 * stored value when no document is open, without letting startup overwrite the
 * stored value before it has been read (ADR-0031 step 5, WI-2, Amendment A1).
 * Moved out of App.tsx, which wrote `lastViewMode` on the first commit after
 * hydration and so replaced the stored value with a default before the read ran.
 *
 * Pipeline: every `viewMode` change → `observed` into the latch → a write only
 *   once armed and only when the mode moved. Settle (arms or re-baselines the
 *   latch, never writes):
 *   (a) `launchPathsComplete && preferencesLoaded && !activeDocument` →
 *       `getPreferences` → `settled(stored)` → `setViewMode(stored)`;
 *   (b) a document is active at that point while still holding →
 *       `settled(viewMode)`, no read;
 *   (c) the read rejects → `settled(viewMode)`.
 *   A stale read result (effect cleaned up, or a persisted change since the
 *   read began) is discarded: no re-baseline, no `setViewMode`; a still-holding
 *   latch settles on the current mode instead.
 *
 * Key decisions:
 * - The decision logic is the pure latch in `utils/lastViewModeLatch.ts`; this
 *   hook only feeds it events and performs the write it returns.
 * - `viewMode` is read from the parameter only, never from the store, so a
 *   mode change and a document change delivered in one commit are seen together.
 * - Case (b) settles only while holding. A later document change must not
 *   re-baseline, or a same-commit mode change would be swallowed.
 * - Closing the last document re-runs the read and re-applies the stored
 *   value (preserved from App.tsx); that is a `settled`, so it never writes.
 * - Automatic changes after settle (e.g. the large-document degrade to source)
 *   are still persisted, as before. Which transitions count as user intent, and
 *   full restore semantics, belong to ADR-0031 step 6.
 * - Staleness counts only persisted changes (made while armed) as a user choice;
 *   a startup change while holding still loses to the read (A1, LVH-02).
 * - Logs carry the settle reason only: no mode, path or label.
 *
 * @coordinates-with src/utils/lastViewModeLatch.ts
 * @coordinates-with src/App.tsx
 */
import { useEffect, useRef } from "react";
import { preferencesService } from "../services/preferencesService";
import { loggingService } from "../services/loggingService";
import { migrateViewMode } from "../utils/viewModeUtils";
import { HOLDING, isHolding, reduce, type LatchEvent, type LatchState } from "../utils/lastViewModeLatch";
import type { Document } from "../types/document";
import type { ViewMode } from "../types/editor";
import type { LogLevel } from "../types/logging";

export interface LastViewModePersistenceOptions {
  preferencesLoaded: boolean;
  launchPathsComplete: boolean;
  activeDocument: Document | null;
  /** The mode currently shown; the only source the hook observes. */
  viewMode: ViewMode;
  /** Applies the stored mode read at settle point (a). */
  setViewMode: (mode: ViewMode) => void;
}

type SettleReason = "read_applied" | "document_active" | "read_failed" | "stale_read_discarded";

function logSettle(
  reason: SettleReason,
  level: LogLevel = "info",
  outcome: "settled" | "discarded" = "settled",
): void {
  loggingService.logEventSync({
    level,
    event: "preferences.last_view_mode",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { outcome, reason },
  });
}

export function useLastViewModePersistence({
  preferencesLoaded,
  launchPathsComplete,
  activeDocument,
  viewMode,
  setViewMode,
}: LastViewModePersistenceOptions): void {
  const latchRef = useRef<LatchState<ViewMode>>(HOLDING);
  const viewModeRef = useRef<ViewMode>(viewMode);
  /** Bumped on every persisted (armed) change: a user choice a pending read must not undo. */
  const userChoiceRef = useRef(0);
  const hasDocument = activeDocument !== null;

  useEffect(() => {
    viewModeRef.current = viewMode;
  });

  useEffect(() => {
    const dispatch = (event: LatchEvent<ViewMode>) => {
      const { state, write } = reduce(latchRef.current, event);
      latchRef.current = state;
      if (write === null) return;
      userChoiceRef.current += 1;
      // setPreferences logs and toasts its own failure; nothing to add here.
      preferencesService.setPreferences({ lastViewMode: write }).catch(() => undefined);
    };
    dispatch({ kind: "observed", mode: viewMode });
  }, [viewMode]);

  useEffect(() => {
    if (!launchPathsComplete || !preferencesLoaded) return;
    if (hasDocument) {
      // (b) Nothing to read while a document is shown; settle on what is shown.
      if (isHolding(latchRef.current)) {
        latchRef.current = reduce(latchRef.current, {
          kind: "settled",
          mode: viewModeRef.current,
        }).state;
        logSettle("document_active");
      }
      return;
    }
    let cancelled = false;
    const choiceAtStart = userChoiceRef.current;
    const settleOnCurrent = (reason: SettleReason, level?: LogLevel) => {
      latchRef.current = reduce(latchRef.current, {
        kind: "settled",
        mode: viewModeRef.current,
      }).state;
      logSettle(reason, level);
    };
    const applyPreferredViewMode = async () => {
      try {
        const prefs = await preferencesService.getPreferences();
        if (cancelled || userChoiceRef.current !== choiceAtStart) {
          // Stale: never re-baseline or apply. Still arm a holding latch.
          if (isHolding(latchRef.current)) settleOnCurrent("stale_read_discarded");
          else logSettle("stale_read_discarded", "info", "discarded");
          return;
        }
        const stored = migrateViewMode(prefs.lastViewMode ?? prefs.defaultViewMode);
        // (a) Settle before applying, so applying the stored mode never writes it.
        latchRef.current = reduce(latchRef.current, { kind: "settled", mode: stored }).state;
        logSettle("read_applied");
        setViewMode(stored);
      } catch {
        // (c) Keep the current mode and settle on it (a stale failure only if holding).
        if (cancelled && !isHolding(latchRef.current)) return;
        settleOnCurrent("read_failed", "warn");
      }
    };
    void applyPreferredViewMode();
    return () => {
      cancelled = true;
    };
  }, [launchPathsComplete, preferencesLoaded, hasDocument, setViewMode]);
}
