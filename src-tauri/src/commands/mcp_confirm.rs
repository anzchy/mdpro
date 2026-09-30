//! Purpose: the IPC entry point for a window's answer to an MCP write
//! confirmation (ADR-0042).
//!
//! Pipeline: `useMcpConfirm` (frontend, WI-7) -> `mcp_confirm_reply` ->
//! `reply_from` -> the managed `Arc<AppConfirmBroker>` -> `PendingTable`
//! -> the waiting HTTP handler (`mcp_confirm::http::confirm_gate`).
//!
//! Key decisions:
//! - **The window label comes from the caller, never from the payload**, as
//!   in `quit_guard_reply`: a webview cannot answer a sibling's prompt. The
//!   table accepts a reply only from the owner, for its shown request.
//! - `request_id` is checked before anything else: empty, longer than
//!   `MAX_REQUEST_ID_LEN`, or not a UUID is an `Err` whose text never
//!   echoes the input. A well-formed id is keyed by its parsed `Uuid`
//!   value (canonical lowercase hyphenated), so `{…}` or upper-case forms
//!   of a pending id resolve it and nothing else (matrix R-5).
//! - A well-formed id that is unknown, already answered, or late is
//!   `Ok(Ignored…)`, never `Err`: a timeout racing a click is ordinary.
//! - Log lines `mcp.confirm.reply` go to the broker's sink: a `start` with
//!   `{requestId, approved}` and an end with `{requestId, verdict,
//!   approved}` (`success` for any verdict, `fail` on `Err`); a malformed
//!   id gets one `fail` line with `{approved}` only. Never the title.
//! - Managed state is `Arc<AppConfirmBroker>` (the HTTP handlers and the
//!   stop hook share the same broker). Tauri resolves `State` at invoke
//!   time, so until `main.rs` manages it (WI-9) an invoke errors; startup
//!   does not.
//!
//! @coordinates-with src-tauri/src/services/mcp_confirm/broker.rs
//! @coordinates-with src-tauri/src/commands/quit_guard.rs (same label rule)

use std::sync::Arc;

use serde_json::json;
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::mcp_confirm::broker::ConfirmBroker;
use crate::services::mcp_confirm::effects::{AppConfirmBroker, ConfirmEffects};
use crate::services::mcp_confirm::queue::ReplyVerdict;

pub const REPLY_LOG_EVENT: &str = "mcp.confirm.reply";
/// Longer than any textual UUID form (`urn:uuid:` + 36 is 45).
pub const MAX_REQUEST_ID_LEN: usize = 64;
const INVALID_ID: &str = "invalid confirmation request id";

#[tauri::command]
pub async fn mcp_confirm_reply(
    window: WebviewWindow,
    broker: State<'_, Arc<AppConfirmBroker>>,
    request_id: String,
    approved: bool,
) -> Result<ReplyVerdict, String> {
    reply_from(&broker, window.label(), &request_id, approved)
}

/// The command's body, testable without Tauri. `label` is the caller's.
pub fn reply_from<E: ConfirmEffects>(
    broker: &ConfirmBroker<E>,
    label: &str,
    raw_id: &str,
    approved: bool,
) -> Result<ReplyVerdict, String> {
    let id = match parse_request_id(raw_id) {
        Ok(id) => id,
        Err(error) => {
            broker.log(invalid_id_log(approved));
            return Err(error);
        }
    };
    broker.log(entry(
        LogLevel::Info,
        LogStatus::Start,
        json!({ "requestId": id, "approved": approved }),
    ));
    let result = broker.reply(&id, label, approved);
    broker.log(reply_log(&id, &result, approved));
    result
}

/// The canonical form of a textual UUID, or `Err` without echoing it.
fn parse_request_id(raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.len() > MAX_REQUEST_ID_LEN {
        return Err(INVALID_ID.to_string());
    }
    Uuid::parse_str(raw)
        .map(|id| id.hyphenated().to_string())
        .map_err(|_| INVALID_ID.to_string())
}

/// The wire name of a verdict, as `serde` writes it.
pub fn verdict_name(verdict: ReplyVerdict) -> &'static str {
    match verdict {
        ReplyVerdict::Resolved => "resolved",
        ReplyVerdict::IgnoredUnknown => "ignoredUnknown",
        ReplyVerdict::IgnoredWrongWindow => "ignoredWrongWindow",
        ReplyVerdict::IgnoredNotShown => "ignoredNotShown",
    }
}

fn entry(level: LogLevel, status: LogStatus, context: serde_json::Value) -> LogEntryPayload {
    LogEntryPayload {
        level,
        event: REPLY_LOG_EVENT.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    }
}

/// The end line of a reply to the well-formed `id`.
pub fn reply_log(
    id: &str,
    result: &Result<ReplyVerdict, String>,
    approved: bool,
) -> LogEntryPayload {
    match result {
        Ok(verdict) => entry(
            LogLevel::Info,
            LogStatus::Success,
            json!({ "requestId": id, "verdict": verdict_name(*verdict), "approved": approved }),
        ),
        Err(error) => {
            let context = json!({ "requestId": id, "approved": approved });
            let mut line = entry(LogLevel::Error, LogStatus::Fail, context);
            line.error = Some(error.clone());
            line
        }
    }
}

fn invalid_id_log(approved: bool) -> LogEntryPayload {
    let mut line = entry(
        LogLevel::Warn,
        LogStatus::Fail,
        json!({ "approved": approved }),
    );
    line.error = Some(INVALID_ID.to_string());
    line
}

#[cfg(test)]
#[path = "mcp_confirm_tests.rs"]
mod tests;
