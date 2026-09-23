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
      const size = await currentWindow.innerSize();
      const position = await currentWindow.outerPosition();
      const isMaximized = await currentWindow.isMaximized();
      await preferencesService.saveWindowState({
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        isMaximized,
      });

      // Read the active document NOW, not from a render closure: this hook
      // subscribes once, so a captured value would be whatever was open when the
      // listener was installed (WI-6 Rev 1).
      const activeDocument = useDocumentStore.getState().getActiveDocument();
      if (activeDocument?.path) {
        const { windowService } = await import("../services/windowService");
        await windowService.saveWindowGeometry(activeDocument.path, {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
        });
      }
    } catch {
      // Ignore persistence errors in web preview.
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
