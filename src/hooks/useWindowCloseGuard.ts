/**
 * Purpose: own the OS window-close guard for one mdpro window — the
 * `onCloseRequested` subscription, the window-state / per-file geometry save,
 * and the confirm latch.
 *
 * Pipeline: close request → shared flush/decision → prompt or save → Rust
 * stage for a secondary window → guarded re-entry and final consent check.
 *
 * Key decisions:
 * - Subscribe once; read stores with `getState()` and use `cancelled` to
 *   dispose a listener registered after effect cleanup.
 * - Save reads the active document at call time. `saveWindowStateOnClose`
 *   owns logical-point geometry, all-or-nothing writes, and main-only global
 *   state (ADR-0031/0037).
 * - A cancelled window prompt calls the ref-held `onCloseCancelled` to
 *   re-register routing (D29), unlike a document-only ⌘W prompt.
 * - `requestWindowClose` rechecks emptiness, then calls `close()` to re-enter
 *   the guard; never bypass it with `destroy()` (D253, ADR-0112).
 * - Re-decide after save and staging. Attempt generations reject stale
 *   continuations; Discard consent stays frozen to its prompt's dirty content
 *   and editor revision (D253). D294 restores visibility after a veto or
 *   supersession and preserves a new clean tab after last-tab close. The
 *   shared `dataLossGuards.ts` and quit path are unchanged.
 * @module src/hooks/useWindowCloseGuard
 * @coordinates-with src/App.tsx — dialog, last-tab close and cancel routing
 * @coordinates-with src/utils/dataLossGuards.ts — `windowCloseDecisionAfterFlush`
 * @coordinates-with src/hooks/windowCloseAttempt.ts — consent and staging
 * @coordinates-with src/hooks/saveWindowStateOnClose.ts — state-save body
 * @coordinates-with src-tauri/src/commands/window_close_order.rs — native stage
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { windowCloseDecisionAfterFlush } from "../utils/dataLossGuards";
import { useDocumentStore } from "../stores/documentStore";
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
  stageSecondaryClose,
  restoreSecondaryClose,
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
  const stagePendingRef = useRef<number | null>(null);
  const beganEmptyRef = useRef(false);
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
          if (!latch) beganEmptyRef.current = useDocumentStore.getState().documents.length === 0;
          // D15/D16: flush pending WYSIWYG edits, then decide on the fresh
          // any-tab-modified state through the one shared exit rule. A latch
          // only lets the close through if this pass still agrees (D253).
          const decision = latch ? decideLatchedPass(latch) : windowCloseDecisionAfterFlush({ allowWindowClose: false });
          logCloseRequested("start", { windowLabel, decision, allowWindowClose: latch !== null, latch: latch?.kind ?? "none" });

          if (decision === "allow") {
            if (latch?.kind === "clean-save" && beganEmptyRef.current
              && useDocumentStore.getState().documents.length > 0) {
              event.preventDefault();
              stagePendingRef.current = null;
              await restoreSecondaryClose(windowLabel);
              logCloseRequested("cancel", { windowLabel, action: "new_document_after_stage" });
              return;
            }
            stagePendingRef.current = null;
            logCloseRequested("success", { windowLabel, action: "allowed_close" });
            return;
          }
          // Prevent close in all other cases until we finish async work.
          event.preventDefault();
          if (decision === "prompt") {
            if (stagePendingRef.current !== null) {
              stagePendingRef.current = null;
              await restoreSecondaryClose(windowLabel);
            }
            if (attempt !== attemptRef.current) return;
            raisePrompt(windowLabel, promptActionFor(latch));
            return;
          }
          const wasEmpty = useDocumentStore.getState().documents.length === 0;
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
          if (windowLabel !== "main") {
            stagePendingRef.current = attempt;
            const staged = await stageSecondaryClose(
              windowLabel,
              () => attempt === attemptRef.current,
              () => windowCloseDecisionAfterFlush({ allowWindowClose: false }) !== "prompt"
                && (!wasEmpty || useDocumentStore.getState().documents.length === 0),
              () => pendingCloseRef.current === "window" || stagePendingRef.current === null,
            );
            if (attempt !== attemptRef.current && staged === "ready") {
              const shouldRestore = stagePendingRef.current === attempt || pendingCloseRef.current === "window";
              if (stagePendingRef.current === attempt) stagePendingRef.current = null;
              if (shouldRestore) await restoreSecondaryClose(windowLabel);
              return;
            }
            if (staged !== "ready") {
              if (stagePendingRef.current === attempt) stagePendingRef.current = null;
              if (staged === "veto" && attempt === attemptRef.current
                && windowCloseDecisionAfterFlush({ allowWindowClose: false }) === "prompt") {
                raisePrompt(windowLabel, "dirty_after_state_save");
              }
              return;
            }
          }
          setLatch({ kind: "clean-save" });
          void Promise.resolve(currentWindow.close()).catch(async () => {
            if (attempt !== attemptRef.current) return;
            setLatch(null);
            if (stagePendingRef.current === attempt) stagePendingRef.current = null;
            if (windowLabel !== "main") await restoreSecondaryClose(windowLabel);
            logCloseRequested("fail", { windowLabel, action: "close_rejected" });
          });
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
    const windowLabel = appWindowRef.current?.label;
    if (windowLabel && windowLabel !== "main") {
      stagePendingRef.current = attempt;
      const staged = await stageSecondaryClose(
        windowLabel,
        () => attempt === attemptRef.current,
        () => decideLatchedPass({ kind: "discard", consent }) === "allow",
        () => pendingCloseRef.current === "window" || stagePendingRef.current === null,
      );
      if (attempt !== attemptRef.current && staged === "ready") {
        const shouldRestore = stagePendingRef.current === attempt || pendingCloseRef.current === "window";
        if (stagePendingRef.current === attempt) stagePendingRef.current = null;
        if (shouldRestore) await restoreSecondaryClose(windowLabel);
        return;
      }
      if (staged !== "ready") {
        if (stagePendingRef.current === attempt) stagePendingRef.current = null;
        if (staged === "veto" && attempt === attemptRef.current) raisePrompt(windowLabel, "dirty_after_discard");
        return;
      }
    }
    latchRef.current = { kind: "discard", consent };
    try { await appWindowRef.current?.close(); }
    catch {
      if (attempt !== attemptRef.current) return;
      setLatch(null);
      if (stagePendingRef.current === attempt) stagePendingRef.current = null;
      if (windowLabel && windowLabel !== "main") await restoreSecondaryClose(windowLabel);
      logCloseRequested("fail", { windowLabel: windowLabel ?? "unknown", action: "close_rejected" });
    }
  }, [saveWindowState, setPendingClose]);

  const cancelClose = useCallback(() => {
    const wasWindowPrompt = pendingCloseRef.current === "window";
    // Supersede any attempt in flight. The latch is left alone: a latched pass
    // re-decides (clean-save) or checks its consent (discard) anyway.
    attemptRef.current += 1;
    if (stagePendingRef.current !== null) {
      stagePendingRef.current = null;
      const label = appWindowRef.current?.label;
      if (label && label !== "main") void restoreSecondaryClose(label);
    }
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
