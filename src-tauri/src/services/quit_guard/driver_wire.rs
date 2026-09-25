//! Purpose: take one window's answer as it crosses the IPC boundary —
//! validate it, tag it with its round, hand it to the coordinator, and log the
//! ruling.
//!
//! Split out of `driver.rs` under rule 50 §6. `quit_guard_reply` calls
//! `handle_wire_reply`; `handle_reply` (untagged, no counts) and
//! `handle_drafted` (counts, untagged) are thin delegates to it, so there is one
//! validation path and one log shape for every answer.
//!
//! Key decisions:
//! - **Validate before the coordinator sees anything** (rule 60): ids go
//!   through `validate_discard_ids` — or, on `drafted`, `validate_undiscard_ids`
//!   (the redrafted discards, review M-1) — and counts through
//!   `validate_backstop_counts`.
//!   A refusal is logged as a `fail` answer and returned as `Err`; the state and
//!   the effects are untouched.
//! - **A `drafted` answer without its counts is refused**, never defaulted to
//!   zero: a count-less `drafted` would report a backstop that drafted nothing
//!   as a success.
//! - **The round is passed through, never checked here** (ADR-0035 A5). The
//!   coordinator refuses a reply tagged with another round as `staleRound`,
//!   which is inert and logged as a `fail`; `None` means "the current round".
//! - **Every `app.quit.answer` line carries `round`** (`null` when untagged),
//!   and a `drafted` line also carries `draftedCount` / `failedCount` as sent
//!   (`null` when missing). Counts only — never ids, labels from the payload,
//!   paths or content.
//!
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md
//! @coordinates-with src-tauri/src/commands/quit_guard.rs

use serde_json::json;

use super::{
    logging, validate_backstop_counts, validate_discard_ids, validate_undiscard_ids, Answer,
    QuitAnswer, QuitEffects, QuitGuard,
};

impl<E: QuitEffects> QuitGuard<E> {
    /// One window's answer from `quit_guard_reply`. `label` is the caller's own
    /// label, never a value from the payload: a window may not answer for
    /// another window. `round` is the round the window answers (A5); `None`
    /// answers the current round.
    #[allow(clippy::too_many_arguments)]
    pub fn handle_wire_reply(
        &self,
        label: &str,
        request_id: u64,
        answer: QuitAnswer,
        document_ids: Option<Vec<String>>,
        drafted_count: Option<u32>,
        failed_count: Option<u32>,
        round: Option<u32>,
        now_ms: u64,
    ) -> Result<(), String> {
        // Built before validation so a refusal still logs what came.
        let sent = document_ids.as_deref().unwrap_or_default();
        let mut context = logging::answer_log_context(label, answer, request_id, sent);
        if answer == QuitAnswer::Drafted {
            context["draftedCount"] = json!(drafted_count);
            context["failedCount"] = json!(failed_count);
        }
        context["round"] = json!(round);

        // A `drafted` reply's ids are the redrafted discards (review M-1); every
        // other answer's go through the discard rule, which refuses them off
        // `discard`.
        let ids = if answer == QuitAnswer::Drafted {
            validate_undiscard_ids(answer, document_ids)
        } else {
            validate_discard_ids(answer, document_ids)
        };
        let checked = ids.and_then(|ids| {
            let counts = if answer == QuitAnswer::Drafted
                || drafted_count.is_some()
                || failed_count.is_some()
            {
                Some(validate_backstop_counts(
                    answer,
                    drafted_count,
                    failed_count,
                )?)
            } else {
                None
            };
            Ok((ids, counts))
        });
        let (ids, counts) = match checked {
            Ok(checked) => checked,
            Err(err) => {
                // `err` names a field, an index or a limit — never an id or a
                // sent count (see `reply`).
                logging::log_answer(context, Some(err.clone()));
                return Err(err);
            }
        };

        let coordinator_answer = match (answer, counts) {
            (QuitAnswer::Clean, _) => Answer::Clean,
            (QuitAnswer::Dirty, _) => Answer::Dirty,
            (QuitAnswer::Discard, _) => Answer::Discard(ids),
            (QuitAnswer::Cancel, _) => Answer::Cancel,
            (QuitAnswer::Delivered, _) => Answer::Delivered,
            (QuitAnswer::Drafted, Some((drafted, failed))) if ids.is_empty() => {
                Answer::Drafted { drafted, failed }
            }
            (QuitAnswer::Drafted, Some((drafted, failed))) => Answer::DraftedUndiscarding {
                drafted,
                failed,
                undiscarded: ids,
            },
            // `validate_backstop_counts` ran for every `drafted`, so this arm
            // is unreachable; refuse rather than invent counts.
            (QuitAnswer::Drafted, None) => {
                let err = "drafted counts required".to_string();
                logging::log_answer(context, Some(err.clone()));
                return Err(err);
            }
        };
        let (plan, refusal) =
            self.plan(|c| c.on_answer_in(request_id, round, label, coordinator_answer, now_ms));
        // Logged AFTER the coordinator has ruled, with what it ruled. Logging
        // the answer on arrival reported every refusal as a success, so a cancel
        // that did nothing was indistinguishable from one that worked.
        logging::log_answer(
            context,
            refusal.map(|why| format!("{answer:?} refused: {}", why.as_str())),
        );
        self.run(plan);
        Ok(())
    }

    /// An untagged answer that carries no counts. A `drafted` answer is refused
    /// here ("drafted counts required") and logged as a `fail`: it needs its
    /// counts, which only `handle_drafted` and the wire entry carry.
    pub fn handle_reply(
        &self,
        label: &str,
        request_id: u64,
        answer: QuitAnswer,
        document_ids: Option<Vec<String>>,
        now_ms: u64,
    ) -> Result<(), String> {
        self.handle_wire_reply(
            label,
            request_id,
            answer,
            document_ids,
            None,
            None,
            None,
            now_ms,
        )
    }
}
