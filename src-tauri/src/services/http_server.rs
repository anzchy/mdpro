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

/// Get the mdpro config directory (~/.mdpro).
fn config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".mdpro"))
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

    // Set file permissions to 600 (owner read/write only)
    let mut perms = file
        .metadata()
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .permissions();
    perms.set_mode(0o600);
    file.set_permissions(perms)
        .map_err(|e| format!("Failed to set token file permissions: {}", e))?;

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

    match (token_header, expected_token) {
        (Some(provided), Some(expected)) if provided == expected => {
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

    // Allow requests without Origin header (same-origin, curl, etc.)
    // Allow null origin (file:// or no-origin requests)
    // Allow localhost origins
    let is_valid = match origin {
        None => true,
        Some("null") => true,
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

        // Show confirmation dialog
        let confirmed = show_write_confirmation(&doc.title);
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

    // Emit event to frontend to update the document
    let event = WriteDocumentEvent {
        document_id: id.clone(),
        content: request.content,
        window_label,
    };

    if let Err(e) = state.app_handle.emit("mcp:write_document", &event) {
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

    // Calculate new cursor position based on insert position
    let insert_offset = match &request.position {
        InsertPosition::Cursor => doc.cursor,
        InsertPosition::Start => 0,
        InsertPosition::End => doc.content.len(),
        InsertPosition::Offset(n) => (*n).min(doc.content.len()),
    };

    let new_cursor = insert_offset + request.text.len();

    // Get the window label for the document
    let window_label = shadow_store::get_window_for_document(&state.shadow_store, &id)
        .ok()
        .flatten();

    // Emit event to frontend
    let event = InsertContentEvent {
        document_id: id.clone(),
        text: request.text,
        position: request.position,
        window_label,
    };

    if let Err(e) = state.app_handle.emit("mcp:insert_content", &event) {
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
