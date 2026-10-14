//! D98: MCP refuses to read or write a document whose content was over the
//! sync cap, instead of serving the stale or empty shadow copy.
//!
//! Every MCP read and write route calls `over_limit_refusal` first, before
//! the ADR-0042 confirmation gate, so no prompt opens for a request that
//! would be refused anyway. A store error or a missing document is left to
//! the handler, which already answers those.
//!
//! @coordinates-with src-tauri/src/commands/mcp_sync_cap.rs

use crate::models::{ErrorResponse, LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::{logger, shadow_store};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// The `ErrorResponse.code` of a request on an over-cap document.
pub(super) const DOCUMENT_TOO_LARGE: &str = "DOCUMENT_TOO_LARGE";

/// `Some(413)` (logged under `event`) when document `id` is over the cap,
/// `None` otherwise, including when it is not open.
pub(super) fn over_limit_refusal(
    store: &SharedShadowStore,
    id: &str,
    event: &str,
) -> Option<Response> {
    let doc = shadow_store::get_document(store, id).ok().flatten()?;
    if !doc.over_limit {
        return None;
    }
    logger::log_event(LogEntryPayload {
        level: LogLevel::Warn,
        event: event.to_string(),
        status: LogStatus::Fail,
        action_id: None,
        context: Some(json!({ "documentId": id, "reason": "over limit" })),
        duration_ms: None,
        error: Some("document over the MCP size limit".to_string()),
    });
    let error = ErrorResponse {
        error: format!("Document {id} is over the 10 MiB MCP limit; read or edit it in mdpro"),
        code: Some(DOCUMENT_TOO_LARGE.to_string()),
    };
    Some((StatusCode::PAYLOAD_TOO_LARGE, Json(error)).into_response())
}

#[cfg(test)]
#[path = "http_server_over_limit_tests.rs"]
mod tests;
