/**
 * Purpose: the webview half of the D16 app-quit guard (ADR-0025, ADR-0035). Rust
 * is holding the macOS `applicationShouldTerminate:` reply open while it asks
 * this window whether it is dirty — once, and again just before it commits —
 * then has it prompt, then has it draft; this hook answers all of it and owns
 * the prompt state the ConfirmDialog renders from.
 *
 * Pipeline: `app:quit-requested{requestId, round}` (phase 1 and every re-check)
 * → `assessQuitAnswer` (flush, read, the A3 discard snapshot) → reply `clean` |
 * `dirty` · `app:quit-prompt` → still dirty? raise `quitPrompt` + ack `delivered`
 * : reply `clean` · the user's answer → `discard` (with the dirty ids; the
 * snapshot is taken here) | `cancel` · `app:quit-backstop` → draft every dirty
 * document → reply `drafted` with the counts, plus (as `documentIds`) any
 * discarded document it redrafted after an edit (review M-1), so Rust keeps that
 * draft instead of deleting it with the discard · `app:quit-cancelled` → drop the
 * prompt, answer nothing. Every reply echoes its event's round.
 *
 * Key decisions:
 * - **Answer phase 1 synchronously, from the store.** No dialog, no awaits
 *   before the reply is dispatched; a slow path here derails the quit into the
 *   ADR-0027 alert.
 * - **The same decision the close path uses** (`dataLossGuards`, via
 *   `assessQuitAnswer`), narrowed only by the discard snapshot: a document the
 *   user discarded for this request and has not touched since does not make the
 *   re-check dirty again (ADR-0035 A3). Any other modified doc, an edit to a
 *   discarded one, or a failed flush does.
 * - **The ids and the snapshot are read at confirm time, after a flush.** A
 *   document dirtied while the dialog was up belongs on the delete list, and the
 *   snapshot must hold what the flush wrote or the re-check would prompt twice.
 * - **Latch on `(requestId, round)`** (ADR-0035 A5). Per round, one answer to
 *   `app:quit-requested` and one phase-2 answer; a repeat prompt for an answered
 *   round is ignored (T15), while the re-prompt of a later round raises the
 *   dialog again. An event from a round below the highest seen for its request
 *   is stale and ignored. The latch is per-window — what keeps one window's
 *   prompt out of the others is the per-webview subscription, not this ref.
 *   The raised dialog is held as its event, one ref, and `quitPrompt` derives
 *   from it, so a `discard` / `cancel` always echoes the round it was asked in.
 * - **Ack the dialog as soon as it is raised.** `delivered` (ADR-0029 §1) is sent
 *   only when a dialog actually goes up, never on the `clean` fast path.
 * - **The backstop runs at most once per request, and `drafted` waits for every
 *   write** (ADR-0035 WI-8). The latch is set before the first await, so a
 *   duplicate event arriving mid-write is a no-op.
 * - **Subscribe per webview, exactly once, with a `cancelled` flag** (the WI-6
 *   pattern), to four events. A teardown that beats `listen` unlistens the late
 *   registration instead of leaking a second handler that would double-reply.
 * - **A failed subscription is logged, not swallowed.** Under Tauri any
 *   rejection writes one `app.quit.listen` fail with `{subscribedCount,
 *   failedCount}` over the four subscriptions, even after unmount.
 * - **Logs carry answers, counts, flags, phase and the request id — never ids,
 *   paths or content.** A malformed payload logs under its own subscription's
 *   event (`app.quit.check` / `.prompt` / `.cancel` / `.backstop`); a lost reply
 *   logs `app.quit.send` (review L-2, L-5).
 *
 * @module src/hooks/useQuitGuard
 * @coordinates-with src-tauri/src/services/quit_guard/events.rs — the event names
 * @coordinates-with src/services/quitGuardService.ts — the `quit_guard_reply` IPC
 * @coordinates-with src/utils/quitGuardHandlers.ts — payload parsing, the answer, the backstop
 * @coordinates-with src/utils/quitDiscardSnapshot.ts — the A3 discard snapshot
 * @coordinates-with src/utils/quitDialogModel.ts — how App.tsx renders the prompt
 * @coordinates-with src/App.tsx — wires confirm/cancel to the ConfirmDialog
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import {
  quitGuardService,
  type QuitReplyAnswer,
  type QuitReplyExtras,
} from "../services/quitGuardService";
import { useDocumentStore } from "../stores/documentStore";
import type { QuitDialogPrompt } from "../utils/quitDialogModel";
import { takeDiscardSnapshot, type DiscardSnapshot } from "../utils/quitDiscardSnapshot";
import {
  assessQuitAnswer,
  isStaleRound,
  logMalformedQuitEvent,
  logQuitReplyLost,
  quitEventOf,
  raiseRound,
  runQuitBackstop,
  sameRound,
  type QuitEvent,
} from "../utils/quitGuardHandlers";

export { QUIT_BACKSTOP_WRITE_FAILED } from "../utils/quitGuardHandlers";

/** The four events `services/quit_guard/events.rs` emits. */
export const QUIT_REQUESTED_EVENT = "app:quit-requested";
export const QUIT_PROMPT_EVENT = "app:quit-prompt";
export const QUIT_CANCELLED_EVENT = "app:quit-cancelled";
export const QUIT_BACKSTOP_EVENT = "app:quit-backstop";

export interface QuitGuard {
  /** The phase-2 prompt this window is showing, or `null`. */
  quitPrompt: QuitDialogPrompt | null;
  /** The user chose Discard: reply `discard` with the ids dirty at this instant. */
  confirmQuit: () => void;
  /** The user chose Keep editing: reply `cancel`, which aborts the whole quit. */
  cancelQuit: () => void;
}

export function useQuitGuard(): QuitGuard {
  const [quitPrompt, setQuitPrompt] = useState<QuitDialogPrompt | null>(null);
  // The event (request + round) behind the dialog that is up — the one source
  // the prompt state derives from. The listeners are installed once and never
  // re-subscribed, so they read it through a ref, not a render closure (rule 50 §1).
  const promptEventRef = useRef<QuitEvent | null>(null);
  // The highest round seen for the current request; earlier rounds are stale.
  const highestRef = useRef<QuitEvent | null>(null);
  // The round whose `app:quit-requested` / phase 2 this window has answered.
  const checkedRef = useRef<QuitEvent | null>(null);
  const answeredRef = useRef<QuitEvent | null>(null);
  // What this window discarded, keyed to its request (ADR-0035 A3).
  const snapshotRef = useRef<DiscardSnapshot | null>(null);
  // The request whose backstop this window has run.
  const backstoppedRef = useRef<number | null>(null);

  const setPrompt = useCallback((next: QuitEvent | null) => {
    promptEventRef.current = next;
    setQuitPrompt(next ? { requestId: next.requestId } : null);
  }, []);

  /**
   * Dispatch one reply, echoing the round. Fire-and-forget: `quitGuardService`
   * logs the scrubbed error (`app.quit.reply`); the catch adds the counts-only
   * `app.quit.send` line and keeps it from being an unhandled rejection.
   */
  const sendReply = useCallback(
    (event: QuitEvent, answer: QuitReplyAnswer, documentIds?: string[], extras?: QuitReplyExtras) => {
      const withRound = { ...extras, round: event.round };
      void quitGuardService
        .reply(event.requestId, answer, documentIds, withRound)
        .catch(() => logQuitReplyLost(event, answer));
    },
    [],
  );

  /** Record `event` as seen; false if it belongs to an earlier round. */
  const admit = useCallback((event: QuitEvent) => {
    if (isStaleRound(highestRef.current, event)) return false;
    highestRef.current = raiseRound(highestRef.current, event);
    return true;
  }, []);

  const handleRequested = useCallback(
    (event: QuitEvent) => {
      if (!admit(event) || sameRound(checkedRef.current, event)) return;
      checkedRef.current = event;
      const { answer } = assessQuitAnswer(event.requestId, "check", snapshotRef.current);
      sendReply(event, answer);
    },
    [admit, sendReply],
  );

  const handlePrompt = useCallback(
    (event: QuitEvent) => {
      // Already answered this round: a repeat prompt is the coordinator retrying,
      // not a new question. A later round's re-prompt is a new question.
      if (!admit(event) || sameRound(answeredRef.current, event)) return;

      const { answer } = assessQuitAnswer(event.requestId, "prompt", snapshotRef.current);
      if (answer === "clean") {
        // Saved between the two phases: no dialog, just let the quit through.
        answeredRef.current = event;
        setPrompt(null);
        sendReply(event, "clean");
        return;
      }
      setPrompt(event);
      // The dialog exists now, so say so at once (ADR-0029 §1) — only here,
      // because only here was a dialog actually raised.
      sendReply(event, "delivered");
    },
    [admit, sendReply, setPrompt],
  );

  const handleCancelled = useCallback(
    (event: QuitEvent) => {
      // Another window cancelled, or the ack timed out. Only the prompt this
      // window is actually showing may be closed — a stale id must not.
      if (promptEventRef.current?.requestId !== event.requestId) return;
      setPrompt(null);
    },
    [setPrompt],
  );

  const handleBackstop = useCallback(
    (event: QuitEvent) => {
      // Latched before the first await: a duplicate mid-write writes nothing.
      if (backstoppedRef.current === event.requestId) return;
      backstoppedRef.current = event.requestId;
      void runQuitBackstop(event, snapshotRef.current, ({ draftedCount, failedCount }, ids) =>
        sendReply(event, "drafted", undefined, { draftedCount, failedCount, undiscardedIds: ids }),
      );
    },
    [sendReply],
  );

  /** Close the dialog and latch its round; the event it answered, or null. */
  const takePrompt = useCallback((): QuitEvent | null => {
    const event = promptEventRef.current;
    if (!event) return null;
    setPrompt(null);
    answeredRef.current = event;
    return event;
  }, [setPrompt]);

  const confirmQuit = useCallback(() => {
    const event = takePrompt();
    if (!event) return;
    // Read the dirty ids NOW, after a flush: they are the delete list for the
    // drafts, and the snapshot of exactly what was discarded (A3).
    const { documentIds } = assessQuitAnswer(event.requestId, "prompt", snapshotRef.current);
    snapshotRef.current = takeDiscardSnapshot(
      event.requestId,
      useDocumentStore.getState().documents,
      documentIds,
    );
    loggingService.logDialogAction("dialog.quit.confirm", "success", {
      target: "quit",
      requestId: event.requestId,
      documentIdCount: documentIds.length,
    });
    sendReply(event, "discard", documentIds);
  }, [sendReply, takePrompt]);

  const cancelQuit = useCallback(() => {
    const event = takePrompt();
    if (!event) return;
    loggingService.logDialogAction("dialog.quit.cancel", "cancel", {
      target: "quit",
      requestId: event.requestId,
    });
    sendReply(event, "cancel");
  }, [sendReply, takePrompt]);

  useEffect(() => {
    // `listen` resolves after an await, so a teardown can beat it. The flag is
    // what makes the late resolution unlisten itself instead of leaking a
    // second handler that would double-reply.
    let cancelled = false;
    const disposers: UnlistenFn[] = [];

    const subscribe = async (name: string, logEvent: string, handler: (event: QuitEvent) => void) => {
      // Per webview, not global: an `emit_to` one window is meant for that
      // window alone, and the global `listen` would deliver it to all of them.
      const dispose = await getCurrentWebviewWindow().listen(name, (message) => {
        const event = quitEventOf(message.payload);
        if (event === null) {
          logMalformedQuitEvent(logEvent, name);
          return;
        }
        handler(event);
      });
      if (cancelled) {
        dispose();
        return;
      }
      disposers.push(dispose);
    };

    void (async () => {
      // allSettled, not all: a partial subscription keeps its live handlers and
      // is counted. The log is not gated on `cancelled` — a failure that settles
      // after unmount is still a failure, logged once per mount.
      const results = await Promise.allSettled([
        subscribe(QUIT_REQUESTED_EVENT, "app.quit.check", handleRequested),
        subscribe(QUIT_PROMPT_EVENT, "app.quit.prompt", handlePrompt),
        subscribe(QUIT_CANCELLED_EVENT, "app.quit.cancel", handleCancelled),
        subscribe(QUIT_BACKSTOP_EVENT, "app.quit.backstop", handleBackstop),
      ]);
      const failedCount = results.filter((r) => r.status === "rejected").length;
      // Outside Tauri (web preview) there is no quit to guard, so no failure.
      if (failedCount === 0 || !("__TAURI_INTERNALS__" in window)) return;
      loggingService.logEventSync({
        level: "error",
        event: "app.quit.listen",
        status: "fail",
        actionId: loggingService.generateActionId(),
        // Counts only: the rejection reasons are never logged.
        context: { subscribedCount: results.length - failedCount, failedCount },
      });
    })();

    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    };
  }, [handleBackstop, handleCancelled, handlePrompt, handleRequested]);

  return { quitPrompt, confirmQuit, cancelQuit };
}
