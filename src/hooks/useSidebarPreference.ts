/**
 * Purpose: own the sidebar-visibility preference — the ⌘⇧L / menu toggle and
 * its hydration from disk — so a toggle pressed before `get_preferences`
 * resolves can no longer leave the UI and the settings file disagreeing
 * (ADR-0031 step 5b, WI-5, DEC-4).
 *
 * Pipeline: `toggle()` → store flips immediately → before hydration settles:
 *   no write, intent remembered → `hydrate(stored)` → policy P1 below →
 *   after hydration settles (success or `fail()`): one `setPreferences` per
 *   toggle.
 *
 * Key decisions:
 * - Policy P1, "the last pre-hydration intent wins" (matrix orchestrator
 *   decision 2). With a pre-hydration toggle, hydration keeps the store value
 *   and writes it once only if it differs from disk; without one, hydration
 *   applies disk and never writes what it just read.
 * - Hydration failure keeps the store value in memory and writes nothing (the
 *   A2 precedent from `useRecentFiles`); later toggles write normally.
 * - Toggles read `useEditorStore.getState()`, never a render closure, so two
 *   toggles with no re-render between them compose (rule 50 §1).
 * - A rejected write keeps the visible state (no rollback — the sidebar is a
 *   view toggle) and is caught here: `setPreferences` already logs and toasts,
 *   then rethrows, which would otherwise be an unhandled rejection.
 * - All three callbacks keep a stable identity; App's `loadPreferences` effect
 *   lists the returned object's methods in its deps.
 * - This hook is the only non-store writer of `showSidebar`; the SB8 pin in
 *   `tests/sidebar-toggle-hydration.test.tsx` keeps App.tsx from becoming one.
 * - Logging: one `ui.sidebar.preference` entry per hydration-relevant event,
 *   context `{ outcome }` only — `buffered` (pre-settle toggle),
 *   `reconciled_write` / `reconciled_noop` (hydrate after a pre-settle toggle,
 *   differs / equals disk), `applied_stored` (hydrate, no pre-settle toggle),
 *   `hydrate_failed` (`fail()`, warn/fail). A post-settle toggle logs nothing
 *   here: `preferencesService` already logs the write. A toggle's `actionId`
 *   is passed through. Pinned by `tests/sidebar-preference-logging.test.tsx`.
 *
 * @coordinates-with src/stores/editorStore.ts
 * @coordinates-with src/services/preferencesService.ts
 * @coordinates-with src/App.tsx
 * @coordinates-with src/services/loggingService.ts
 */
import { useCallback, useMemo, useRef } from "react";
import { loggingService } from "../services/loggingService";
import { preferencesService } from "../services/preferencesService";
import { useEditorStore } from "../stores/editorStore";

export interface SidebarPreferenceApi {
  /** Flip the sidebar. Persists once hydration has settled; remembered until then. */
  toggle: (actionId?: string) => void;
  /** Apply the stored value read from preferences. Only the first settle has effect. */
  hydrate: (stored: boolean) => void;
  /** Preferences could not be read: keep the current value, write nothing. */
  fail: () => void;
}

const LOG_EVENT = "ui.sidebar.preference";

type SidebarPreferenceOutcome =
  | "buffered"
  | "reconciled_write"
  | "reconciled_noop"
  | "applied_stored"
  | "hydrate_failed";

function logOutcome(outcome: SidebarPreferenceOutcome, actionId?: string): void {
  const failed = outcome === "hydrate_failed";
  loggingService.logUiEvent(
    LOG_EVENT,
    { outcome },
    failed ? "warn" : "info",
    failed ? "fail" : "success",
    actionId,
  );
}

function persist(showSidebar: boolean): void {
  preferencesService.setPreferences({ showSidebar }).catch(() => {
    // Already logged and toasted by preferencesService; the visible state stands.
  });
}

export function useSidebarPreference(): SidebarPreferenceApi {
  const settledRef = useRef(false);
  const toggledBeforeSettleRef = useRef(false);

  const toggle = useCallback((actionId?: string) => {
    const next = !useEditorStore.getState().showSidebar;
    useEditorStore.getState().setShowSidebar(next);
    if (settledRef.current) {
      persist(next);
      return;
    }
    toggledBeforeSettleRef.current = true;
    logOutcome("buffered", actionId);
  }, []);

  const hydrate = useCallback((stored: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (!toggledBeforeSettleRef.current) {
      useEditorStore.getState().setShowSidebar(stored);
      logOutcome("applied_stored");
      return;
    }
    const buffered = useEditorStore.getState().showSidebar;
    if (buffered === stored) {
      logOutcome("reconciled_noop");
      return;
    }
    logOutcome("reconciled_write");
    persist(buffered);
  }, []);

  const fail = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    logOutcome("hydrate_failed");
  }, []);

  return useMemo(() => ({ toggle, hydrate, fail }), [toggle, hydrate, fail]);
}
