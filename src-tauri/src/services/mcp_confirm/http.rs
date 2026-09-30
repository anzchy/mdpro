//! Purpose: the HTTP side of the MCP write confirmation (ADR-0042): decide
//! whether a write needs the owning window's approval, ask it, and map how
//! that ended to the handler's response.
//!
//! Pipeline: `shadow_store::owner_and_focus` -> `gate::decide` ->
//! (Prompt) `ConfirmBroker::confirm` (which logs `mcp.confirm`) ->
//! `response_for` -> the write handler proceeds on `Ok(())` or returns the
//! `Err` response as is.
//!
//! Key decisions:
//! - The mapping (`response_for`) is total and pure:
//!   `ApplyNow | Approved` proceed; `NoOwner` 404 `NOT_FOUND`; `Rejected`
//!   403 `USER_REJECTED`; `TimedOut` 408 `CONFIRM_TIMEOUT` (never a
//!   refusal the user did not make); every `Cancelled(_)` 503
//!   `CONFIRM_CANCELLED` (the cause is a log concern, not the client's).
//! - Error bodies are the `ErrorResponse {error, code}` shape the other
//!   handlers in `http_server.rs` use; they never carry the title.
//! - A poisoned shadow store fails closed: 500 `INTERNAL_ERROR`, never a
//!   prompt and never `Ok(())`.
//! - The title is read after the owner/focus pair, only for a prompt; a
//!   document that went away between the two reads is `NOT_FOUND`.
//!
//! @coordinates-with src-tauri/src/services/mcp_confirm/broker.rs
//! @coordinates-with src-tauri/src/services/http_server.rs (the write
//!   handlers call `confirm_gate`, WI-9)

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use super::broker::ConfirmBroker;
use super::effects::ConfirmEffects;
use super::gate::{decide, Gate};
use super::logging::CONFIRM_LOG_EVENT;
use super::payload::{ConfirmMeta, Operation};
use super::queue::Outcome;
use crate::models::{ErrorResponse, LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::shadow_store;

/// Everything a write's gate can end in, before it becomes a response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateResult {
    /// The owning window is focused: no prompt was needed.
    ApplyNow,
    /// No window holds the document.
    NoOwner,
    /// The owning window was asked; this is how it ended.
    Confirmed(Outcome),
}

fn error_response(status: StatusCode, code: &str, error: String) -> Response {
    let body = ErrorResponse {
        error,
        code: Some(code.to_string()),
    };
    (status, Json(body)).into_response()
}

/// The response for a gate result: `Ok(())` means the write proceeds.
/// The `Err` is a whole `Response` on purpose: a handler returns it as is,
/// once per request, so boxing it would only add an allocation.
#[allow(clippy::result_large_err)]
pub fn response_for(result: GateResult) -> Result<(), Response> {
    let (status, code, error) = match result {
        GateResult::ApplyNow | GateResult::Confirmed(Outcome::Approved) => return Ok(()),
        GateResult::NoOwner => (StatusCode::NOT_FOUND, "NOT_FOUND", "Document not found"),
        GateResult::Confirmed(Outcome::Rejected) => (
            StatusCode::FORBIDDEN,
            "USER_REJECTED",
            "User rejected write operation",
        ),
        GateResult::Confirmed(Outcome::TimedOut) => (
            StatusCode::REQUEST_TIMEOUT,
            "CONFIRM_TIMEOUT",
            "Write confirmation timed out",
        ),
        GateResult::Confirmed(Outcome::Cancelled(_)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "CONFIRM_CANCELLED",
            "Write confirmation was cancelled",
        ),
    };
    Err(error_response(status, code, error.to_string()))
}

/// The shadow store could not be read: logged on the broker's sink, then
/// 500. The store's error text goes to the client as the other handlers do.
fn store_unavailable<E: ConfirmEffects>(
    broker: &ConfirmBroker<E>,
    doc_id: &str,
    error: String,
) -> Response {
    broker.log(LogEntryPayload {
        level: LogLevel::Error,
        event: CONFIRM_LOG_EVENT.to_string(),
        status: LogStatus::Fail,
        action_id: None,
        context: Some(json!({ "documentId": doc_id })),
        duration_ms: None,
        error: Some("shadow store unavailable".to_string()),
    });
    error_response(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", error)
}

/// Gate one MCP write to `doc_id`: `Ok(())` to apply it, or the response
/// to return instead. Waits (at most the broker's budget) only when the
/// owning window is not focused.
pub async fn confirm_gate<E: ConfirmEffects>(
    broker: &ConfirmBroker<E>,
    store: &SharedShadowStore,
    doc_id: &str,
    operation: Operation,
) -> Result<(), Response> {
    let (owner, focused) = shadow_store::owner_and_focus(store, doc_id)
        .map_err(|e| store_unavailable(broker, doc_id, e))?;
    let window = match decide(owner.as_deref(), focused.as_deref()) {
        Gate::ApplyNow => return response_for(GateResult::ApplyNow),
        Gate::NoOwner => return response_for(GateResult::NoOwner),
        Gate::Prompt { window } => window,
    };
    let document_title = match shadow_store::get_document(store, doc_id) {
        Ok(Some(doc)) => doc.title,
        Ok(None) => return response_for(GateResult::NoOwner),
        Err(e) => return Err(store_unavailable(broker, doc_id, e)),
    };
    let meta = ConfirmMeta {
        document_id: doc_id.to_string(),
        document_title,
        operation,
    };
    let outcome = broker.confirm(&window, meta).await;
    response_for(GateResult::Confirmed(outcome))
}

#[cfg(test)]
#[path = "http_tests.rs"]
pub(crate) mod tests;

#[cfg(test)]
#[path = "http_log_integration_tests.rs"]
mod log_integration_tests;
