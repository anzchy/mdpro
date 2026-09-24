//! The `file:open-in-window` event (D29 WI-3): its name and its payload.
//!
//! Key decisions:
//! - **camelCase on the wire** (`windowLabel`, `documentId`, `path`), which
//!   is what the frontend listener (`useOpenInWindow`) validates.
//! - `document_id` and `path` are the matched document's stored values, not
//!   the incoming path (ADR-0033 decision 1).
use serde::Serialize;

/// Event emitted with `emit_to` to the one window that holds the path.
pub const OPEN_IN_WINDOW_EVENT: &str = "file:open-in-window";

/// Payload of [`OPEN_IN_WINDOW_EVENT`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInWindowPayload {
    pub window_label: String,
    pub document_id: String,
    pub path: String,
}

#[cfg(test)]
#[path = "payload_tests.rs"]
mod payload_tests;
