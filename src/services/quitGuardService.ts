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
 * - **`documentIds` only on `discard`.** Rust rejects ids on any other answer,
 *   including `Some([])`, because ids are the delete list for the drafts of
 *   discarded work — the last copy of it.
 * - **Errors are narrowed, never cast.** `invoke` rejects with whatever Rust
 *   returned, frequently a bare string, so an `error as Error` would hand the
 *   caller an object with no `.message`. Rule 50's
 *   `error instanceof Error ? error.message : String(error)` is used instead, and
 *   the caller always sees a real `Error`.
 * - A failed reply is logged (`app.quit.reply`, status `fail`) with the request id,
 *   the answer and a COUNT of ids — never a document's content.
 *
 * @coordinates-with src-tauri/src/commands/quit_guard.rs — `quit_guard_reply`
 * @coordinates-with src/utils/dataLossGuards.ts — supplies the answer and the ids
 * @coordinates-with src/hooks/useQuitGuard.ts — the only caller (D16 WI-7)
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
 */
export type QuitReplyAnswer = "clean" | "dirty" | "discard" | "cancel" | "delivered";

export const quitGuardService = {
  /**
   * Answer one quit request. `documentIds` is sent only with `discard`, and names
   * the dirty documents whose drafts Rust may delete when it commits the quit.
   *
   * @throws {Error} when the command rejects — always an `Error`, whatever Rust threw.
   */
  async reply(
    requestId: number,
    answer: QuitReplyAnswer,
    documentIds?: string[],
  ): Promise<void> {
    const args: Record<string, unknown> = { requestId, answer };
    if (answer === "discard" && documentIds) args.documentIds = documentIds;

    try {
      await invoke("quit_guard_reply", args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loggingService.logEventSync({
        level: "error",
        event: "app.quit.reply",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: {
          requestId,
          answer,
          documentIdCount: Array.isArray(args.documentIds) ? args.documentIds.length : 0,
        },
        error: message,
      });
      throw new Error(`quit_guard_reply failed: ${message}`);
    }
  },
};
