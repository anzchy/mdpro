/**
 * Purpose: the typed IPC wrapper for the D16 quit protocol (ADR-0025). One call,
 * `reply`, carries this window's answer to the Rust coordinator, which is holding
 * the macOS `applicationShouldTerminate:` reply open until every window answers.
 *
 * Key decisions:
 * - **No window label on the wire.** Rust takes the label from the calling
 *   `WebviewWindow`, so a label in the payload would be a spoofable input on a
 *   trust boundary (rule 60). Sending one would also silently diverge from the
 *   command signature.
 * - **`documentIds` on `discard`, and on `drafted` for its undiscarded ids.** On
 *   `discard` they are the delete list for the drafts of discarded work — the
 *   last copy of it. On `drafted` (ADR-0035 review M-1) they are the discarded
 *   documents this window redrafted after an edit, whose drafts Rust must keep;
 *   sent only with the counts and only when non-empty. Rust rejects ids on any
 *   other answer, including `Some([])`.
 * - **Counts only on `drafted`, and only as a pair** (ADR-0035). The backstop
 *   reports `draftedCount` and `failedCount` together; Rust requires both on
 *   `drafted` and refuses either on any other answer, so a lone count or a count
 *   on another answer is never sent. Rust owns the range check (the cap of 101).
 * - **`round` is sent only when it is a non-negative integer** (ADR-0035 A5). Rust
 *   ignores a reply whose round is not the request's current round; an absent
 *   round keeps the pre-round behaviour. A negative, fractional or NaN round is
 *   dropped rather than sent, since it would be a deserialize error for a `u32`.
 * - **Errors are narrowed, never cast.** `invoke` rejects with whatever Rust
 *   returned, frequently a bare string, so an `error as Error` would hand the
 *   caller an object with no `.message`. Rule 50's
 *   `error instanceof Error ? error.message : String(error)` is used instead, and
 *   the caller always sees a real `Error`.
 * - A failed reply is logged (`app.quit.reply`, status `fail`) with the request id,
 *   the answer, a COUNT of ids, and whatever counts and round were sent — never
 *   an id and never a document's content.
 *   Every id this call was given or sent — the discard list and the undiscarded
 *   ids alike — is scrubbed from the error text before it is logged or
 *   rethrown, whatever Rust or serde quoted back (D16F WI-3).
 *
 * @coordinates-with src-tauri/src/commands/quit_guard.rs — `quit_guard_reply`
 * @coordinates-with src/utils/dataLossGuards.ts — supplies the answer and the ids
 * @coordinates-with src/hooks/useQuitGuard.ts — the only caller (D16 WI-7);
 *   it also sends `drafted` after the ADR-0035 backstop writes its drafts
 */

import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "./loggingService";

/**
 * The answers in the quit protocol. Phase 1 answers `clean` or `dirty`; a
 * prompted window acks `delivered` the moment its dialog is up and then answers
 * `discard` or `cancel`. Rust deserializes this as a strict lowercase enum, so
 * an unknown string is a deserialize error there.
 *
 * `delivered` is not a decision (ADR-0029 §1): it reports that the dialog exists,
 * which is what ends the part of phase 2 a deadline may bound. Everything after
 * it is the user's time, and nothing bounds that.
 *
 * `drafted` (ADR-0035) answers the backstop: this window has written a draft of
 * every dirty document it holds, and reports how many writes succeeded and failed.
 */
export type QuitReplyAnswer = "clean" | "dirty" | "discard" | "cancel" | "delivered" | "drafted";

/** Optional reply fields: the backstop counts (with `drafted`) and the A5 round tag. */
export interface QuitReplyExtras {
  draftedCount?: number;
  failedCount?: number;
  round?: number;
  /**
   * With `drafted` only: the ids this window discarded for the request and then
   * redrafted after an edit (ADR-0035 review M-1). Sent as `documentIds` so Rust
   * keeps those drafts at the commit.
   */
  undiscardedIds?: string[];
}

/**
 * Remove every non-empty id in `ids` from `text`, longest first so an id that
 * contains another (`doc-12` / `doc-1`) is removed whole. Plain string
 * split/join, so ids with regex or `$&` characters are matched literally. It
 * repeats until no id is left, because a removal can splice a new occurrence
 * together (`ddoc-1oc-1`); each pass shortens the text, so it terminates. Ids
 * are deleted rather than replaced, since any placeholder could itself contain
 * a short id. Text with no id in it comes back unchanged.
 */
function scrubIds(text: string, ids: readonly string[]): string {
  const ordered = [...new Set(ids.filter((id) => id.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  while (ordered.some((id) => out.includes(id))) {
    out = ordered.reduce((acc, id) => acc.split(id).join(""), out);
  }
  return out;
}

export const quitGuardService = {
  /**
   * Answer one quit request. `documentIds` is sent only with `discard`, and names
   * the dirty documents whose drafts Rust may delete when it commits the quit.
   * `extras.draftedCount`/`failedCount` are sent only with `drafted` and only when
   * both are given, and then a non-empty `extras.undiscardedIds` goes as
   * `documentIds`; `extras.round` only when it is a non-negative integer.
   *
   * @throws {Error} when the command rejects — always an `Error`, whatever Rust threw.
   */
  async reply(
    requestId: number,
    answer: QuitReplyAnswer,
    documentIds?: string[],
    extras?: QuitReplyExtras,
  ): Promise<void> {
    const args: Record<string, unknown> = { requestId, answer };
    if (answer === "discard" && documentIds) args.documentIds = documentIds;
    const counts: Record<string, number> = {};
    const { draftedCount, failedCount, round, undiscardedIds } = extras ?? {};
    if (answer === "drafted" && draftedCount !== undefined && failedCount !== undefined) {
      Object.assign(counts, { draftedCount, failedCount });
      if (undiscardedIds && undiscardedIds.length > 0) args.documentIds = undiscardedIds;
    }
    if (round !== undefined && Number.isInteger(round) && round >= 0) counts.round = round;
    Object.assign(args, counts);

    try {
      await invoke("quit_guard_reply", args);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const sent = Array.isArray(args.documentIds) ? (args.documentIds as string[]) : [];
      const message = scrubIds(raw, [...(documentIds ?? []), ...sent]);
      loggingService.logEventSync({
        level: "error",
        event: "app.quit.reply",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: {
          requestId,
          answer,
          documentIdCount: Array.isArray(args.documentIds) ? args.documentIds.length : 0,
          ...counts,
        },
        error: message,
      });
      throw new Error(`quit_guard_reply failed: ${message}`);
    }
  },
};
