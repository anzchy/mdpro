/**
 * Purpose: the store-reading and logging halves of `useQuitGuard`'s handlers,
 * extracted so the hook keeps only its React state and subscriptions (rule 50
 * §6). Four things live here: parsing a quit event's `{requestId, round}`, the
 * assessment behind every `clean` / `dirty` answer (with the ADR-0035 A3 discard
 * snapshot), the ADR-0035 backstop run that ends in a `drafted` reply, and the
 * hook's two failure log lines.
 *
 * Pipeline: event payload → `quitEventOf` → `{requestId, round?}` ·
 *   `assessQuitAnswer` = `assessWindowUnsaved` (flush, THEN read) →
 *   `unsavedSinceDiscard` against the snapshot → answer + `app.quit.check` log ·
 *   `runQuitBackstop` = `writeQuitBackstopDraftsWithIds` (awaits every
 *   `save_draft`) → `app.quit.backstop` log → the caller's `drafted` reply, with
 *   the counts and the undiscarded ids.
 *
 * Key decisions:
 * - **A round is echoed only when it is a non-negative integer** (ADR-0035 A5).
 *   Anything else — absent, negative, fractional, a string — is treated as no
 *   round, and the reply carries no `round` key (Rust keeps the pre-round rule).
 * - **The snapshot is compared against the store read after the flush.** The
 *   documents are read right after `assessWindowUnsaved` returns, synchronously,
 *   so both halves of the comparison see the same post-flush store. With no
 *   snapshot (or one for another request) the answer reduces to the shared exit
 *   rule of `dataLossGuards`: dirty iff the flush failed or anything is modified.
 * - **The `drafted` reply goes out only after the writer resolved**, which is
 *   only after every write settled — Rust closes the draft gate on that reply.
 * - **A round-less event never lowers a round mark** for its request (review
 *   L-4); another request always replaces it.
 * - **Counts only.** `app.quit.check` carries `{requestId, phase, answer,
 *   dirtyCount, flushFailed, discardedUnchangedCount}`; `app.quit.backstop`
 *   carries `{requestId, round, draftedCount, failedCount, flushFailed}`. A
 *   failed write logs one fixed string, never the IPC error (it can quote a path
 *   or an id). The backstop's undiscarded ids (review M-1) go to the `drafted`
 *   reply only, never to a log.
 * - **Two more counts-only lines for the hook** (review L-2, L-5): a malformed
 *   payload logs under its own subscription's event, and a lost reply logs
 *   `app.quit.send` with `{requestId, round, answer}` and a fixed error.
 *
 * @module src/utils/quitGuardHandlers
 * @coordinates-with src/hooks/useQuitGuard.ts — the only caller
 * @coordinates-with src/utils/dataLossGuards.ts — `assessWindowUnsaved`, `quitAnswerFor`
 * @coordinates-with src/utils/quitDiscardSnapshot.ts — `unsavedSinceDiscard`
 * @coordinates-with src/utils/quitDraftBackstop.ts — `writeQuitBackstopDraftsWithIds`
 */
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { assessWindowUnsaved, quitAnswerFor } from "./dataLossGuards";
import { unsavedSinceDiscard, type DiscardSnapshot } from "./quitDiscardSnapshot";
import { writeQuitBackstopDraftsWithIds, type QuitBackstopResult } from "./quitDraftBackstop";

/** The one error string an `app.quit.backstop` fail line may carry. */
export const QUIT_BACKSTOP_WRITE_FAILED = "backstop write failed";

/** A parsed quit event: its request and, when valid, its round. */
export interface QuitEvent {
  requestId: number;
  round?: number;
}

/** The `{requestId, round?}` of a quit event payload, or `null` if it is not one. */
export function quitEventOf(payload: unknown): QuitEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { requestId, round } = payload as { requestId?: unknown; round?: unknown };
  if (typeof requestId !== "number" || !Number.isFinite(requestId)) return null;
  const valid = typeof round === "number" && Number.isInteger(round) && round >= 0;
  return valid ? { requestId, round } : { requestId };
}

/** Same request and same round (an absent round matches only an absent round). */
export function sameRound(a: QuitEvent | null, b: QuitEvent): boolean {
  return a !== null && a.requestId === b.requestId && a.round === b.round;
}

/** `event` is for the request `highest` belongs to, but from an earlier round. */
export function isStaleRound(highest: QuitEvent | null, event: QuitEvent): boolean {
  if (highest === null || highest.requestId !== event.requestId) return false;
  if (highest.round === undefined || event.round === undefined) return false;
  return event.round < highest.round;
}

/**
 * The highest round seen, after `event`. A round-less event for the same request
 * never replaces a mark that has a round (review L-4): it would reset the mark
 * and let an earlier round's event back in.
 */
export function raiseRound(highest: QuitEvent | null, event: QuitEvent): QuitEvent {
  if (highest === null || highest.requestId !== event.requestId) return event;
  if (highest.round !== undefined && event.round === undefined) return highest;
  return isStaleRound(highest, event) ? highest : event;
}

/** The one error string an `app.quit.send` line carries (review L-5). */
export const QUIT_REPLY_NOT_DELIVERED = "quit reply was not delivered";

/**
 * A quit event arrived with no numeric `requestId`. Logged under `logEvent`, the
 * log name of the subscription it arrived on (review L-2), with the wire event
 * name only — the payload itself is never logged.
 */
export function logMalformedQuitEvent(logEvent: string, eventName: string): void {
  loggingService.logEventSync({
    level: "warn",
    event: logEvent,
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { eventName },
    error: "quit event payload had no numeric requestId",
  });
}

/**
 * A reply's IPC rejected (review L-5). `quitGuardService` has already logged the
 * scrubbed error as `app.quit.reply`; this line records, from the hook's side,
 * which request, round and answer went unanswered. A fixed error, never ids.
 */
export function logQuitReplyLost(event: QuitEvent, answer: string): void {
  loggingService.logEventSync({
    level: "warn",
    event: "app.quit.send",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { requestId: event.requestId, round: event.round ?? null, answer },
    error: QUIT_REPLY_NOT_DELIVERED,
  });
}

/**
 * Flush, read the store, decide `clean` / `dirty` against the discard snapshot,
 * and log. `documentIds` is every modified document — the delete list a Discard
 * sends — whether or not the snapshot already covers it.
 */
export function assessQuitAnswer(
  requestId: number,
  phase: "check" | "prompt",
  snapshot: DiscardSnapshot | null,
) {
  const assessment = assessWindowUnsaved("app-quit");
  const verdict = unsavedSinceDiscard(
    assessment,
    useDocumentStore.getState().documents,
    snapshot,
    requestId,
  );
  const answer = quitAnswerFor(verdict.dirty ? "prompt" : "proceed");
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
      discardedUnchangedCount: verdict.discardedUnchangedCount,
    },
  });
  return { answer, documentIds: assessment.dirtyDocuments.map((doc) => doc.id) };
}

/**
 * Draft every dirty document (minus the discarded-and-unchanged ones), log the
 * counts, then hand `reply` the counts and the ids whose discard the redraft
 * cancels (review M-1). Resolves after the reply was dispatched.
 */
export async function runQuitBackstop(
  event: QuitEvent,
  snapshot: DiscardSnapshot | null,
  reply: (counts: QuitBackstopResult, undiscardedIds: string[]) => void,
): Promise<void> {
  const { counts, undiscardedIds } = await writeQuitBackstopDraftsWithIds({
    snapshot,
    requestId: event.requestId,
  });
  const failed = counts.failedCount > 0;
  loggingService.logEventSync({
    level: failed ? "warn" : "info",
    event: "app.quit.backstop",
    status: failed ? "fail" : "success",
    actionId: loggingService.generateActionId(),
    context: {
      requestId: event.requestId,
      round: event.round ?? null,
      draftedCount: counts.draftedCount,
      failedCount: counts.failedCount,
      flushFailed: counts.flushFailed,
    },
    ...(failed ? { error: QUIT_BACKSTOP_WRITE_FAILED } : {}),
  });
  reply(counts, undiscardedIds);
}
