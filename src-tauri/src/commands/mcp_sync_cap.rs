//! D98: the sync's per-document size cap.
//!
//! A document over the cap used to make `mcp_sync_documents` refuse the whole
//! window's payload, so every document in that window stopped syncing and the
//! shadow store kept stale content that MCP reads then served. Now the sync
//! goes through with that one document capped (its content dropped and
//! `over_limit` set), and `services/http_server_over_limit.rs` refuses MCP
//! reads and writes on it with 413 `DOCUMENT_TOO_LARGE`.
//!
//! @coordinates-with src-tauri/src/services/http_server_over_limit.rs

use crate::models::{LogEntryPayload, LogLevel, LogStatus, SyncDocumentsPayload};
use serde_json::json;

/// Maximum size of a single document's content in bytes (10 MiB), the same
/// limit `open_file` enforces.
pub(crate) const MAX_DOCUMENT_CONTENT_BYTES: usize = 10 * 1024 * 1024;

/// Caps every document in `payload` that is over the limit and returns the
/// id and byte length of each one capped. A capped document keeps its id,
/// title, path and dirty flag, so it stays listed; its content is dropped,
/// its cursor reset and `over_limit` set, so MCP refuses it rather than
/// serving text it does not have. The rest of the payload is untouched.
pub(crate) fn cap_oversize_documents(payload: &mut SyncDocumentsPayload) -> Vec<(String, usize)> {
    let mut capped = Vec::new();
    for doc in &mut payload.documents {
        let len = doc.content.len();
        if len > MAX_DOCUMENT_CONTENT_BYTES {
            doc.content = String::new();
            doc.cursor = 0;
            doc.over_limit = true;
            capped.push((doc.id.clone(), len));
        }
    }
    capped
}

/// The `mcp.sync` warning for the documents just capped: ids and sizes only.
pub(crate) fn capped_entry(window_label: &str, capped: &[(String, usize)]) -> LogEntryPayload {
    let documents: Vec<_> = capped
        .iter()
        .map(|(id, bytes)| json!({ "documentId": id, "bytes": bytes }))
        .collect();
    LogEntryPayload {
        level: LogLevel::Warn,
        event: "mcp.sync".to_string(),
        status: LogStatus::Fail,
        action_id: None,
        context: Some(json!({
            "windowLabel": window_label,
            "reason": "over limit",
            "limitBytes": MAX_DOCUMENT_CONTENT_BYTES,
            "documents": documents,
        })),
        duration_ms: None,
        error: None,
    }
}

#[cfg(test)]
#[path = "mcp_sync_cap_d98_tests.rs"]
mod d98_tests;
