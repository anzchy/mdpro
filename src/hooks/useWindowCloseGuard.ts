/**
 * Purpose: own the OS window-close guard for one mdpro window — the
 * `onCloseRequested` subscription, the window-state / per-file geometry save,
 * and the confirm latch. Extracted from App.tsx (D16 WI-6), where the same
 * effect leaked close handlers on every edit.
 *
 * Pipeline: OS close request or `requestWindowClose` → (no latch: a new
 * attempt) `windowCloseDecisionAfterFlush` (the ONE shared exit rule, ADR-0025)
 * → `prompt` prevents the close and raises `pendingClose` for App's
 * ConfirmDialog | `save-and-close` persists window state, re-decides, latches
 * `clean-save` and closes → the re-entered pass with a latch takes the final
 * decision (`decideLatchedPass`): `allow` lets the close through, `prompt`
 * prompts again.
 *
 * Key decisions:
 * - **Subscribe exactly once.** The effect has empty deps and reads everything
 *   it needs through `getState()` at fire time. It used to depend on
 *   `saveWindowState` → `activeDocument` → `documents`, so every keystroke tore
 *   the listener down and re-subscribed it.
 * - **A cancelled flag, not a bare `unlisten` variable.** `unlisten` is only
 *   assigned after `await import(...)` and `await onCloseRequested(...)` settle.
 *   A cleanup that runs before then used to leave the handler registered
 *   forever; with several live handlers a latched Discard is consumed by the
 *   first and the second prompts again. The flag makes the late resolution
 *   unlisten itself.
 * - **The save body lives in `saveWindowStateOnClose.ts`** (extracted for
 *   the 300-line limit); this hook exposes it as `saveWindowState`.
 * - **The active document is read inside `saveWindowState`, at call time**
 *   (rule 50 §1). Reading it from the render closure while the effect no longer
 *   re-subscribes would freeze it at subscription time, and the per-file
 *   geometry would be written against whichever document was open then rather
 *   than the one open at close.
 * - **Reference frame of the stored record (ADR-0031 decision D-c, settled
 *   here).** Both records this hook writes are `(outer position, inner size)`
 *   in **logical points**.
 *   * Settled by reading `node_modules/@tauri-apps/api/window.d.ts` — the
 *     vendored Tauri v2 typings, which beat recollection. `innerSize()` is
 *     "the physical size of the window's **client area**"; `outerPosition()`
 *     is "the position of the top-left hand corner of **the window**";
 *     `setSize()` "resizes the window with a new **inner** size";
 *     `setPosition()` "sets the window **outer** position". `setOuterSize`
 *     does not exist.
 *   * **The inner/outer pairing was therefore never wrong.** Save reads
 *     (inner size, outer position); restore writes (inner size, outer
 *     position). The two frames already matched, and the Rust builder
 *     (`window.rs` — `.position()` outer, `.inner_size()` inner) matches too.
 *   * **The only defect was the unit axis**: the getters return
 *     `PhysicalSize`/`PhysicalPosition`, and both restore paths applied the
 *     stored numbers as `LogicalSize`/`LogicalPosition`. On a 2x display that
 *     doubled the window on every close/reopen cycle, which is why every
 *     `windowStates` entry on disk is exactly 2x `1200x800 @ 100,100`.
 *   * Hence the single `scaleFactor()` divide below, feeding **both** writes.
 *     Converting one payload and not the other would make the two records
 *     disagree, which is what the WI3-C law forbids.
 * - **A failed `save_window_state` is all-or-nothing (WI3-K, branch ii).** The
 *   two records must agree, so they are not allowed to half-exist: if the
 *   global window state cannot be written, the per-file geometry is not
 *   written either. This was already the de-facto behaviour of the `await`
 *   ordering; WI-3 makes it a decision and gives it the `status: "fail"` log
 *   entry rule 20 requires, replacing a bare `catch {}`. That entry carries
 *   only a stage enum (`geometry_read_failed` / `save_rejected` /
 *   `geometry_save_rejected`), never the rejection text (ADR-0031 step 5b). WI-1 is what makes
 *   this path reachable at all — before it, `save_window_state` swallowed a
 *   load failure and returned `Ok`. It is scoped to `main` (see next item).
 * - **Only `main` writes the global `windowState` (ADR-0037 Decision 3).**
 *   `ownsGlobalWindowState` decides after `scaleFactor()`. Other windows log
 *   an enum-only `skipped`/`not_main` entry and still write per-file geometry.
 * - **A cancelled window prompt calls `onCloseCancelled` (D29, ADR-0033
 *   Decision 4).** Rust dropped this window's routing entry on
 *   `CloseRequested`; App passes `useMcpSync().forceSync` to re-register it.
 *   The callback is held in a ref so a new identity never re-runs the
 *   subscribe-once effect, and it fires only when a window prompt was pending —
 *   read through a ref, because App also calls `cancelClose` for a ⌘W document
 *   prompt and `cancelClose` is created once.
 * - **`requestWindowClose` re-enters the guard (D253, ADR-0112)**: it re-checks
 *   emptiness, then `close()`, which in Tauri v2 emits CloseRequested
 *   (`window.d.ts`; `window.js` destroys only if not prevented). Never `destroy()`.
 * - **What the guard guarantees against the close race (D253, audit b180).**
 *   (1) Clean-save re-decision: the save-and-close path re-decides after the
 *   save, and its `clean-save` latch allows only if the latched pass still finds
 *   nothing unsaved (`dirty_after_state_save`). (2) One attempt generation: each
 *   unlatched pass and each `cancelClose` bumps it; a continuation resuming after
 *   a save with a stale one does nothing (`superseded`). (3) Consent frozen for
 *   the prompt's lifetime: snapshotted when the prompt goes up, never replaced
 *   by a repeat request. (4) Revision-checked Discard: allowed only while the
 *   dirty set is within the consent, by content, and, over a failing flush, by
 *   the editor doc's identity (`dirty_after_discard`). `dataLossGuards.ts` is
 *   untouched: the shared rule is called with no latch and `windowCloseAttempt.ts`
 *   applies the origin, so the quit path cannot change.
 *
 * @module src/hooks/useWindowCloseGuard
 * @coordinates-with src/App.tsx — renders the ConfirmDialog for `pendingClose`
 *   and routes its confirm/cancel back to `confirmClose` / `cancelClose`;
 *   calls `requestWindowClose` when a user close empties a secondary window
 *   (via `src/utils/lastTabClose.ts`); passes `useMcpSync().forceSync` as
 *   `onCloseCancelled`
 * @coordinates-with src/hooks/useMcpSync.ts — `forceSync`, the re-registration
 * @coordinates-with src/utils/dataLossGuards.ts — `windowCloseDecisionAfterFlush`
 * @coordinates-with src/hooks/windowCloseAttempt.ts — latch origin, Discard
 *   consent, the latched pass's decision, the log lines
 * @coordinates-with src/hooks/saveWindowStateOnClose.ts — the save body:
 *   global state (main only), per-file geometry, stage-typed fail log
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { windowCloseDecisionAfterFlush } from "../utils/dataLossGuards";
import { saveWindowStateOnClose } from "./saveWindowStateOnClose";
import {
  type CloseLatch,
  type DiscardConsent,
  type PromptAction,
  decideLatchedPass,
  logCloseCancelled,
  logCloseRequested,
  promptActionFor,
  requestGuardedClose,
  snapshotDiscardConsent,
} from "./windowCloseAttempt";

/** `"window"` while the unsaved-changes dialog for an OS close request is open. */
export type WindowClosePending = "window" | null;

export interface WindowCloseGuard {
  /** `"window"` when the guard is waiting on the user's confirm dialog answer. */
  pendingClose: WindowClosePending;
  /** Persist window state (`main` only) + the active document's geometry, read at call time. */
  saveWindowState: () => Promise<void>;
  /** The user chose Discard: save state, latch the allow (for the prompted documents only), close. */
  confirmClose: () => Promise<void>;
  /** The user chose Cancel: drop the prompt, supersede the attempt, leave the window open. */
  cancelClose: () => void;
  /**
   * Ask this window to close through the guard (D253, ADR-0112): re-check that
   * no document is open, then `close()`, which emits CloseRequested, so the same
   * flush → decide → prompt | save-and-close runs as for an OS close. A logged
   * no-op without a window handle or when a document arrived. Never rejects.
   */
  requestWindowClose: (reason: WindowCloseRequestReason) => Promise<void>;
}

/** Why the app itself asks for a window close. Logged as the `action` enum. */
export type WindowCloseRequestReason = "last_tab_closed";

export interface WindowCloseGuardOptions {
  /** Called once each time the user cancels a pending window-close prompt. */
  onCloseCancelled?: () => void;
}

export function useWindowCloseGuard({ onCloseCancelled }: WindowCloseGuardOptions = {}): WindowCloseGuard {
  const [pendingClose, setPendingCloseState] = useState<WindowClosePending>(null);
  // Mirrors `pendingClose` for `cancelClose`, which is created once and would
  // otherwise read a stale render's value.
  const pendingCloseRef = useRef<WindowClosePending>(null);
  const setPendingClose = useCallback((next: WindowClosePending) => {
    pendingCloseRef.current = next;
    setPendingCloseState(next);
  }, []);
  const onCloseCancelledRef = useRef(onCloseCancelled);
  useLayoutEffect(() => {
    onCloseCancelledRef.current = onCloseCancelled;
  }, [onCloseCancelled]);
  // The allow latch, and (D253) where it came from: see `windowCloseAttempt.ts`.
  const allowWindowCloseRef = useRef(false);
  const latchRef = useRef<CloseLatch>(null);
  // What the prompt on screen showed, for its Discard (D253 consent).
  const consentRef = useRef<DiscardConsent | null>(null);
  // The active close attempt. A continuation whose generation is stale does nothing.
  const attemptRef = useRef(0);
  const appWindowRef = useRef<{ label: string; close: () => Promise<void> | void } | null>(null);

  // Body lives in `saveWindowStateOnClose.ts`; the identity is stable.
  const saveWindowState = useCallback(() => saveWindowStateOnClose(), []);

  const setLatch = useCallback((latch: CloseLatch) => {
    latchRef.current = latch;
    allowWindowCloseRef.current = latch !== null;
  }, []);

  /** Raise the window prompt, capturing what it shows for a later Discard. */
  const raisePrompt = useCallback(
    (windowLabel: string, action: PromptAction) => {
      // Frozen while a prompt is on screen (audit H2): a repeat request must not
      // widen what its Discard covers to documents the user has not been shown.
      if (pendingCloseRef.current !== "window") consentRef.current = snapshotDiscardConsent();
      setPendingClose("window");
      logCloseRequested("cancel", { windowLabel, action });
    },
    [setPendingClose],
  );

  useEffect(() => {
    // Assigned only after two awaits. `cancelled` is what makes a teardown that
    // beats them still remove the handler the boundary registers afterwards.
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const setupWindowListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        appWindowRef.current = currentWindow;
        const dispose = await currentWindow.onCloseRequested(async (event) => {
          const windowLabel = currentWindow.label;
          // A latched pass is the continuation of the attempt that set it; any
          // other pass is a new request and supersedes the one in flight.
          const latch = latchRef.current;
          setLatch(null);
          const attempt = latch ? attemptRef.current : ++attemptRef.current;
          // D15/D16: flush pending WYSIWYG edits, then decide on the fresh
          // any-tab-modified state through the one shared exit rule. A latch
          // only lets the close through if this pass still agrees (D253).
          const decision = latch ? decideLatchedPass(latch) : windowCloseDecisionAfterFlush({ allowWindowClose: false });
          logCloseRequested("start", { windowLabel, decision, allowWindowClose: latch !== null, latch: latch?.kind ?? "none" });

          if (decision === "allow") {
            logCloseRequested("success", { windowLabel, action: "allowed_close" });
            return;
          }
          // Prevent close in all other cases until we finish async work.
          event.preventDefault();
          if (decision === "prompt") {
            raisePrompt(windowLabel, promptActionFor(latch));
            return;
          }
          // No unsaved changes — save state, then re-decide before latching:
          // a dirty document may have arrived during the save (D253).
          await saveWindowState();
          if (attempt !== attemptRef.current) {
            logCloseRequested("cancel", { windowLabel, action: "superseded" });
            return;
          }
          if (windowCloseDecisionAfterFlush({ allowWindowClose: false }) === "prompt") {
            raisePrompt(windowLabel, "dirty_after_state_save");
            return;
          }
          setLatch({ kind: "clean-save" });
          void currentWindow.close();
          logCloseRequested("success", { windowLabel, action: "no_unsaved_closing" });
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      } catch {
        // Window API not available (web preview). Fall back to default behavior.
      }
    };

    void setupWindowListener();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [saveWindowState, setLatch, raisePrompt]);

  const confirmClose = useCallback(async () => {
    const attempt = attemptRef.current;
    const consent = consentRef.current ?? snapshotDiscardConsent();
    setPendingClose(null);
    await saveWindowState();
    if (attempt !== attemptRef.current) {
      logCloseRequested("cancel", { windowLabel: appWindowRef.current?.label ?? "unknown", action: "superseded" });
      return; // a cancel or a new request voided this Discard while saving
    }
    allowWindowCloseRef.current = true;
    latchRef.current = { kind: "discard", consent };
    appWindowRef.current?.close();
  }, [saveWindowState, setPendingClose]);

  const cancelClose = useCallback(() => {
    const wasWindowPrompt = pendingCloseRef.current === "window";
    // Supersede any attempt in flight. The latch is left alone: a latched pass
    // re-decides (clean-save) or checks its consent (discard) anyway.
    attemptRef.current += 1;
    setPendingClose(null);
    if (!wasWindowPrompt) return;
    const callback = onCloseCancelledRef.current;
    logCloseCancelled(callback !== undefined);
    callback?.();
  }, [setPendingClose]);

  // Logs, re-checks emptiness, then `close()` (never `destroy()`): see the helper.
  const requestWindowClose = useCallback(
    (reason: WindowCloseRequestReason) => requestGuardedClose(appWindowRef.current, reason),
    [],
  );

  return { pendingClose, saveWindowState, confirmClose, cancelClose, requestWindowClose };
}
