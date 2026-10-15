/**
 * Purpose: own the sidebar-visibility and sidebar-width preferences — the
 * ⌘⇧L / menu / button toggle, the resize handle's settled widths, and their
 * hydration from disk — so a toggle or resize before `get_preferences`
 * resolves can no longer leave the UI and the settings file disagreeing
 * (ADR-0031 step 5b, WI-5, DEC-4; width: D189, ADR-0088).
 *
 * Pipeline: `toggle()` → store flips immediately → before hydration settles:
 *   no write, intent remembered → `hydrate(stored)` → policy P1 below →
 *   after hydration settles (success or `fail()`): one `setPreferences` per
 *   toggle. `resize(width)` → `hydrateWidth(stored)` follow the same pipeline
 *   and policy for the width, settled separately; `fail()` settles both.
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
 * - Width: `resize` clamps (180–480) before it stores or writes, and a resize
 *   to the current width is a no-op (no write, no log). Hydration clamps an
 *   out-of-range stored width in memory and never writes it back. A settled
 *   resize logs one `ui.sidebar.resize` `{ from, to, source }`; the drag
 *   itself never reaches this hook, only its settled width does.
 * - Logging: one `ui.sidebar.preference` entry per hydration-relevant event,
 *   context `{ outcome }` only — `buffered` (pre-settle toggle),
 *   `reconciled_write` / `reconciled_noop` (hydrate after a pre-settle toggle,
 *   differs / equals disk), `applied_stored` (hydrate, no pre-settle toggle),
 *   `hydrate_failed` (`fail()`, warn/fail). A post-settle toggle logs nothing
 *   here: `preferencesService` already logs the write. A toggle's `actionId`
 *   is passed through. Pinned by `tests/sidebar-preference-logging.test.tsx`.
 *
 * @coordinates-with src/stores/editorStore.ts
 * @coordinates-with src/components/Sidebar/SidebarResizeHandle.tsx
 * @coordinates-with src/utils/sidebarWidth.ts
 * @coordinates-with src/services/preferencesService.ts
 * @coordinates-with src/App.tsx
 * @coordinates-with src/services/loggingService.ts
 */
import { useCallback, useMemo, useRef } from "react";
import { loggingService } from "../services/loggingService";
import { preferencesService } from "../services/preferencesService";
import { useEditorStore } from "../stores/editorStore";
import { clampSidebarWidth, type SidebarResizeSource } from "../utils/sidebarWidth";

export interface SidebarPreferenceApi {
  /** Flip the sidebar. Persists once hydration has settled; remembered until then. */
  toggle: (actionId?: string) => void;
  /** Apply the stored value read from preferences. Only the first settle has effect. */
  hydrate: (stored: boolean) => void;
  /** Preferences could not be read: keep the current values, write nothing. */
  fail: () => void;
  /** Settle the sidebar at `width` (clamped). Persists once width hydration has settled. */
  resize: (width: number, source: SidebarResizeSource) => void;
  /** Apply the stored width read from preferences. Only the first settle has effect. */
  hydrateWidth: (stored: number) => void;
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

function persist(patch: { showSidebar: boolean } | { sidebarWidth: number }): void {
  preferencesService.setPreferences(patch).catch(() => {
    // Already logged and toasted by preferencesService; the visible state stands.
  });
}

export function useSidebarPreference(): SidebarPreferenceApi {
  const settledRef = useRef(false);
  const toggledBeforeSettleRef = useRef(false);
  const widthSettledRef = useRef(false);
  const resizedBeforeSettleRef = useRef(false);

  const toggle = useCallback((actionId?: string) => {
    const next = !useEditorStore.getState().showSidebar;
    useEditorStore.getState().setShowSidebar(next);
    if (settledRef.current) {
      persist({ showSidebar: next });
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
    persist({ showSidebar: buffered });
  }, []);

  const fail = useCallback(() => {
    widthSettledRef.current = true;
    if (settledRef.current) return;
    settledRef.current = true;
    logOutcome("hydrate_failed");
  }, []);

  const resize = useCallback((width: number, source: SidebarResizeSource) => {
    const from = useEditorStore.getState().sidebarWidth;
    const to = clampSidebarWidth(width);
    if (to === from) return;
    useEditorStore.getState().setSidebarWidth(to);
    loggingService.logUiEvent("ui.sidebar.resize", { from, to, source });
    if (widthSettledRef.current) {
      persist({ sidebarWidth: to });
      return;
    }
    resizedBeforeSettleRef.current = true;
  }, []);

  const hydrateWidth = useCallback((stored: number) => {
    if (widthSettledRef.current) return;
    widthSettledRef.current = true;
    const storedWidth = clampSidebarWidth(stored);
    if (!resizedBeforeSettleRef.current) {
      useEditorStore.getState().setSidebarWidth(storedWidth);
      return;
    }
    const buffered = useEditorStore.getState().sidebarWidth;
    if (buffered !== storedWidth) persist({ sidebarWidth: buffered });
  }, []);

  return useMemo(
    () => ({ toggle, hydrate, fail, resize, hydrateWidth }),
    [toggle, hydrate, fail, resize, hydrateWidth],
  );
}
