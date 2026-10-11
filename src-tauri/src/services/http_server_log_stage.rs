//! D153 / D156: the payload and log-line builders for MCP writes that Rust
//! schedules and the frontend applies. Each request mints one action id; the
//! Rust line logs it with `stage: "scheduled"`, and the emitted payload carries
//! it as `action_id`, so the frontend's `stage: "applied"` line joins it.
//!
//! Wired from `http_server.rs` with `#[path]`, which keeps that file inside its
//! line budget (`tests/mcp_confirm_single_gate.rs` `sg2_size_budgets`).

use crate::models::{LogEntryPayload, LogLevel, LogStatus, WriteDocumentEvent};
use crate::services::mcp_confirm::payload::TableAction;
use serde_json::json;

#[derive(serde::Serialize)]
pub(super) struct TableActionEvent {
    pub(super) document_id: String,
    pub(super) action: String,
    pub(super) payload: serde_json::Value,
    pub(super) window_label: Option<String>,
    /// D153: minted once per request; also on the `stage: "scheduled"` log.
    pub(super) action_id: String,
}

/// Build the `mcp:table_action` payload (D153: with the request's action id).
pub(super) fn table_action_event(
    document_id: &str,
    action: TableAction,
    payload: serde_json::Value,
    window_label: Option<String>,
    action_id: &str,
) -> TableActionEvent {
    TableActionEvent {
        document_id: document_id.to_string(),
        action: action.as_str().to_string(),
        payload,
        window_label,
        action_id: action_id.to_string(),
    }
}

/// The `stage` a Rust log line reports for a write it hands to the frontend:
/// the emit happened, the edit has not been applied yet (D153).
pub(super) const STAGE_SCHEDULED: &str = "scheduled";

/// A log line for a write handed to the frontend (D153): `context` gains
/// `stage: "scheduled"` and the line carries `action_id`, the id the emitted
/// payload also carries, so the frontend's `stage: "applied"` line under the
/// same event name can be joined to it. A non-object `context` is replaced
/// by `{ "stage": "scheduled" }`.
pub(super) fn scheduled_entry(
    level: LogLevel,
    event: &str,
    status: LogStatus,
    action_id: &str,
    context: serde_json::Value,
    error: Option<String>,
) -> LogEntryPayload {
    let mut context = match context {
        serde_json::Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    context.insert("stage".to_string(), json!(STAGE_SCHEDULED));
    LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: Some(action_id.to_string()),
        context: Some(serde_json::Value::Object(context)),
        duration_ms: None,
        error,
    }
}

/// Build the `mcp:write_document` / `mcp:create_document` payload (D156:
/// with the request's action id, the one its `stage: "scheduled"` line logs).
pub(super) fn write_document_event(
    document_id: &str,
    content: String,
    window_label: Option<String>,
    action_id: &str,
) -> WriteDocumentEvent {
    WriteDocumentEvent {
        document_id: document_id.to_string(),
        content,
        window_label,
        action_id: action_id.to_string(),
    }
}

/// The `mcp.create` line `create_document` logs once it has tried the emit
/// (D156): success with `contentLength`, or, when `emit_error` is set, an
/// error with reason `emit failed`. Never the content itself.
pub(super) fn create_scheduled_entry(
    action_id: &str,
    document_id: &str,
    content_length: usize,
    emit_error: Option<String>,
) -> LogEntryPayload {
    match emit_error {
        None => scheduled_entry(
            LogLevel::Info,
            "mcp.create",
            LogStatus::Success,
            action_id,
            json!({ "documentId": document_id, "contentLength": content_length }),
            None,
        ),
        Some(error) => scheduled_entry(
            LogLevel::Error,
            "mcp.create",
            LogStatus::Fail,
            action_id,
            json!({ "documentId": document_id, "reason": "emit failed" }),
            Some(error),
        ),
    }
}
