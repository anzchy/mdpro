//! MCP Commands
//!
//! Tauri IPC commands for MCP integration, including document sync
//! from frontend to Rust Shadow Store.

use crate::models::{SharedShadowStore, SharedServerConfig, SyncDocumentsPayload};
use crate::services::shadow_store;
use tauri::State;

/// Sync document state from frontend to Rust Shadow Store.
///
/// This command is called by the frontend with debounced updates
/// (300ms for content changes, immediate for open/close/switch).
#[tauri::command]
pub async fn mcp_sync_documents(
    state: State<'_, SharedShadowStore>,
    payload: SyncDocumentsPayload,
) -> Result<(), String> {
    shadow_store::sync_documents(&state, payload)
}

/// Get MCP server connection info for debugging/testing.
#[tauri::command]
pub fn mcp_get_server_info(
    state: State<'_, SharedServerConfig>,
) -> Result<Option<ServerInfo>, String> {
    let config = state
        .lock()
        .map_err(|e| format!("Failed to lock server config: {}", e))?;

    Ok(config.as_ref().map(|c| ServerInfo {
        port: c.port,
        token: c.token.clone(),
    }))
}

#[derive(serde::Serialize)]
pub struct ServerInfo {
    pub port: u16,
    pub token: String,
}
