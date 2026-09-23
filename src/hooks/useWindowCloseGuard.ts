/**
 * Purpose: own the OS window-close guard for one mdpro window — the
 * `onCloseRequested` subscription, the window-state / per-file geometry save,
 * and the confirm latch. Extracted from App.tsx (D16 WI-6), where the same
 * effect leaked close handlers on every edit.
 *
 * Pipeline: OS close request → `windowCloseDecisionAfterFlush` (the ONE shared
 * exit rule, ADR-0025) → `allow` passes through and spends the latch | `prompt`
 * prevents the close and raises `pendingClose` for App's ConfirmDialog |
 * `save-and-close` persists window state, latches and closes.
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
 *   entry rule 20 requires, replacing a bare `catch {}`. WI-1 is what makes
 *   this path reachable at all — before it, `save_window_state` swallowed a
 *   load failure and returned `Ok`.
 *
 * @module src/hooks/useWindowCloseGuard
 * @coordinates-with src/App.tsx — renders the ConfirmDialog for `pendingClose`
 *   and routes its confirm/cancel back to `confirmClose` / `cancelClose`
 * @coordinates-with src/utils/dataLossGuards.ts — `windowCloseDecisionAfterFlush`
 * @coordinates-with src/services/windowService.ts — per-file geometry
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import { preferencesService } from "../services/preferencesService";
import { useDocumentStore } from "../stores/documentStore";
import { windowCloseDecisionAfterFlush } from "../utils/dataLossGuards";
import { physicalToLogical } from "../utils/windowGeometry";

/** `"window"` while the unsaved-changes dialog for an OS close request is open. */
export type WindowClosePending = "window" | null;

export interface WindowCloseGuard {
  /** `"window"` when the guard is waiting on the user's confirm dialog answer. */
  pendingClose: WindowClosePending;
  /** Persist window state + the active document's geometry, read at call time. */
  saveWindowState: () => Promise<void>;
  /** The user chose Discard: save state, latch the allow, close the window. */
  confirmClose: () => Promise<void>;
  /** The user chose Cancel: drop the prompt, leave the window open. */
  cancelClose: () => void;
}

export function useWindowCloseGuard(): WindowCloseGuard {
  const [pendingClose, setPendingClose] = useState<WindowClosePending>(null);
  const allowWindowCloseRef = useRef(false);
  const appWindowRef = useRef<{ close: () => void } | null>(null);

  const saveWindowState = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      // `scaleFactor()` is awaited FIRST, before either write. A rejection here
      // must leave both records untouched rather than land a physical one with
      // no matching geometry — a worse state than doing nothing (WI3-D).
      const scaleFactor = await currentWindow.scaleFactor();
      const size = await currentWindow.innerSize();
      const position = await currentWindow.outerPosition();
      const isMaximized = await currentWindow.isMaximized();
      // Physical pixels in, logical points out — see the header's D-c note.
      // One conversion, both payloads.
      const logical = physicalToLogical(
        { x: position.x, y: position.y, width: size.width, height: size.height },
        scaleFactor,
      );
      await preferencesService.saveWindowState({
        width: logical.width,
        height: logical.height,
        x: logical.x,
        y: logical.y,
        isMaximized,
      });

      // Read the active document NOW, not from a render closure: this hook
      // subscribes once, so a captured value would be whatever was open when the
      // listener was installed (WI-6 Rev 1).
      const activeDocument = useDocumentStore.getState().getActiveDocument();
      if (activeDocument?.path) {
        const { windowService } = await import("../services/windowService");
        await windowService.saveWindowGeometry(activeDocument.path, {
          x: logical.x,
          y: logical.y,
          width: logical.width,
          height: logical.height,
        });
      }
    } catch (error) {
      // Never rethrow: this runs inside the `onCloseRequested` handler, and a
      // rejection here would take the close guard down with it. But it is no
      // longer swallowed — WI-1 made `save_window_state` able to fail for a
      // real reason (a corrupt config.json), and a silent loss of the user's
      // window position is exactly what rule 20 exists to make visible.
      loggingService.logEventSync({
        level: "error",
        event: "window.save_state",
        status: "fail",
        actionId: loggingService.generateActionId(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

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
          // D15/D16: flush pending WYSIWYG edits, then decide on the fresh
          // any-tab-modified state through the one shared exit rule.
          const decision = windowCloseDecisionAfterFlush({
            allowWindowClose: allowWindowCloseRef.current,
          });
          loggingService.logEventSync({
            level: "info",
            event: "window.close_requested",
            status: "start",
            actionId: loggingService.generateActionId(),
            context: { windowLabel, decision, allowWindowClose: allowWindowCloseRef.current },
          });

          if (decision === "allow") {
            // State already saved by confirmClose; allow the close through.
            allowWindowCloseRef.current = false;
            loggingService.logEventSync({
              level: "info",
              event: "window.close_requested",
              status: "success",
              actionId: loggingService.generateActionId(),
              context: { windowLabel, action: "allowed_close" },
            });
            return;
          }
          // Prevent close in all other cases until we finish async work.
          event.preventDefault();
          if (decision === "prompt") {
            setPendingClose("window");
            loggingService.logEventSync({
              level: "info",
              event: "window.close_requested",
              status: "cancel",
              actionId: loggingService.generateActionId(),
              context: { windowLabel, action: "prevented_showing_dialog" },
            });
          } else {
            // No unsaved changes — save state then allow close.
            await saveWindowState();
            allowWindowCloseRef.current = true;
            void currentWindow.close();
            loggingService.logEventSync({
              level: "info",
              event: "window.close_requested",
              status: "success",
              actionId: loggingService.generateActionId(),
              context: { windowLabel, action: "no_unsaved_closing" },
            });
          }
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
  }, [saveWindowState]);

  const confirmClose = useCallback(async () => {
    setPendingClose(null);
    await saveWindowState();
    allowWindowCloseRef.current = true;
    appWindowRef.current?.close();
  }, [saveWindowState]);

  const cancelClose = useCallback(() => {
    setPendingClose(null);
  }, []);

  return { pendingClose, saveWindowState, confirmClose, cancelClose };
}
