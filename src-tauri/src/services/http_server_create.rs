//! D161: which window `POST /api/documents/new` creates its document in.
//!
//! `mcp:create_document` is broadcast like the other MCP events, and every
//! window's `useMcpEvents` applies an event whose `window_label` is its own
//! (and, before D161, a null one). So the event must name exactly one window.
//!
//! Key decisions:
//! - The owner is `ShadowStore::get_target_window` (`models/mcp.rs`): the
//!   focused window, else the most recently focused one. It is the rule
//!   `GET /api/documents/active` already uses (`get_active_document`), so an
//!   agent working while mdpro is in the background gets its document in the
//!   window the user last used. Not an ADR: no new rule.
//! - No registered window means no event: the route answers 503 `NO_WINDOW`
//!   instead of a 201 whose id no window ever opens.
//!
//! Wired from `http_server.rs` with `#[path]`, which keeps that file inside its
//! line budget (`tests/mcp_confirm_single_gate.rs` `sg2_size_budgets`).

use super::log_stage::{scheduled_entry, write_document_event};
use crate::models::{
    ErrorResponse, LogEntryPayload, LogLevel, LogStatus, ShadowStore, WriteDocumentEvent,
};
use serde_json::json;

/// The `ErrorResponse.code` of a create refused for want of a window.
pub(super) const NO_WINDOW: &str = "NO_WINDOW";

/// The `mcp:create_document` payload for a new document, naming its owner
/// window, or `None` when no window is registered to take it.
pub(super) fn create_document_event(
    store: &ShadowStore,
    document_id: &str,
    content: String,
    action_id: &str,
) -> Option<WriteDocumentEvent> {
    let owner = store.get_target_window()?.label.clone();
    Some(write_document_event(
        document_id,
        content,
        Some(owner),
        action_id,
    ))
}

/// The 503 body for a create no window can take.
pub(super) fn no_window_error() -> ErrorResponse {
    ErrorResponse {
        error: "No mdpro window is open to create the document in".to_string(),
        code: Some(NO_WINDOW.to_string()),
    }
}

/// The `mcp.create` scheduled line for a create refused for want of a
/// window: a warning with reason `no window`, nothing emitted.
pub(super) fn no_window_entry(action_id: &str, document_id: &str) -> LogEntryPayload {
    scheduled_entry(
        LogLevel::Warn,
        "mcp.create",
        LogStatus::Fail,
        action_id,
        json!({ "documentId": document_id, "reason": "no window" }),
        None,
    )
}

#[cfg(test)]
#[path = "http_server_create_tests.rs"]
mod tests;
