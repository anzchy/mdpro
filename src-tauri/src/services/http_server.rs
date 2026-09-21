//! HTTP Server for MCP
//!
//! Internal HTTP server that mdpro-mcp uses to communicate with the mdpro app.
//! Only accessible from localhost with token authentication.

use crate::models::{
    CreateDocumentRequest, CreateDocumentResponse, DocumentContent, DocumentInfo, ErrorResponse,
    InsertContentEvent, InsertContentRequest, InsertPosition, InsertResult, LogEntryPayload,
    LogLevel, LogStatus, ServerConfig, SharedServerConfig, SharedShadowStore, StatusResponse,
    UpdateDocumentRequest, WriteDocumentEvent, WriteResult,
};
use crate::services::{logger, shadow_store};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rand::Rng;
use serde_json::json;
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// App state shared across HTTP handlers.
#[derive(Clone)]
pub struct AppState {
    pub shadow_store: SharedShadowStore,
    pub server_config: SharedServerConfig,
    pub app_handle: AppHandle,
}

/// Get the mdpro config directory (platform-standard data dir).
fn config_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("mdpro"))
}

/// Convert a UTF-16 code-unit offset into a byte offset (ADR-0021).
///
/// An offset landing between the two halves of a surrogate pair is snapped
/// DOWN to that character's start — a position inside a character is not a
/// position, and snapping up would move the insert past a character the client
/// explicitly named. Beyond the end of the string, returns `s.len()`.
fn utf16_offset_to_byte(s: &str, utf16_offset: usize) -> usize {
    let mut units = 0usize;
    for (byte_idx, ch) in s.char_indices() {
        let next = units + ch.len_utf16();
        if utf16_offset < next {
            return byte_idx;
        }
        units = next;
    }
    s.len()
}

/// Convert a byte offset into a UTF-16 code-unit offset (ADR-0021).
///
/// The inverse of `utf16_offset_to_byte`. Its absence is why `new_cursor` was
/// computed as byte + byte and published as a character offset: there was no
/// way back.
fn byte_offset_to_utf16(s: &str, byte_offset: usize) -> usize {
    let boundary = snap_to_char_boundary(s, byte_offset);
    s[..boundary].chars().map(char::len_utf16).sum()
}

/// Resolve an insert request to a byte offset into `content`, plus the cursor
/// position that will follow the inserted text.
///
/// Extracted from the `insert_content` handler so the offset arithmetic can be
/// unit tested — the handler itself needs an `AppState` and a live Tauri
/// `AppHandle`. Same reason `discard_and_close` was extracted from
/// `close_document` in `commands/file.rs`.
///
/// Returns `(insert_byte_offset, new_cursor)`.
fn resolve_insert(
    content: &str,
    cursor: usize,
    position: &InsertPosition,
    text: &str,
) -> (usize, usize) {
    let raw = match position {
        InsertPosition::Cursor => utf16_offset_to_byte(content, cursor),
        InsertPosition::Start => 0,
        InsertPosition::End => content.len(),
        InsertPosition::Offset(n) => utf16_offset_to_byte(content, *n),
    };
    // Belt and braces: utf16_offset_to_byte already lands on a boundary, but
    // End takes content.len() directly and a future arm might not.
    let insert_offset = snap_to_char_boundary(content, raw);

    // Both terms in UTF-16 units. This was `insert_offset + text.len()` —
    // byte + byte — published as a character offset, with no inverse
    // conversion in the file to have written it correctly with.
    let new_cursor = byte_offset_to_utf16(content, insert_offset) + text.encode_utf16().count();
    (insert_offset, new_cursor)
}

/// Snap a byte offset to the nearest valid UTF-8 char boundary.
/// If the offset lands mid-character, round down to the start of that character.
/// Prevents `String::insert_str` panic on multi-byte content (fixes #345).
fn snap_to_char_boundary(s: &str, offset: usize) -> usize {
    let clamped = offset.min(s.len());
    // Walk backwards until we hit a char boundary
    let mut pos = clamped;
    while pos > 0 && !s.is_char_boundary(pos) {
        pos -= 1;
    }
    pos
}

/// Generate a secure random token.
fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(&bytes)
}

/// Write server config files (port and token) to disk.
/// Token file is set to mode 600 for security.
pub fn write_server_config(port: u16, token: &str) -> Result<(), String> {
    let config_path = config_dir().ok_or("Failed to get config directory")?;

    // Ensure config directory exists
    fs::create_dir_all(&config_path)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    // Write port file
    let port_path = config_path.join("server.port");
    fs::write(&port_path, port.to_string())
        .map_err(|e| format!("Failed to write port file: {}", e))?;

    // Write token file with mode 600
    let token_path = config_path.join("server.token");
    let mut file =
        fs::File::create(&token_path).map_err(|e| format!("Failed to create token file: {}", e))?;
    file.write_all(token.as_bytes())
        .map_err(|e| format!("Failed to write token file: {}", e))?;

    // Set file permissions to 600 (owner read/write only) — Unix only
    #[cfg(unix)]
    {
        let mut perms = file
            .metadata()
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        file.set_permissions(perms)
            .map_err(|e| format!("Failed to set token file permissions: {}", e))?;
    }

    Ok(())
}

/// Remove server config files on shutdown.
pub fn cleanup_server_config() {
    if let Some(config_path) = config_dir() {
        let _ = fs::remove_file(config_path.join("server.port"));
        let _ = fs::remove_file(config_path.join("server.token"));
    }
}

/// Token validation middleware.
async fn validate_token(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let token_header = request
        .headers()
        .get("X-MDPRO-Token")
        .and_then(|v| v.to_str().ok());

    let expected_token = state
        .server_config
        .lock()
        .ok()
        .and_then(|c| c.as_ref().map(|cfg| cfg.token.clone()));

    /// Constant-time byte equality to prevent timing side-channels on the auth token.
    fn constant_time_eq(a: &str, b: &str) -> bool {
        let a = a.as_bytes();
        let b = b.as_bytes();
        if a.len() != b.len() {
            return false;
        }
        a.iter()
            .zip(b.iter())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
    }

    match (token_header, expected_token) {
        (Some(provided), Some(ref expected)) if constant_time_eq(provided, expected) => {
            next.run(request).await
        }
        _ => {
            let error = ErrorResponse {
                error: "Invalid or missing authentication token".to_string(),
                code: Some("UNAUTHORIZED".to_string()),
            };
            (StatusCode::UNAUTHORIZED, Json(error)).into_response()
        }
    }
}

/// Origin validation middleware (DNS rebinding protection).
async fn validate_origin(request: Request<Body>, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());

    // Allow requests without Origin header (same-origin, curl, mdpro-mcp binary).
    // Reject "null" origins — these come from sandboxed iframes or data: pages
    // and provide no DNS-rebinding protection when accepted.
    let is_valid = match origin {
        None => true,
        Some("null") => false,
        Some(o) => {
            o.starts_with("http://127.0.0.1")
                || o.starts_with("http://localhost")
                || o.starts_with("https://127.0.0.1")
                || o.starts_with("https://localhost")
        }
    };

    if is_valid {
        next.run(request).await
    } else {
        let error = ErrorResponse {
            error: "Invalid origin".to_string(),
            code: Some("FORBIDDEN".to_string()),
        };
        (StatusCode::FORBIDDEN, Json(error)).into_response()
    }
}

/// GET /api/status - Get application status.
async fn get_status(State(state): State<AppState>) -> impl IntoResponse {
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store).unwrap_or(false);

    Json(StatusResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        window_focused,
    })
}

/// GET /api/documents - List all open documents.
async fn list_documents(State(state): State<AppState>) -> impl IntoResponse {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.list".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: None,
        duration_ms: None,
        error: None,
    });

    match shadow_store::get_all_documents(&state.shadow_store) {
        Ok(docs) => {
            let info: Vec<DocumentInfo> = docs.iter().map(DocumentInfo::from).collect();
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "mcp.list".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({ "documentCount": info.len() })),
                duration_ms: None,
                error: None,
            });
            (StatusCode::OK, Json(info)).into_response()
        }
        Err(e) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Error,
                event: "mcp.list".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: None,
                duration_ms: None,
                error: Some(e.clone()),
            });
            let error = ErrorResponse {
                error: e,
                code: Some("INTERNAL_ERROR".to_string()),
            };
            (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response()
        }
    }
}

/// GET /api/documents/:id - Get document content.
async fn get_document(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.read".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(json!({ "documentId": id })),
        duration_ms: None,
        error: None,
    });

    match shadow_store::get_document(&state.shadow_store, &id) {
        Ok(Some(doc)) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "mcp.read".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({ "documentId": id, "contentLength": doc.content.len() })),
                duration_ms: None,
                error: None,
            });
            let content = DocumentContent {
                content: doc.content,
                cursor: doc.cursor,
            };
            (StatusCode::OK, Json(content)).into_response()
        }
        Ok(None) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Warn,
                event: "mcp.read".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id })),
                duration_ms: None,
                error: Some("Document not found".to_string()),
            });
            let error = ErrorResponse {
                error: format!("Document not found: {}", id),
                code: Some("NOT_FOUND".to_string()),
            };
            (StatusCode::NOT_FOUND, Json(error)).into_response()
        }
        Err(e) => {
            let error = ErrorResponse {
                error: e,
                code: Some("INTERNAL_ERROR".to_string()),
            };
            (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response()
        }
    }
}

/// POST /api/documents/:id - Update document content (full replacement).
async fn update_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<UpdateDocumentRequest>,
) -> impl IntoResponse {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.write".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(json!({ "documentId": id, "contentLength": request.content.len() })),
        duration_ms: None,
        error: None,
    });

    // Check if document exists
    let doc = match shadow_store::get_document(&state.shadow_store, &id) {
        Ok(Some(doc)) => doc,
        Ok(None) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Warn,
                event: "mcp.write".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id })),
                duration_ms: None,
                error: Some("Document not found".to_string()),
            });
            let error = ErrorResponse {
                error: format!("Document not found: {}", id),
                code: Some("NOT_FOUND".to_string()),
            };
            return (StatusCode::NOT_FOUND, Json(error)).into_response();
        }
        Err(e) => {
            let error = ErrorResponse {
                error: e,
                code: Some("INTERNAL_ERROR".to_string()),
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
        }
    };

    // Check if we need user confirmation (window not focused)
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store).unwrap_or(false);

    if !window_focused {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "mcp.confirm".to_string(),
            status: LogStatus::Start,
            action_id: None,
            context: Some(json!({ "documentId": id, "documentTitle": doc.title })),
            duration_ms: None,
            error: None,
        });

        // Show confirmation dialog on a blocking thread so the async
        // HTTP handler stays free to serve other requests (#237).
        let title_owned = doc.title.clone();
        let confirmed = tokio::task::spawn_blocking(move || show_write_confirmation(&title_owned))
            .await
            .unwrap_or(false);
        if !confirmed {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "mcp.confirm".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id, "userRejected": true })),
                duration_ms: None,
                error: Some("User rejected".to_string()),
            });
            let error = ErrorResponse {
                error: "User rejected write operation".to_string(),
                code: Some("USER_REJECTED".to_string()),
            };
            return (StatusCode::FORBIDDEN, Json(error)).into_response();
        }
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "mcp.confirm".to_string(),
            status: LogStatus::Success,
            action_id: None,
            context: Some(json!({ "documentId": id })),
            duration_ms: None,
            error: None,
        });
    }

    // Re-validate document after potentially long-running dialog (TOCTOU fix #238).
    let doc = match shadow_store::get_document(&state.shadow_store, &id) {
        Ok(Some(doc)) => doc,
        Ok(None) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Warn,
                event: "mcp.write".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id })),
                duration_ms: None,
                error: Some("Document closed during confirmation".to_string()),
            });
            let error = ErrorResponse {
                error: format!("Document closed during confirmation: {}", id),
                code: Some("NOT_FOUND".to_string()),
            };
            return (StatusCode::NOT_FOUND, Json(error)).into_response();
        }
        Err(e) => {
            let error = ErrorResponse {
                error: e,
                code: Some("INTERNAL_ERROR".to_string()),
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
        }
    };

    let window_label = shadow_store::get_window_for_document(&state.shadow_store, &id)
        .ok()
        .flatten();

    // Save original content for rollback in case emit fails (fixes #243).
    let original_content = doc.content.clone();

    // Optimistically update shadow store BEFORE emitting to frontend,
    // so subsequent reads return new content even if the frontend
    // hasn't processed the event yet (fixes #141 stale-read window).
    let content_clone = request.content.clone();
    match shadow_store::update_document_content(&state.shadow_store, &id, content_clone) {
        Ok(true) => {}
        Ok(false) => {
            // Document closed in the residual window between re-validation and
            // this update — fail closed rather than emit a write for a gone doc.
            logger::log_event(LogEntryPayload {
                level: LogLevel::Warn,
                event: "mcp.write".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id })),
                duration_ms: None,
                error: Some("Document closed before content update".to_string()),
            });
            let error = ErrorResponse {
                error: format!("Document closed before content update: {}", id),
                code: Some("NOT_FOUND".to_string()),
            };
            return (StatusCode::NOT_FOUND, Json(error)).into_response();
        }
        Err(e) => {
            let error = ErrorResponse {
                error: e,
                code: Some("INTERNAL_ERROR".to_string()),
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
        }
    }

    // Emit event to frontend to update the document
    let event = WriteDocumentEvent {
        document_id: id.clone(),
        content: request.content,
        window_label,
    };

    if let Err(e) = state.app_handle.emit("mcp:write_document", &event) {
        // Roll back the shadow store so it doesn't diverge from the editor (#243).
        let rollback_status =
            match shadow_store::update_document_content(&state.shadow_store, &id, original_content)
            {
                Ok(true) => "rolled back",
                Ok(false) => "not rolled back: document not found",
                Err(_) => "not rolled back: mutex error",
            };
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "mcp.write".to_string(),
            status: LogStatus::Fail,
            action_id: None,
            context: Some(
                json!({ "documentId": id, "reason": format!("emit failed, shadow store {rollback_status}") }),
            ),
            duration_ms: None,
            error: Some(e.to_string()),
        });
        let error = ErrorResponse {
            error: format!("Failed to emit write event: {}", e),
            code: Some("EMIT_FAILED".to_string()),
        };
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
    }

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.write".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({ "documentId": id })),
        duration_ms: None,
        error: None,
    });

    (StatusCode::OK, Json(WriteResult { success: true })).into_response()
}

/// POST /api/documents/:id/insert - Insert content at position.
async fn insert_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<InsertContentRequest>,
) -> impl IntoResponse {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.insert".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(json!({ "documentId": id, "textLength": request.text.len() })),
        duration_ms: None,
        error: None,
    });

    // Check if document exists
    let doc = match shadow_store::get_document(&state.shadow_store, &id) {
        Ok(Some(doc)) => doc,
        Ok(None) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Warn,
                event: "mcp.insert".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id })),
                duration_ms: None,
                error: Some("Document not found".to_string()),
            });
            let error = ErrorResponse {
                error: format!("Document not found: {}", id),
                code: Some("NOT_FOUND".to_string()),
            };
            return (StatusCode::NOT_FOUND, Json(error)).into_response();
        }
        Err(e) => {
            let error = ErrorResponse {
                error: e,
                code: Some("INTERNAL_ERROR".to_string()),
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
        }
    };

    // Check if we need user confirmation (window not focused) — fixes #356.
    // Same guard as update_document: prevents silent content injection when
    // the user is not looking at the app.
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store).unwrap_or(false);

    if !window_focused {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "mcp.insert.confirm".to_string(),
            status: LogStatus::Start,
            action_id: None,
            context: Some(json!({ "documentId": id, "documentTitle": doc.title })),
            duration_ms: None,
            error: None,
        });

        let title_owned = doc.title.clone();
        let confirmed = tokio::task::spawn_blocking(move || show_write_confirmation(&title_owned))
            .await
            .unwrap_or(false);
        if !confirmed {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "mcp.insert.confirm".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": id, "userRejected": true })),
                duration_ms: None,
                error: Some("User rejected".to_string()),
            });
            let error = ErrorResponse {
                error: "User rejected insert operation".to_string(),
                code: Some("USER_REJECTED".to_string()),
            };
            return (StatusCode::FORBIDDEN, Json(error)).into_response();
        }
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "mcp.insert.confirm".to_string(),
            status: LogStatus::Success,
            action_id: None,
            context: Some(json!({ "documentId": id })),
            duration_ms: None,
            error: None,
        });
    }

    let (insert_offset, new_cursor) =
        resolve_insert(&doc.content, doc.cursor, &request.position, &request.text);

    // Get the window label for the document
    let window_label = shadow_store::get_window_for_document(&state.shadow_store, &id)
        .ok()
        .flatten();

    // Save original content for rollback in case emit fails (fixes #243).
    let original_content = doc.content.clone();

    // Compute new content and optimistically update shadow store BEFORE
    // emitting to frontend, so subsequent reads return new content even
    // if the frontend hasn't processed the event yet (fixes #141).
    let mut new_content = doc.content.clone();
    new_content.insert_str(insert_offset, &request.text);
    let _ = shadow_store::update_document_content(&state.shadow_store, &id, new_content);

    // Emit event to frontend
    let event = InsertContentEvent {
        document_id: id.clone(),
        text: request.text,
        position: request.position,
        window_label,
    };

    if let Err(e) = state.app_handle.emit("mcp:insert_content", &event) {
        // Roll back the shadow store so it doesn't diverge from the editor (#243).
        let rollback_status =
            match shadow_store::update_document_content(&state.shadow_store, &id, original_content)
            {
                Ok(true) => "rolled back",
                Ok(false) => "not rolled back: document not found",
                Err(_) => "not rolled back: mutex error",
            };
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "mcp.insert".to_string(),
            status: LogStatus::Fail,
            action_id: None,
            context: Some(
                json!({ "documentId": id, "reason": format!("emit failed, shadow store {rollback_status}") }),
            ),
            duration_ms: None,
            error: Some(e.to_string()),
        });
        let error = ErrorResponse {
            error: format!("Failed to emit insert event: {}", e),
            code: Some("EMIT_FAILED".to_string()),
        };
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
    }

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.insert".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(
            json!({ "documentId": id, "insertOffset": insert_offset, "newCursor": new_cursor }),
        ),
        duration_ms: None,
        error: None,
    });

    (
        StatusCode::OK,
        Json(InsertResult {
            success: true,
            new_cursor,
        }),
    )
        .into_response()
}

/// POST /api/documents/new - Create a new document.
async fn create_document(
    State(state): State<AppState>,
    Json(request): Json<CreateDocumentRequest>,
) -> impl IntoResponse {
    // Generate a new document ID
    let id = uuid::Uuid::new_v4().to_string();

    // Emit event to frontend to create the document
    // For now, we use write_document event with a special marker
    let event = WriteDocumentEvent {
        document_id: id.clone(),
        content: request.content,
        window_label: None, // Will be created in the focused window
    };

    if let Err(e) = state.app_handle.emit("mcp:create_document", &event) {
        let error = ErrorResponse {
            error: format!("Failed to emit create event: {}", e),
            code: Some("EMIT_FAILED".to_string()),
        };
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
    }

    (StatusCode::CREATED, Json(CreateDocumentResponse { id })).into_response()
}

// ---------------------------------------------------------------------------
// Phase 3 WI-3.3 — Table action routes (frontend-driven)
// ---------------------------------------------------------------------------
//
// Each route validates the high-level intent, confirms the document
// exists in the shadow store, and emits `mcp:table_action`. The
// frontend's `useMcpEvents` handler computes the new content via the
// shared TS `tableParser` / `tableEdits` machinery and pushes it back
// to the shadow store via the existing `useMcpSync` debounce. Rust
// returns 202 Accepted; the MCP client can confirm with a follow-up
// `read_document` call.

#[derive(serde::Serialize)]
struct TableActionEvent {
    document_id: String,
    action: String,
    payload: serde_json::Value,
    window_label: Option<String>,
}

/// Common helper — verifies the document, runs the focus-confirmation
/// flow if the app is backgrounded, and emits the event to the
/// document's owning window.
///
/// Audit-fix H1 (2026-05-04): mirror the focus + confirmation guard
/// used by `update_document` / `insert_content`. Without this, a
/// local process with the token can mutate user documents silently
/// while the app is in the background.
///
/// Audit-fix M1 (2026-05-04): populate `window_label` via
/// `get_window_for_document` so the event reaches the owning window
/// only — non-owning windows previously logged spurious "not found".
async fn dispatch_table_action(
    state: &AppState,
    document_id: &str,
    action: &str,
    payload: serde_json::Value,
) -> Response {
    let doc = match shadow_store::get_document(&state.shadow_store, document_id) {
        Ok(Some(d)) => d,
        Ok(None) => {
            let error = ErrorResponse {
                error: format!("Document not found: {}", document_id),
                code: Some("NOT_FOUND".to_string()),
            };
            return (StatusCode::NOT_FOUND, Json(error)).into_response();
        }
        Err(e) => {
            let error = ErrorResponse {
                error: format!("Shadow store read failed: {}", e),
                code: Some("STORE_ERROR".to_string()),
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
        }
    };

    // Confirmation guard for backgrounded app.
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store).unwrap_or(false);
    if !window_focused {
        let title_owned = doc.title.clone();
        let confirmed = tokio::task::spawn_blocking(move || show_write_confirmation(&title_owned))
            .await
            .unwrap_or(false);
        if !confirmed {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: format!("mcp.table.{}", action),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "documentId": document_id, "userRejected": true })),
                duration_ms: None,
                error: Some("User rejected".to_string()),
            });
            let error = ErrorResponse {
                error: "User rejected write operation".to_string(),
                code: Some("USER_REJECTED".to_string()),
            };
            return (StatusCode::FORBIDDEN, Json(error)).into_response();
        }
    }

    let window_label = shadow_store::get_window_for_document(&state.shadow_store, document_id)
        .ok()
        .flatten();

    let event = TableActionEvent {
        document_id: document_id.to_string(),
        action: action.to_string(),
        payload,
        window_label,
    };

    if let Err(e) = state.app_handle.emit("mcp:table_action", &event) {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: format!("mcp.table.{}", action),
            status: LogStatus::Fail,
            action_id: None,
            context: Some(json!({ "documentId": document_id })),
            duration_ms: None,
            error: Some(e.to_string()),
        });
        let error = ErrorResponse {
            error: format!("Failed to emit table action event: {}", e),
            code: Some("EMIT_FAILED".to_string()),
        };
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
    }

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: format!("mcp.table.{}", action),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({ "documentId": document_id })),
        duration_ms: None,
        error: None,
    });

    (StatusCode::ACCEPTED, Json(json!({ "scheduled": true }))).into_response()
}

#[derive(serde::Deserialize)]
struct InsertTableRequest {
    document_id: String,
    rows: u32,
    cols: u32,
    #[serde(default)]
    alignments: Option<Vec<String>>,
}

async fn insert_table(
    State(state): State<AppState>,
    Json(req): Json<InsertTableRequest>,
) -> impl IntoResponse {
    if req.rows == 0 || req.cols == 0 {
        let error = ErrorResponse {
            error: "rows and cols must be > 0".to_string(),
            code: Some("INVALID_PAYLOAD".to_string()),
        };
        return (StatusCode::BAD_REQUEST, Json(error)).into_response();
    }
    let mut payload = json!({ "rows": req.rows, "cols": req.cols });
    if let Some(aligns) = req.alignments {
        payload["alignments"] = json!(aligns);
    }
    dispatch_table_action(&state, &req.document_id, "insert_table", payload).await
}

#[derive(serde::Deserialize)]
struct SetCellRequest {
    document_id: String,
    #[serde(default)]
    table_index: Option<u32>,
    row: u32,
    col: u32,
    content: String,
}

async fn set_cell(
    State(state): State<AppState>,
    Json(req): Json<SetCellRequest>,
) -> impl IntoResponse {
    let mut payload = json!({ "row": req.row, "col": req.col, "content": req.content });
    if let Some(idx) = req.table_index {
        payload["tableIndex"] = json!(idx);
    }
    dispatch_table_action(&state, &req.document_id, "set_cell", payload).await
}

#[derive(serde::Deserialize)]
struct AddRowRequest {
    document_id: String,
    #[serde(default)]
    table_index: Option<u32>,
    after: u32,
}

async fn add_row(
    State(state): State<AppState>,
    Json(req): Json<AddRowRequest>,
) -> impl IntoResponse {
    let mut payload = json!({ "after": req.after });
    if let Some(idx) = req.table_index {
        payload["tableIndex"] = json!(idx);
    }
    dispatch_table_action(&state, &req.document_id, "add_row", payload).await
}

#[derive(serde::Deserialize)]
struct DeleteRowRequest {
    document_id: String,
    #[serde(default)]
    table_index: Option<u32>,
    index: u32,
}

async fn delete_row(
    State(state): State<AppState>,
    Json(req): Json<DeleteRowRequest>,
) -> impl IntoResponse {
    let mut payload = json!({ "index": req.index });
    if let Some(idx) = req.table_index {
        payload["tableIndex"] = json!(idx);
    }
    dispatch_table_action(&state, &req.document_id, "delete_row", payload).await
}

#[derive(serde::Deserialize)]
struct AddColumnRequest {
    document_id: String,
    #[serde(default)]
    table_index: Option<u32>,
    after: u32,
}

async fn add_column(
    State(state): State<AppState>,
    Json(req): Json<AddColumnRequest>,
) -> impl IntoResponse {
    let mut payload = json!({ "after": req.after });
    if let Some(idx) = req.table_index {
        payload["tableIndex"] = json!(idx);
    }
    dispatch_table_action(&state, &req.document_id, "add_column", payload).await
}

#[derive(serde::Deserialize)]
struct DeleteColumnRequest {
    document_id: String,
    #[serde(default)]
    table_index: Option<u32>,
    index: u32,
}

async fn delete_column(
    State(state): State<AppState>,
    Json(req): Json<DeleteColumnRequest>,
) -> impl IntoResponse {
    let mut payload = json!({ "index": req.index });
    if let Some(idx) = req.table_index {
        payload["tableIndex"] = json!(idx);
    }
    dispatch_table_action(&state, &req.document_id, "delete_column", payload).await
}

/// Show a native confirmation dialog for write operations.
fn show_write_confirmation(document_title: &str) -> bool {
    let result = rfd::MessageDialog::new()
        .set_title("mdpro - Write Confirmation")
        .set_description(format!(
            "An external tool wants to replace the content of \"{}\".",
            document_title
        ))
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();

    matches!(result, rfd::MessageDialogResult::Yes)
}

/// Create the axum router with all routes and middleware.
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/documents", get(list_documents))
        .route("/api/documents/new", post(create_document))
        .route(
            "/api/documents/{id}",
            get(get_document).post(update_document),
        )
        .route("/api/documents/{id}/insert", post(insert_content))
        // Phase 3 WI-3.3 — Table tools (frontend-driven)
        .route("/api/v1/insert_table", post(insert_table))
        .route("/api/v1/set_cell", post(set_cell))
        .route("/api/v1/add_row", post(add_row))
        .route("/api/v1/delete_row", post(delete_row))
        .route("/api/v1/add_column", post(add_column))
        .route("/api/v1/delete_column", post(delete_column))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            validate_token,
        ))
        .layer(middleware::from_fn(validate_origin))
        .with_state(state)
}

/// Default port for MCP HTTP server
const MCP_SERVER_PORT: u16 = 55045;

/// Start the HTTP server on the configured port.
///
/// Returns the port number and a shutdown signal sender.
pub async fn start_server(
    shadow_store: SharedShadowStore,
    server_config: SharedServerConfig,
    app_handle: AppHandle,
) -> Result<(u16, oneshot::Sender<()>), String> {
    // Generate token
    let token = generate_token();

    // Bind to the configured port on localhost
    let listener = TcpListener::bind(format!("127.0.0.1:{}", MCP_SERVER_PORT))
        .await
        .map_err(|e| {
            format!(
                "Failed to bind HTTP server on port {}: {}",
                MCP_SERVER_PORT, e
            )
        })?;

    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;
    let port = addr.port();

    // Store config
    {
        let mut config = server_config
            .lock()
            .map_err(|e| format!("Failed to lock server config: {}", e))?;
        *config = Some(ServerConfig {
            port,
            token: token.clone(),
        });
    }

    // Write config files to disk
    write_server_config(port, &token)?;

    // Create app state
    let state = AppState {
        shadow_store,
        server_config,
        app_handle,
    };

    // Create router
    let app = create_router(state);

    // Create shutdown channel
    let (tx, rx) = oneshot::channel::<()>();

    // Spawn server task using Tauri's async runtime
    tauri::async_runtime::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await
            .ok();
    });

    Ok((port, tx))
}

// We need hex encoding for the token
mod hex {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

    pub fn encode(bytes: &[u8]) -> String {
        let mut result = String::with_capacity(bytes.len() * 2);
        for &byte in bytes {
            result.push(HEX_CHARS[(byte >> 4) as usize] as char);
            result.push(HEX_CHARS[(byte & 0x0f) as usize] as char);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_ascii_offset_unchanged() {
        assert_eq!(snap_to_char_boundary("hello", 3), 3);
    }

    #[test]
    fn snap_at_start() {
        assert_eq!(snap_to_char_boundary("hello", 0), 0);
    }

    #[test]
    fn snap_at_end() {
        assert_eq!(snap_to_char_boundary("hello", 5), 5);
    }

    #[test]
    fn snap_beyond_end_clamps() {
        assert_eq!(snap_to_char_boundary("hello", 100), 5);
    }

    #[test]
    fn snap_mid_multibyte_rounds_down() {
        // "é" is 2 bytes in UTF-8: [0xC3, 0xA9]
        let s = "café";
        // "caf" = 3 bytes, "é" starts at byte 3
        // offset 4 is mid-char (second byte of é)
        assert_eq!(snap_to_char_boundary(s, 4), 3);
    }

    #[test]
    fn snap_on_char_boundary_stays() {
        let s = "café";
        assert_eq!(snap_to_char_boundary(s, 3), 3); // start of é
        assert_eq!(snap_to_char_boundary(s, 5), 5); // after é
    }

    #[test]
    fn snap_cjk_mid_char() {
        // "你好" — each char is 3 bytes
        let s = "你好";
        assert_eq!(snap_to_char_boundary(s, 1), 0); // mid first char → snap to 0
        assert_eq!(snap_to_char_boundary(s, 2), 0); // mid first char → snap to 0
        assert_eq!(snap_to_char_boundary(s, 3), 3); // boundary between chars
        assert_eq!(snap_to_char_boundary(s, 4), 3); // mid second char → snap to 3
        assert_eq!(snap_to_char_boundary(s, 5), 3); // mid second char → snap to 3
        assert_eq!(snap_to_char_boundary(s, 6), 6); // end
    }

    #[test]
    fn snap_emoji_mid_char() {
        // "😀" is 4 bytes
        let s = "a😀b";
        assert_eq!(snap_to_char_boundary(s, 1), 1); // between a and emoji
        assert_eq!(snap_to_char_boundary(s, 2), 1); // mid emoji → snap to 1
        assert_eq!(snap_to_char_boundary(s, 3), 1); // mid emoji → snap to 1
        assert_eq!(snap_to_char_boundary(s, 4), 1); // mid emoji → snap to 1
        assert_eq!(snap_to_char_boundary(s, 5), 5); // start of b
    }

    #[test]
    fn snap_empty_string() {
        assert_eq!(snap_to_char_boundary("", 0), 0);
        assert_eq!(snap_to_char_boundary("", 5), 0);
    }

    // These five predate ADR-0021 and were written against the scalar-based
    // `char_offset_to_byte`. Every input is BMP, where a scalar and a UTF-16
    // code unit are the same thing, so re-pointing them at the new converter
    // changed the name and nothing else — which is the evidence that the unit
    // change is invisible below the astral plane.
    #[test]
    fn char_offset_ascii() {
        assert_eq!(utf16_offset_to_byte("hello", 0), 0);
        assert_eq!(utf16_offset_to_byte("hello", 3), 3);
        assert_eq!(utf16_offset_to_byte("hello", 5), 5);
    }

    #[test]
    fn char_offset_cjk() {
        let s = "你好世界"; // 4 chars, 12 bytes
        assert_eq!(utf16_offset_to_byte(s, 0), 0);
        assert_eq!(utf16_offset_to_byte(s, 1), 3);
        assert_eq!(utf16_offset_to_byte(s, 2), 6);
        assert_eq!(utf16_offset_to_byte(s, 3), 9);
        assert_eq!(utf16_offset_to_byte(s, 4), 12);
    }

    #[test]
    fn char_offset_mixed() {
        let s = "café"; // c(1) a(1) f(1) é(2) = 5 bytes, 4 chars
        assert_eq!(utf16_offset_to_byte(s, 3), 3); // start of é
        assert_eq!(utf16_offset_to_byte(s, 4), 5); // end
    }

    #[test]
    fn char_offset_beyond_length() {
        assert_eq!(utf16_offset_to_byte("hi", 100), 2);
    }

    #[test]
    fn char_offset_empty() {
        assert_eq!(utf16_offset_to_byte("", 0), 0);
        assert_eq!(utf16_offset_to_byte("", 5), 0);
    }

    // ---- D10: MCP document offsets are UTF-16 code units (ADR-0021) -------
    //
    // The unit was never actually decided. specs/007-mcp-server/data-model.md:27
    // calls `cursor` a "character offset from start"; seventeen lines later :44
    // bounds it by `content.len()`, which is BYTES. Rust settled on Unicode
    // scalars (`char_indices().nth`), the frontend on UTF-16 code units (JS
    // string indexing, CodeMirror positions). ADR-0021 picks UTF-16 and makes
    // Rust the side that converts.
    //
    // Every pre-existing test of this code uses BMP text ("hello", "你好世界",
    // "café"), where scalars and UTF-16 units agree exactly — which is why this
    // survived. The cases below are the ones that can tell them apart.

    fn offset_of(content: &str, position: InsertPosition, text: &str) -> (usize, usize) {
        resolve_insert(content, 0, &position, text)
    }

    #[test]
    fn m1_ascii_is_unaffected_by_the_unit_change() {
        // Premise guard. On ASCII, bytes, scalars and UTF-16 units all coincide,
        // so this case passes both before and after — its job is to catch a
        // "fix" that breaks the overwhelmingly common path.
        assert_eq!(offset_of("hello", InsertPosition::Offset(2), "XY"), (2, 4));
    }

    #[test]
    fn m2_a_multibyte_char_before_the_insert_point_does_not_inflate_the_cursor() {
        // REGRESSION — D10(a). `new_cursor` was `insert_offset + text.len()`,
        // both byte counts, published as a character offset. "é" is 2 bytes and
        // 1 UTF-16 unit, so the reported cursor drifted by one per non-ASCII
        // character preceding the insertion. A client feeding the value back as
        // an Offset inserts in the wrong place, and the drift compounds.
        let (byte_offset, new_cursor) = offset_of("héllo", InsertPosition::Offset(2), "X");

        assert_eq!(byte_offset, 3, "h=1 byte + é=2 bytes");
        assert_eq!(
            new_cursor, 3,
            "after 'h', 'é', 'X' the cursor is at UTF-16 offset 3, not 4 — \
             4 is what you get by adding byte counts"
        );
    }

    #[test]
    fn m3_an_astral_char_resolves_to_the_utf16_position_not_the_scalar_one() {
        // REGRESSION — D10(b). "😀" is ONE scalar and TWO UTF-16 units. Under
        // scalar indexing, offset 2 is the 'b'; under UTF-16 it is the position
        // immediately after the emoji. Rust and the frontend therefore inserted
        // the same text at DIFFERENT places in the same document — the shadow
        // store and the editor genuinely diverge, not just the reported number.
        let (byte_offset, new_cursor) = offset_of("😀ab", InsertPosition::Offset(2), "X");

        assert_eq!(
            byte_offset, 4,
            "UTF-16 offset 2 is just past the emoji (4 bytes), not past 'a'"
        );
        assert_eq!(new_cursor, 3, "2 units of emoji + 1 of 'X'");
    }

    #[test]
    fn m4_an_offset_inside_a_surrogate_pair_snaps_down_to_the_character_start() {
        // A position inside a character is not a position. Snapping DOWN matches
        // what snap_to_char_boundary already does for mid-UTF-8-sequence bytes;
        // snapping up would move the insert past a character the client named.
        let (byte_offset, new_cursor) = offset_of("😀ab", InsertPosition::Offset(1), "X");

        assert_eq!(byte_offset, 0, "offset 1 splits the emoji's surrogate pair");
        assert_eq!(new_cursor, 1, "insert lands at 0, 'X' is 1 unit wide");
    }

    #[test]
    fn m5_the_inserted_text_is_measured_in_utf16_units_not_bytes() {
        // The other half of D10(a): the ADDEND was also a byte count. An emoji
        // is 4 bytes and 2 UTF-16 units, so inserting one overstated the cursor
        // by 2 even on otherwise pure-ASCII content.
        let (_, new_cursor) = offset_of("abc", InsertPosition::Offset(1), "😀");

        assert_eq!(new_cursor, 3, "1 unit of 'a' + 2 units of emoji, not 1 + 4");
    }

    #[test]
    fn m6_end_of_an_astral_document_reports_the_utf16_length() {
        let (byte_offset, new_cursor) = offset_of("😀😀", InsertPosition::End, "!");

        assert_eq!(byte_offset, 8, "two 4-byte emoji");
        assert_eq!(new_cursor, 5, "two emoji are 4 UTF-16 units, plus '!'");
    }

    #[test]
    fn m7_the_stored_cursor_is_read_in_the_same_unit() {
        // InsertPosition::Cursor must not be a second unit convention.
        let (byte_offset, new_cursor) = resolve_insert("😀ab", 2, &InsertPosition::Cursor, "X");

        assert_eq!(byte_offset, 4);
        assert_eq!(new_cursor, 3);
    }

    #[test]
    fn m8_start_is_always_zero_and_an_out_of_range_offset_clamps_to_the_end() {
        assert_eq!(offset_of("😀ab", InsertPosition::Start, "X"), (0, 1));
        assert_eq!(
            offset_of("😀ab", InsertPosition::Offset(999), "X"),
            (6, 5),
            "clamp to end: 6 bytes (4 emoji + a + b); in UTF-16 that is 4 units \
             (the emoji is TWO), plus 1 for 'X'"
        );
    }

    #[test]
    fn m9_empty_content_is_handled_at_every_position() {
        for position in [
            InsertPosition::Start,
            InsertPosition::End,
            InsertPosition::Cursor,
            InsertPosition::Offset(0),
            InsertPosition::Offset(7),
        ] {
            assert_eq!(offset_of("", position, "hi"), (0, 2));
        }
    }

    #[test]
    fn m10_the_two_conversions_are_inverses_at_every_character_boundary() {
        // The law. Without it the pair could be consistently wrong in the same
        // direction and every example case above would still pass.
        let samples = ["", "hello", "héllo", "你好世界", "😀ab", "a😀b😀", "é😀é"];

        for s in samples {
            let total_units: usize = s.chars().map(char::len_utf16).sum();
            let mut units = 0usize;

            for (byte_idx, ch) in s.char_indices() {
                let back = utf16_offset_to_byte(s, units);
                assert_eq!(
                    back, byte_idx,
                    "utf16 {units} of {s:?} should be byte {byte_idx}"
                );
                assert_eq!(
                    byte_offset_to_utf16(s, byte_idx),
                    units,
                    "byte {byte_idx} of {s:?} should be utf16 {units}"
                );
                units += ch.len_utf16();
            }

            assert_eq!(units, total_units);
            assert_eq!(
                utf16_offset_to_byte(s, total_units),
                s.len(),
                "end of {s:?}"
            );
            assert_eq!(
                byte_offset_to_utf16(s, s.len()),
                total_units,
                "end of {s:?}"
            );
        }
    }

    #[test]
    fn insert_str_does_not_panic_after_snap() {
        let s = "你好世界"; // 12 bytes
        for offset in 0..=15 {
            let snapped = snap_to_char_boundary(s, offset);
            let mut copy = s.to_string();
            copy.insert(snapped, 'X'); // must not panic
        }
    }

    // -----------------------------------------------------------------------
    // Phase 3 WI-3.3 — Table route request schemas (audit fix H5)
    //
    // Full router-integration tests against a fixture AppHandle would
    // require enabling Tauri's `test` feature in dev-dependencies; the
    // tests below exercise the JSON-contract surface (serde
    // deserialization + payload validation) without that overhead.
    // Tracked as a follow-up: full axum oneshot tests via tauri::test.
    // -----------------------------------------------------------------------

    #[test]
    fn insert_table_request_deserialize_minimal() {
        let json = r#"{"document_id":"doc-1","rows":2,"cols":3}"#;
        let req: InsertTableRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.document_id, "doc-1");
        assert_eq!(req.rows, 2);
        assert_eq!(req.cols, 3);
        assert!(req.alignments.is_none());
    }

    #[test]
    fn insert_table_request_deserialize_with_alignments() {
        let json =
            r#"{"document_id":"d","rows":1,"cols":3,"alignments":["left","center","right"]}"#;
        let req: InsertTableRequest = serde_json::from_str(json).unwrap();
        let aligns = req.alignments.unwrap();
        assert_eq!(aligns, vec!["left", "center", "right"]);
    }

    #[test]
    fn insert_table_request_rejects_missing_required_fields() {
        // Missing rows.
        assert!(
            serde_json::from_str::<InsertTableRequest>(r#"{"document_id":"d","cols":3}"#).is_err()
        );
        // Missing cols.
        assert!(
            serde_json::from_str::<InsertTableRequest>(r#"{"document_id":"d","rows":3}"#).is_err()
        );
    }

    #[test]
    fn set_cell_request_deserialize_minimal() {
        let json = r#"{"document_id":"d","row":1,"col":2,"content":"hello"}"#;
        let req: SetCellRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.row, 1);
        assert_eq!(req.col, 2);
        assert_eq!(req.content, "hello");
        assert!(req.table_index.is_none());
    }

    #[test]
    fn set_cell_request_deserialize_with_table_index() {
        let json = r#"{"document_id":"d","table_index":2,"row":0,"col":0,"content":""}"#;
        let req: SetCellRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.table_index, Some(2));
    }

    #[test]
    fn add_row_request_optional_table_index() {
        let no_idx: AddRowRequest =
            serde_json::from_str(r#"{"document_id":"d","after":0}"#).unwrap();
        assert!(no_idx.table_index.is_none());
        let with_idx: AddRowRequest =
            serde_json::from_str(r#"{"document_id":"d","table_index":3,"after":0}"#).unwrap();
        assert_eq!(with_idx.table_index, Some(3));
    }

    #[test]
    fn delete_row_request_requires_index() {
        // `index` is required; missing it must error.
        assert!(serde_json::from_str::<DeleteRowRequest>(r#"{"document_id":"d"}"#).is_err());
        let req: DeleteRowRequest =
            serde_json::from_str(r#"{"document_id":"d","index":5}"#).unwrap();
        assert_eq!(req.index, 5);
    }

    #[test]
    fn add_column_request_optional_table_index() {
        let req: AddColumnRequest =
            serde_json::from_str(r#"{"document_id":"d","after":1}"#).unwrap();
        assert_eq!(req.after, 1);
        assert!(req.table_index.is_none());
    }

    #[test]
    fn delete_column_request_requires_index() {
        assert!(serde_json::from_str::<DeleteColumnRequest>(r#"{"document_id":"d"}"#).is_err());
        let req: DeleteColumnRequest =
            serde_json::from_str(r#"{"document_id":"d","index":2}"#).unwrap();
        assert_eq!(req.index, 2);
    }

    #[test]
    fn set_cell_request_treats_missing_table_index_as_none() {
        // Default-on-missing matches the documented contract: omit
        // table_index → defaults to 0 on the frontend.
        let req: SetCellRequest =
            serde_json::from_str(r#"{"document_id":"d","row":0,"col":0,"content":"x"}"#).unwrap();
        assert!(req.table_index.is_none());
    }

    #[test]
    fn table_action_event_serializes_with_window_label() {
        let event = TableActionEvent {
            document_id: "doc-1".to_string(),
            action: "insert_table".to_string(),
            payload: serde_json::json!({ "rows": 2, "cols": 3 }),
            window_label: Some("main".to_string()),
        };
        let s = serde_json::to_string(&event).unwrap();
        assert!(s.contains("\"document_id\":\"doc-1\""));
        assert!(s.contains("\"action\":\"insert_table\""));
        assert!(s.contains("\"window_label\":\"main\""));
        assert!(s.contains("\"rows\":2"));
    }
}
