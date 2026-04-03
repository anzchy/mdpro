//! HTTP Server for MCP
//!
//! Internal HTTP server that mdpro-mcp uses to communicate with the mdpro app.
//! Only accessible from localhost with token authentication.

use crate::models::{
    CreateDocumentRequest, CreateDocumentResponse, DocumentContent, DocumentInfo,
    ErrorResponse, InsertContentEvent, InsertContentRequest, InsertPosition, InsertResult,
    LogEntryPayload, LogLevel, LogStatus, ServerConfig, SharedServerConfig, SharedShadowStore,
    StatusResponse, UpdateDocumentRequest, WriteDocumentEvent, WriteResult,
};
use crate::services::{logger, shadow_store};
use serde_json::json;
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

/// Convert a character offset to a byte offset in a UTF-8 string.
/// Returns `s.len()` if the character offset is beyond the string length.
fn char_offset_to_byte(s: &str, char_offset: usize) -> usize {
    s.char_indices()
        .nth(char_offset)
        .map(|(byte_idx, _)| byte_idx)
        .unwrap_or(s.len())
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
    let mut file = fs::File::create(&token_path)
        .map_err(|e| format!("Failed to create token file: {}", e))?;
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
        a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
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
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store)
        .unwrap_or(false);

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
async fn get_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
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
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store)
        .unwrap_or(false);

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
        let confirmed = tokio::task::spawn_blocking(move || {
            show_write_confirmation(&title_owned)
        })
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

    // Get the window label for the document
    let window_label = shadow_store::get_window_for_document(&state.shadow_store, &id)
        .ok()
        .flatten();

    // Save original content for rollback in case emit fails (fixes #243).
    let original_content = doc.content.clone();

    // Optimistically update shadow store BEFORE emitting to frontend,
    // so subsequent reads return new content even if the frontend
    // hasn't processed the event yet (fixes #141 stale-read window).
    let content_clone = request.content.clone();
    let _ = shadow_store::update_document_content(&state.shadow_store, &id, content_clone);

    // Emit event to frontend to update the document
    let event = WriteDocumentEvent {
        document_id: id.clone(),
        content: request.content,
        window_label,
    };

    if let Err(e) = state.app_handle.emit("mcp:write_document", &event) {
        // Roll back the shadow store so it doesn't diverge from the editor (#243).
        let rollback_status = match shadow_store::update_document_content(
            &state.shadow_store,
            &id,
            original_content,
        ) {
            Ok(true) => "rolled back",
            Ok(false) => "not rolled back: document not found",
            Err(_) => "not rolled back: mutex error",
        };
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "mcp.write".to_string(),
            status: LogStatus::Fail,
            action_id: None,
            context: Some(json!({ "documentId": id, "reason": format!("emit failed, shadow store {rollback_status}") })),
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
    let window_focused = shadow_store::is_any_window_focused(&state.shadow_store)
        .unwrap_or(false);

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
        let confirmed = tokio::task::spawn_blocking(move || {
            show_write_confirmation(&title_owned)
        })
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

    // Calculate insert byte offset from character offset (per API spec).
    // InsertPosition::Offset and doc.cursor are character offsets; convert
    // to byte offsets for Rust String operations. snap_to_char_boundary is
    // a safety net in case of any remaining mismatch (fixes #345).
    let insert_offset = match &request.position {
        InsertPosition::Cursor => char_offset_to_byte(&doc.content, doc.cursor),
        InsertPosition::Start => 0,
        InsertPosition::End => doc.content.len(),
        InsertPosition::Offset(n) => char_offset_to_byte(&doc.content, *n),
    };
    let insert_offset = snap_to_char_boundary(&doc.content, insert_offset);

    let new_cursor = insert_offset + request.text.len();

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
        let rollback_status = match shadow_store::update_document_content(
            &state.shadow_store,
            &id,
            original_content,
        ) {
            Ok(true) => "rolled back",
            Ok(false) => "not rolled back: document not found",
            Err(_) => "not rolled back: mutex error",
        };
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "mcp.insert".to_string(),
            status: LogStatus::Fail,
            action_id: None,
            context: Some(json!({ "documentId": id, "reason": format!("emit failed, shadow store {rollback_status}") })),
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
        context: Some(json!({ "documentId": id, "insertOffset": insert_offset, "newCursor": new_cursor })),
        duration_ms: None,
        error: None,
    });

    (StatusCode::OK, Json(InsertResult { success: true, new_cursor })).into_response()
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

/// Show a native confirmation dialog for write operations.
fn show_write_confirmation(document_title: &str) -> bool {
    let result = rfd::MessageDialog::new()
        .set_title("mdpro - Write Confirmation")
        .set_description(&format!(
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
        .route("/api/documents/{id}", get(get_document).post(update_document))
        .route("/api/documents/{id}/insert", post(insert_content))
        .layer(middleware::from_fn_with_state(state.clone(), validate_token))
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
        .map_err(|e| format!("Failed to bind HTTP server on port {}: {}", MCP_SERVER_PORT, e))?;

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

    #[test]
    fn char_offset_ascii() {
        assert_eq!(char_offset_to_byte("hello", 0), 0);
        assert_eq!(char_offset_to_byte("hello", 3), 3);
        assert_eq!(char_offset_to_byte("hello", 5), 5);
    }

    #[test]
    fn char_offset_cjk() {
        let s = "你好世界"; // 4 chars, 12 bytes
        assert_eq!(char_offset_to_byte(s, 0), 0);
        assert_eq!(char_offset_to_byte(s, 1), 3);
        assert_eq!(char_offset_to_byte(s, 2), 6);
        assert_eq!(char_offset_to_byte(s, 3), 9);
        assert_eq!(char_offset_to_byte(s, 4), 12);
    }

    #[test]
    fn char_offset_mixed() {
        let s = "café"; // c(1) a(1) f(1) é(2) = 5 bytes, 4 chars
        assert_eq!(char_offset_to_byte(s, 3), 3); // start of é
        assert_eq!(char_offset_to_byte(s, 4), 5); // end
    }

    #[test]
    fn char_offset_beyond_length() {
        assert_eq!(char_offset_to_byte("hi", 100), 2);
    }

    #[test]
    fn char_offset_empty() {
        assert_eq!(char_offset_to_byte("", 0), 0);
        assert_eq!(char_offset_to_byte("", 5), 0);
    }

    #[test]
    fn insert_str_does_not_panic_after_snap() {
        let s = "你好世界"; // 12 bytes
        for offset in 0..=15 {
            let snapped = snap_to_char_boundary(s, offset);
            let mut copy = s.to_string();
            copy.insert_str(snapped, "X"); // must not panic
        }
    }
}
