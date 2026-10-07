/**
 * Purpose: persist the user's explicit view-mode choice as `lastViewMode`, and
 * re-apply the stored value when no document is open, without letting startup
 * overwrite the stored value before it has been read (ADR-0031 step 5, WI-2,
 * Amendment A1) and without persisting automatic switches (ADR-0031 step 6,
 * ADR-0053). Moved out of App.tsx, which wrote `lastViewMode` on the first
 * commit after hydration and so replaced the stored value with a default
 * before the read ran.
 *
 * Pipeline: every new `userViewModeChoice` (a new `seq`) → `observed(choice.mode)`
 *   into the latch → a write only once armed and only when the mode differs
 *   from `lastSeen`. Settle (arms or re-baselines the latch, never writes):
 *   (a) `launchPathsComplete && preferencesLoaded && !activeDocument` →
 *       `getPreferences` → `settled(stored)` → programmatic
 *       `useEditorStore.getState().setViewMode(stored)`;
 *   (b) a document is active at that point while still holding →
 *       `settled(viewMode)`, no read;
 *   (c) the read rejects → `settled(viewMode)`.
 *   A stale read result (effect cleaned up, or a user choice since the read
 *   began) is discarded: no re-baseline, no apply; a still-holding latch
 *   settles on the current mode instead.
 *
 * Key decisions:
 * - Only explicit user commands persist (ADR-0053). The hook observes
 *   `userViewModeChoice`, keyed on its `seq`, never `viewMode`: the
 *   large-document degrade, drop, Finder open, launch paths and `?open=`
 *   switch the mode programmatically and write nothing. A user command that
 *   does not change the mode still counts (D-3); the latch's `lastSeen`
 *   dedupe stops a duplicate write.
 * - The stored mode is applied with a programmatic `setViewMode`, so the
 *   startup apply and the re-apply on closing the last document never record
 *   a user choice and never write.
 * - The decision logic is the pure latch in `utils/lastViewModeLatch.ts`; this
 *   hook only feeds it events and performs the write it returns.
 * - `viewMode` is still read (through a ref) as the settle value in case (b),
 *   case (c) and after a stale read. It is never persisted by itself.
 * - Case (b) settles only while holding. A later document change must not
 *   re-baseline, or a same-commit choice would be swallowed.
 * - Staleness counts user choices, not modes: `userChoiceRef` bumps on EVERY
 *   choice seen while armed, including one the dedupe skips, so a pending
 *   close re-read never overrides it (LVI-07, LVI-07b). A choice made while
 *   holding still loses to the startup read (A1, LVH-02).
 * - `userViewModeChoice` must be a reactive subscription in the caller; a
 *   `getState()` snapshot would never deliver a no-change command (UEP-03c).
 * - Logs carry the settle reason only: no mode, path or label.
 *
 * @coordinates-with src/utils/lastViewModeLatch.ts
 * @coordinates-with src/stores/editorStore.ts — `userViewModeChoice`, `setViewMode`
 * @coordinates-with src/App.tsx
 */
import { useEffect, useRef } from "react";
import { preferencesService } from "../services/preferencesService";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import { migrateViewMode } from "../utils/viewModeUtils";
import { HOLDING, isHolding, reduce, type LatchState } from "../utils/lastViewModeLatch";
import type { Document } from "../types/document";
import type { UserViewModeChoice, ViewMode } from "../types/editor";
import type { LogLevel } from "../types/logging";

export interface LastViewModePersistenceOptions {
  preferencesLoaded: boolean;
  launchPathsComplete: boolean;
  activeDocument: Document | null;
  /** The mode currently shown: the settle value for (b), (c) and a stale read. Never persisted. */
  viewMode: ViewMode;
  /** The latest explicit user command (reactive). The only thing the hook persists. */
  userViewModeChoice: UserViewModeChoice;
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
  userViewModeChoice,
}: LastViewModePersistenceOptions): void {
  const latchRef = useRef<LatchState<ViewMode>>(HOLDING);
  const viewModeRef = useRef<ViewMode>(viewMode);
  /** Bumped on every user choice seen while armed: a choice a pending read must not undo. */
  const userChoiceRef = useRef(0);
  const hasDocument = activeDocument !== null;
  const { seq: choiceSeq, mode: choiceMode } = userViewModeChoice;

  useEffect(() => {
    viewModeRef.current = viewMode;
  });

  // Keyed on the choice (a new `seq` per user command), never on `viewMode`.
  useEffect(() => {
    if (!isHolding(latchRef.current)) userChoiceRef.current += 1;
    const { state, write } = reduce(latchRef.current, { kind: "observed", mode: choiceMode });
    latchRef.current = state;
    if (write === null) return;
    // setPreferences logs and toasts its own failure; nothing to add here.
    preferencesService.setPreferences({ lastViewMode: write }).catch(() => undefined);
  }, [choiceSeq, choiceMode]);

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
        // (a) Settle before applying; the apply is programmatic, so it never writes.
        latchRef.current = reduce(latchRef.current, { kind: "settled", mode: stored }).state;
        logSettle("read_applied");
        useEditorStore.getState().setViewMode(stored);
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
  }, [launchPathsComplete, preferencesLoaded, hasDocument]);
}
