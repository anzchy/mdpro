//! The `mcp.confirm` log lines, as pure builders (ADR-0042; rule 20).
//!
//! Key decisions:
//! - Context keys come only from `{requestId, documentId, windowLabel,
//!   operation, queueDepth, outcome, waitedMs}`. The document title, its
//!   content, its path and the MCP token are never written: the title the
//!   old native alert logged as `documentTitle` is gone.
//! - `status` is `success` only for an approval. A refusal, timeout,
//!   cancel or withdraw is `fail` at `info` level: it is an ordinary end,
//!   not a fault. A cancel keeps its cause in `error`.
//! - Faults in the broker itself (a poisoned table, a failed effect) are
//!   `error` level.
//!
//! @coordinates-with .claude/rules/20-logging-and-docs.md

use serde_json::{json, Value};

use super::payload::{ConfirmMeta, Operation, ResolvedOutcome};
use super::queue::{Cause, Outcome};
use crate::models::{LogEntryPayload, LogLevel, LogStatus};

pub const CONFIRM_LOG_EVENT: &str = "mcp.confirm";
pub const CONFIRM_EFFECT_LOG_EVENT: &str = "mcp.confirm.effect";

/// `replace`, `insert`, or `table:<action>`.
fn operation_label(operation: Operation) -> String {
    match operation.action() {
        Some(action) => format!("{}:{}", operation.as_str(), action.as_str()),
        None => operation.as_str().to_string(),
    }
}

fn base_context(id: &str, window: &str, meta: &ConfirmMeta, queue_depth: usize) -> Value {
    json!({
        "requestId": id,
        "documentId": meta.document_id,
        "windowLabel": window,
        "operation": operation_label(meta.operation),
        "queueDepth": queue_depth,
    })
}

fn with_end(mut context: Value, outcome: ResolvedOutcome, waited_ms: u64) -> Value {
    if let Some(map) = context.as_object_mut() {
        map.insert("outcome".to_string(), json!(outcome.as_str()));
        map.insert("waitedMs".to_string(), json!(waited_ms));
    }
    context
}

fn entry(level: LogLevel, event: &str, status: LogStatus, context: Value) -> LogEntryPayload {
    LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    }
}

fn cause_name(cause: Cause) -> &'static str {
    match cause {
        Cause::ServerStop => "serverStop",
        Cause::AppExit => "appExit",
        Cause::WindowClosed => "windowClosed",
        Cause::EmitFailed => "emitFailed",
    }
}

/// A request was queued for `window`; `queue_depth` counts every pending
/// request in the broker at that moment, itself included.
pub fn start_entry(
    id: &str,
    window: &str,
    meta: &ConfirmMeta,
    queue_depth: usize,
) -> LogEntryPayload {
    let context = base_context(id, window, meta, queue_depth);
    entry(LogLevel::Info, CONFIRM_LOG_EVENT, LogStatus::Start, context)
}

/// The waiter got its outcome after `waited_ms`.
pub fn end_entry(
    id: &str,
    window: &str,
    meta: &ConfirmMeta,
    queue_depth: usize,
    outcome: Outcome,
    waited_ms: u64,
) -> LogEntryPayload {
    let context = with_end(
        base_context(id, window, meta, queue_depth),
        outcome.into(),
        waited_ms,
    );
    let status = match outcome {
        Outcome::Approved => LogStatus::Success,
        Outcome::Rejected | Outcome::TimedOut | Outcome::Cancelled(_) => LogStatus::Fail,
    };
    let mut line = entry(LogLevel::Info, CONFIRM_LOG_EVENT, status, context);
    if let Outcome::Cancelled(cause) = outcome {
        line.error = Some(cause_name(cause).to_string());
    }
    line
}

/// The waiter went away (the client disconnected) before an outcome.
pub fn withdrawn_entry(
    id: &str,
    window: &str,
    meta: &ConfirmMeta,
    queue_depth: usize,
    waited_ms: u64,
) -> LogEntryPayload {
    let context = base_context(id, window, meta, queue_depth);
    let context = with_end(context, ResolvedOutcome::Withdrawn, waited_ms);
    entry(LogLevel::Info, CONFIRM_LOG_EVENT, LogStatus::Fail, context)
}

/// The pending table was poisoned: the request is refused unasked.
pub fn unavailable_entry(window: &str, meta: &ConfirmMeta) -> LogEntryPayload {
    let context = json!({
        "documentId": meta.document_id,
        "windowLabel": window,
        "operation": operation_label(meta.operation),
        "outcome": ResolvedOutcome::Cancelled.as_str(),
    });
    let mut line = entry(LogLevel::Error, CONFIRM_LOG_EVENT, LogStatus::Fail, context);
    line.error = Some("confirmation table unavailable".to_string());
    line
}

/// A boundary call failed; `effect` is a fixed name (`request`,
/// `resolved`, `attention`). The effect's error text is not logged.
pub fn effect_failed_entry(id: &str, window: &str, effect: &'static str) -> LogEntryPayload {
    let context = json!({ "requestId": id, "windowLabel": window });
    let mut line = entry(
        LogLevel::Error,
        CONFIRM_EFFECT_LOG_EVENT,
        LogStatus::Fail,
        context,
    );
    line.error = Some(format!("{effect} failed"));
    line
}

#[cfg(test)]
#[path = "logging_tests.rs"]
mod tests;
