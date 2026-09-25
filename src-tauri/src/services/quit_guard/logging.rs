//! Purpose: the twelve `app.quit.*` log events, in one place.
//!
//! Key decisions:
//! - **Counts, never ids, never content.** A draft id names a document the user
//!   is working on, and the quit path is the one place that knows which
//!   documents were discarded. The count is what makes a support log useful;
//!   the ids are what would make it a leak.
//! - The context builders are pure and separate from the writing, so what goes
//!   into the log is testable without a log file.
//! - ADR-0035 adds `app.quit.recheck` / `app.quit.backstop` (`{requestId,
//!   round, windowCount}`), the backstop tally plus `gateWaitMs` on
//!   `app.quit.commit`, which is `fail` when any of its four failure counts is
//!   non-zero: a lost draft is not a success. `round` on every answer line and
//!   the `drafted` answer's counts are added to `answer_log_context` by
//!   `driver_wire.rs`.
//!
//! @coordinates-with .claude/rules/20-logging-and-docs.md

use serde_json::{json, Value};

use super::coordinator::{AbortReason, FallbackAnswer};
use super::driver::{CommitReport, QuitAnswer};
use super::InstallOutcome;
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

/// Context for `app.quit.hook_installed`: which class was hooked, and whether it
/// took. The class name is the only warning a tao upgrade will give (ADR-0025
/// §"Costs"), so it is logged even when the install succeeded.
pub fn hook_install_log_context(delegate_class: Option<&str>, outcome: InstallOutcome) -> Value {
    json!({
        "delegateClass": delegate_class,
        "outcome": outcome.as_str(),
    })
}

/// A failed install is logged at error level with a reason. The worst outcome is
/// a silent one: the app looks fine and quits past unsaved work.
pub(super) fn log_hook_installed(delegate_class: Option<&str>, outcome: InstallOutcome) {
    let status = if outcome.installed() {
        LogStatus::Success
    } else {
        LogStatus::Fail
    };
    write(
        "app.quit.hook_installed",
        status,
        hook_install_log_context(delegate_class, outcome),
        outcome.failure_reason().map(str::to_string),
    );
}

/// The IMP ran with an empty host slot. `install` fills the slot before adding
/// the method, so this is unreachable by construction — and therefore worth a
/// loud line if it ever is not.
#[cfg(target_os = "macos")]
pub(super) fn log_hook_no_host() {
    write(
        "app.quit.hook_no_host",
        LogStatus::Fail,
        json!({}),
        Some("applicationShouldTerminate: ran with no host; quitting unguarded".to_string()),
    );
}

/// Context for `app.quit.answer`: who answered what, and **how many** ids came
/// with it.
pub fn answer_log_context(
    label: &str,
    answer: QuitAnswer,
    request_id: u64,
    document_ids: &[String],
) -> Value {
    json!({
        "windowLabel": label,
        "answer": answer,
        "requestId": request_id,
        "idCount": document_ids.len(),
    })
}

/// Context for `app.quit.effect_failed`: which liveness-critical effect could
/// not be dispatched, and for which request (ADR-0029 §4).
///
/// The effect name is a fixed identifier chosen by the driver, never a value
/// from the webview, and the line carries no window label — the failure is the
/// app's, not one document's.
pub fn effect_failure_log_context(request_id: u64, effect: &str) -> Value {
    json!({
        "requestId": request_id,
        "effect": effect,
    })
}

/// A liveness-critical effect that was not dispatched (ADR-0029 §4). Error
/// level and `Fail` status: a reply AppKit never received leaves the app
/// unquittable, and this line is the only trace of it a support log gets.
pub(super) fn log_effect_failed(request_id: u64, effect: &str) {
    write(
        "app.quit.effect_failed",
        LogStatus::Fail,
        effect_failure_log_context(request_id, effect),
        Some(format!("{effect} could not be dispatched")),
    );
}

/// The wire name of an alert answer: the bare enum the frontend and the log
/// share, never `Debug` formatting.
fn fallback_answer_str(answer: FallbackAnswer) -> &'static str {
    match answer {
        FallbackAnswer::KeepOpen => "keepOpen",
        FallbackAnswer::QuitAnyway => "quitWithoutSaving",
    }
}

/// Context for `app.quit.fallback`: exactly which request the alert answered,
/// and how. No window label — the alert belongs to the app, not a window.
pub fn fallback_log_context(request_id: u64, answer: FallbackAnswer) -> Value {
    json!({
        "requestId": request_id,
        "answer": fallback_answer_str(answer),
    })
}

/// `app.quit.fallback`: `success` when the coordinator took the alert's answer,
/// `fail` at error level with the refusal reason when it did not.
pub(super) fn log_fallback(request_id: u64, answer: FallbackAnswer, refusal: Option<&str>) {
    let status = if refusal.is_some() {
        LogStatus::Fail
    } else {
        LogStatus::Success
    };
    write(
        "app.quit.fallback",
        status,
        fallback_log_context(request_id, answer),
        refusal.map(str::to_string),
    );
}

/// The alert was answered but no guard is managed to take the answer. Logged
/// rather than dropped: a silent drop leaves a quit unresolved with no trace.
pub(super) fn log_fallback_no_guard(request_id: u64, answer: FallbackAnswer) {
    log_fallback(request_id, answer, Some("noGuard"));
}

/// Context for `app.quit.commit`: what the commit did to the drafts, what the
/// backstop did, how many discards a backstop redraft cancelled (`undiscarded`,
/// review M-1), and how long the commit waited for an in-flight save to
/// release the draft gate (ADR-0035 A6). Counts only.
pub fn commit_log_context(report: &CommitReport, gate_wait_ms: u64) -> Value {
    json!({
        "deleted": report.deleted,
        "failed": report.failed,
        "drafted": report.drafted,
        "draftFailed": report.draft_failed,
        "draftMissing": report.draft_missing,
        "capped": report.capped,
        "backstop": report.backstop,
        "gateWaitMs": gate_wait_ms,
        "undiscarded": report.undiscarded,
    })
}

/// `app.quit.recheck`: a re-check round started (ADR-0035 §2).
pub(super) fn log_recheck(request_id: u64, round: u32, window_count: usize) {
    write(
        "app.quit.recheck",
        LogStatus::Start,
        json!({ "requestId": request_id, "round": round, "windowCount": window_count }),
        None,
    );
}

/// `app.quit.backstop`: the draft backstop started (ADR-0035 §4).
pub(super) fn log_backstop(request_id: u64, round: u32, window_count: usize) {
    write(
        "app.quit.backstop",
        LogStatus::Start,
        json!({ "requestId": request_id, "round": round, "windowCount": window_count }),
        None,
    );
}

pub(super) fn log_request(request_id: u64, window_count: usize) {
    write(
        "app.quit.request",
        LogStatus::Start,
        json!({ "requestId": request_id, "windowCount": window_count }),
        None,
    );
}

pub(super) fn log_answer(context: Value, refusal: Option<String>) {
    let status = if refusal.is_some() {
        LogStatus::Fail
    } else {
        LogStatus::Success
    };
    write("app.quit.answer", status, context, refusal);
}

pub(super) fn log_prompt(request_id: u64, label: &str) {
    write(
        "app.quit.prompt",
        LogStatus::Start,
        json!({ "requestId": request_id, "windowLabel": label }),
        None,
    );
}

pub(super) fn log_timeout(request_id: u64, timed_out: usize, after_ms: u64) {
    write(
        "app.quit.timeout",
        LogStatus::Fail,
        json!({ "requestId": request_id, "timedOutCount": timed_out }),
        Some(format!("no ack within {after_ms}ms")),
    );
}

pub(super) fn log_cancel(request_id: u64, reason: &AbortReason) {
    let (name, label) = match reason {
        AbortReason::Cancelled { by } => ("cancelled", Some(by.as_str())),
        AbortReason::UserKeptOpen => ("userKeptOpen", None),
    };
    write(
        "app.quit.cancel",
        LogStatus::Cancel,
        json!({ "requestId": request_id, "reason": name, "windowLabel": label }),
        None,
    );
}

/// `app.quit.commit`. A draft that would not delete, a backstop draft that
/// failed or never came, or a capped window makes the line `Fail` at error
/// level with a count-only reason — the quit itself still commits
/// (ADR-0025 §4), but a leftover discarded draft must not be logged as success.
/// `LogStatus` has no partial variant, so any failure is `Fail`.
pub(super) fn log_commit(request_id: u64, report: &CommitReport, gate_wait_ms: u64) {
    let mut context = commit_log_context(report, gate_wait_ms);
    if let Some(map) = context.as_object_mut() {
        map.insert("requestId".to_string(), json!(request_id));
    }
    let error = commit_error(report);
    let status = if error.is_some() {
        LogStatus::Fail
    } else {
        LogStatus::Success
    };
    write("app.quit.commit", status, context, error);
}

/// The count-only reason a commit line fails, one clause per non-zero failure
/// count; `None` when all four are zero.
fn commit_error(report: &CommitReport) -> Option<String> {
    let clauses = [
        (report.failed, "draft deletions failed"),
        (report.draft_failed as usize, "backstop drafts failed"),
        (
            report.draft_missing as usize,
            "windows sent no backstop answer",
        ),
        (
            report.capped as usize,
            "windows capped after their re-prompt",
        ),
    ];
    let parts: Vec<String> = clauses
        .iter()
        .filter(|(n, _)| *n > 0)
        .map(|(n, what)| format!("{n} {what}"))
        .collect();
    (!parts.is_empty()).then(|| parts.join("; "))
}

fn write(event: &str, status: LogStatus, context: Value, error: Option<String>) {
    logger::log_event(LogEntryPayload {
        level: if matches!(status, LogStatus::Fail) {
            LogLevel::Error
        } else {
            LogLevel::Info
        },
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error,
    });
}
