/**
 * Purpose: the webview half of the D16 app-quit guard (ADR-0025). Rust is
 * holding the macOS `applicationShouldTerminate:` reply open while it asks this
 * window two questions; this hook answers both and owns the prompt state the
 * ConfirmDialog renders from.
 *
 * Pipeline: `app:quit-requested` → `assessWindowUnsaved` (the ONE shared exit
 * rule) → reply `clean` | `dirty` · `app:quit-prompt` → still dirty? raise
 * `quitPrompt` for App's dialog : reply `clean` · the user's answer →
 * `discard` (with the dirty ids) | `cancel` · `app:quit-cancelled` → drop the
 * prompt, answer nothing.
 *
 * Key decisions:
 * - **Answer phase 1 synchronously, from the store.** No dialog, no awaits
 *   before the reply is dispatched. A window that has not acknowledged within
 *   the ack deadline is treated as timed out (ADR-0027 draws a native alert),
 *   so a slow path here silently derails the user's quit.
 * - **The same decision the close path uses.** `assessWindowUnsaved` +
 *   `decideWindowExit` + `quitAnswerFor` come from `dataLossGuards`, which
 *   ADR-0025 requires the quit and window-close paths to share. A second
 *   dirty-check here could quit over a tab ⌘W would have prompted for.
 * - **The ids are read at confirm time, after a flush**, not at prompt time. A
 *   document dirtied while the dialog was up would otherwise keep its draft and
 *   resurrect the content the user just discarded.
 * - **At most one phase-2 reply per request, from this window.**
 *   `answeredRequestRef` latches the request this window has answered; a repeat
 *   `app:quit-prompt` for it is ignored rather than reopening the dialog. The
 *   latch is per-window and can say nothing about any other window — what keeps
 *   one window's prompt out of the others is the per-webview subscription below,
 *   not this ref.
 * - **Ack the dialog as soon as it is raised.** `delivered` reports that the
 *   prompt arrived and was drawn (ADR-0029 §1); it ends the only part of phase 2
 *   a deadline bounds. It is sent when a dialog actually goes up — never on the
 *   `clean` fast path, and never for a request this window has already answered.
 * - **Subscribe per webview, exactly once, with a `cancelled` flag** (the WI-6
 *   pattern). The global `listen` hears events addressed to *any* window, so one
 *   prompt raised a dialog in every window and each of them replied;
 *   `getCurrentWebviewWindow().listen` hears only this window's events and the
 *   broadcasts. `listen` resolves after two awaits; a teardown that beats it used
 *   to leave the handler registered, and two live handlers double-reply.
 * - **Logs carry the answer, a count and the request id — never content.**
 *
 * @module src/hooks/useQuitGuard
 * @coordinates-with src-tauri/src/services/quit_guard/events.rs — the event names
 * @coordinates-with src/services/quitGuardService.ts — the `quit_guard_reply` IPC
 * @coordinates-with src/utils/dataLossGuards.ts — the shared exit decision
 * @coordinates-with src/utils/quitDialogModel.ts — how App.tsx renders the prompt
 * @coordinates-with src/App.tsx — wires confirm/cancel to the ConfirmDialog
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import { quitGuardService, type QuitReplyAnswer } from "../services/quitGuardService";
import {
  assessWindowUnsaved,
  decideWindowExit,
  quitAnswerFor,
} from "../utils/dataLossGuards";
import type { QuitDialogPrompt } from "../utils/quitDialogModel";

/** The three events `services/quit_guard/events.rs` emits. */
export const QUIT_REQUESTED_EVENT = "app:quit-requested";
export const QUIT_PROMPT_EVENT = "app:quit-prompt";
export const QUIT_CANCELLED_EVENT = "app:quit-cancelled";

export interface QuitGuard {
  /** The phase-2 prompt this window is showing, or `null`. */
  quitPrompt: QuitDialogPrompt | null;
  /** The user chose Discard: reply `discard` with the ids dirty at this instant. */
  confirmQuit: () => void;
  /** The user chose Keep editing: reply `cancel`, which aborts the whole quit. */
  cancelQuit: () => void;
}

/** The `requestId` of a quit event payload, or `null` if it is not one. */
function requestIdOf(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { requestId?: unknown }).requestId;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function useQuitGuard(): QuitGuard {
  const [quitPrompt, setQuitPrompt] = useState<QuitDialogPrompt | null>(null);
  // The listeners are installed once and never re-subscribed, so they read the
  // prompt through a ref rather than a render closure (rule 50 §1).
  const quitPromptRef = useRef<QuitDialogPrompt | null>(null);
  // The request whose phase 2 this window has already answered.
  const answeredRequestRef = useRef<number | null>(null);

  const setPrompt = useCallback((next: QuitDialogPrompt | null) => {
    quitPromptRef.current = next;
    setQuitPrompt(next);
  }, []);

  /**
   * Dispatch one reply. Deliberately fire-and-forget: the coordinator is timing
   * this window, and awaiting inside an event handler buys nothing. A rejection
   * is already logged by `quitGuardService` (`app.quit.reply`, status `fail`);
   * swallowing it here is what keeps it from becoming an unhandled rejection.
   */
  const sendReply = useCallback(
    (requestId: number, answer: QuitReplyAnswer, documentIds?: string[]) => {
      void quitGuardService.reply(requestId, answer, documentIds).catch(() => {});
    },
    [],
  );

  /** Flush, read the store, log, and return this window's answer plus the ids. */
  const assess = useCallback((requestId: number, phase: "check" | "prompt") => {
    const assessment = assessWindowUnsaved("app-quit");
    const answer = quitAnswerFor(decideWindowExit(assessment, { allowLatched: false }));
    loggingService.logEventSync({
      level: "info",
      event: "app.quit.check",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        requestId,
        phase,
        answer,
        dirtyCount: assessment.dirtyDocuments.length,
        flushFailed: assessment.flushFailed,
      },
    });
    return { answer, documentIds: assessment.dirtyDocuments.map((doc) => doc.id) };
  }, []);

  const handleRequested = useCallback(
    (requestId: number) => {
      sendReply(requestId, assess(requestId, "check").answer);
    },
    [assess, sendReply],
  );

  const handlePrompt = useCallback(
    (requestId: number) => {
      // Already answered: a repeat prompt is the coordinator retrying, not a new
      // question. Replying twice is what the coordinator logs as out of phase.
      if (answeredRequestRef.current === requestId) return;

      const { answer } = assess(requestId, "prompt");
      if (answer === "clean") {
        // Saved between the two phases: no dialog, just let the quit through.
        answeredRequestRef.current = requestId;
        setPrompt(null);
        sendReply(requestId, "clean");
        return;
      }
      setPrompt({ requestId });
      // The dialog exists now, so say so at once (ADR-0029 §1). This is what
      // stops the coordinator's delivery deadline from being applied to the
      // person reading it — and it is sent only here, because only here was a
      // dialog actually raised.
      sendReply(requestId, "delivered");
    },
    [assess, sendReply, setPrompt],
  );

  const handleCancelled = useCallback(
    (requestId: number) => {
      // Another window cancelled, or the ack timed out. Only the prompt this
      // window is actually showing may be closed — a stale id must not.
      if (quitPromptRef.current?.requestId !== requestId) return;
      setPrompt(null);
    },
    [setPrompt],
  );

  const confirmQuit = useCallback(() => {
    const pending = quitPromptRef.current;
    if (!pending) return;
    const { requestId } = pending;
    setPrompt(null);
    answeredRequestRef.current = requestId;

    // Read the dirty ids NOW, after a flush: they are the delete list for the
    // drafts, and a document dirtied while the dialog was up belongs on it.
    const { documentIds } = assess(requestId, "prompt");
    loggingService.logDialogAction("dialog.quit.confirm", "success", {
      target: "quit",
      requestId,
      documentIdCount: documentIds.length,
    });
    sendReply(requestId, "discard", documentIds);
  }, [assess, sendReply, setPrompt]);

  const cancelQuit = useCallback(() => {
    const pending = quitPromptRef.current;
    if (!pending) return;
    const { requestId } = pending;
    setPrompt(null);
    answeredRequestRef.current = requestId;
    loggingService.logDialogAction("dialog.quit.cancel", "cancel", {
      target: "quit",
      requestId,
    });
    sendReply(requestId, "cancel");
  }, [sendReply, setPrompt]);

  useEffect(() => {
    // `listen` resolves after an await, so a teardown can beat it. The flag is
    // what makes the late resolution unlisten itself instead of leaking a
    // second handler that would double-reply.
    let cancelled = false;
    const disposers: UnlistenFn[] = [];

    const subscribe = async (name: string, handler: (requestId: number) => void) => {
      // Per webview, not global: an `emit_to` one window is meant for that
      // window alone, and the global `listen` would deliver it to all of them.
      const dispose = await getCurrentWebviewWindow().listen(name, (event) => {
        const requestId = requestIdOf(event.payload);
        if (requestId === null) {
          loggingService.logEventSync({
            level: "warn",
            event: "app.quit.check",
            status: "fail",
            actionId: loggingService.generateActionId(),
            context: { eventName: name },
            error: "quit event payload had no numeric requestId",
          });
          return;
        }
        handler(requestId);
      });
      if (cancelled) {
        dispose();
        return;
      }
      disposers.push(dispose);
    };

    void (async () => {
      try {
        await Promise.all([
          subscribe(QUIT_REQUESTED_EVENT, handleRequested),
          subscribe(QUIT_PROMPT_EVENT, handlePrompt),
          subscribe(QUIT_CANCELLED_EVENT, handleCancelled),
        ]);
      } catch {
        // Not running under Tauri (web preview): there is no quit to guard.
      }
    })();

    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    };
  }, [handleCancelled, handlePrompt, handleRequested]);

  return { quitPrompt, confirmQuit, cancelQuit };
}
