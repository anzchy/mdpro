//! Purpose: the six `app.quit.*` log events, in one place.
//!
//! Key decisions:
//! - **Counts, never ids, never content.** A draft id names a document the user
//!   is working on, and the quit path is the one place that knows which
//!   documents were discarded. The count is what makes a support log useful;
//!   the ids are what would make it a leak.
//! - The context builders are pure and separate from the writing, so what goes
//!   into the log is testable without a log file.
//!
//! @coordinates-with .claude/rules/20-logging-and-docs.md

use serde_json::{json, Value};

use super::coordinator::AbortReason;
use super::driver::{CommitReport, QuitAnswer};
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

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

/// Context for `app.quit.commit`: what the commit did to the drafts.
pub fn commit_log_context(report: &CommitReport) -> Value {
    json!({
        "deleted": report.deleted,
        "failed": report.failed,
    })
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

pub(super) fn log_commit(request_id: u64, report: &CommitReport) {
    let mut context = commit_log_context(report);
    if let Some(map) = context.as_object_mut() {
        map.insert("requestId".to_string(), json!(request_id));
    }
    write("app.quit.commit", LogStatus::Success, context, None);
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
