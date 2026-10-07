//! MCP Commands
//!
//! Tauri IPC commands for MCP integration, including document sync
//! from frontend to Rust Shadow Store and MCP client configuration.
//!
//! `mcp_get_status` delegates to `services::mcp_launch::current_status`
//! (ADR-0039; ADR-0040 WI-5): the server's `phase`, `error` and port from the
//! `McpController` snapshot, and the on-disk `mcp.serverEnabled` read fresh on
//! each call (`configured`). A poisoned snapshot is an `Err`.

use crate::models::{
    LogEntryPayload, LogLevel, LogStatus, SharedServerConfig, SharedShadowStore,
    SyncDocumentsPayload,
};
use crate::services::logger;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_launch::{self, McpStatus};
use crate::services::shadow_store;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

// ── Payload size limits ────────────────────────────────────────────────────────

/// Maximum number of documents allowed in a single sync payload. Shared with
/// the quit guard's discard cap, so it is defined once at the crate root.
pub(crate) use crate::MAX_DOCUMENTS_PER_WINDOW;

/// Maximum size of a single document's content in bytes (10 MB).
const MAX_DOCUMENT_CONTENT_BYTES: usize = 10 * 1024 * 1024;

/// Maximum byte length of the window_label field.
const MAX_WINDOW_LABEL_BYTES: usize = 256;

// ── Validation ────────────────────────────────────────────────────────────────

/// Validate that a SyncDocumentsPayload does not exceed any size limit.
///
/// Returns `Err` with a descriptive message if any limit is exceeded so the
/// Tauri command can propagate the error to the frontend without touching the
/// shadow store.
fn validate_sync_payload(payload: &SyncDocumentsPayload) -> Result<(), String> {
    if payload.window_label.len() > MAX_WINDOW_LABEL_BYTES {
        return Err(format!(
            "window_label exceeds maximum length ({} > {} bytes)",
            payload.window_label.len(),
            MAX_WINDOW_LABEL_BYTES
        ));
    }

    if payload.documents.len() > MAX_DOCUMENTS_PER_WINDOW {
        return Err(format!(
            "too many documents in sync payload ({} > {})",
            payload.documents.len(),
            MAX_DOCUMENTS_PER_WINDOW
        ));
    }

    for doc in &payload.documents {
        if doc.content.len() > MAX_DOCUMENT_CONTENT_BYTES {
            return Err(format!(
                "document {} content exceeds {} byte limit ({} bytes)",
                doc.id,
                MAX_DOCUMENT_CONTENT_BYTES,
                doc.content.len()
            ));
        }
    }

    Ok(())
}

/// Sync document state from frontend to Rust Shadow Store.
///
/// This command is called by the frontend with debounced updates
/// (300ms for content changes, immediate for open/close/switch).
#[tauri::command]
pub async fn mcp_sync_documents(
    state: State<'_, SharedShadowStore>,
    payload: SyncDocumentsPayload,
) -> Result<(), String> {
    validate_sync_payload(&payload)?;
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

    Ok(config.as_ref().map(|c| ServerInfo { port: c.port }))
}

/// Non-secret server diagnostics returned to the renderer.
/// The auth token is intentionally excluded to prevent credential leakage.
#[derive(Serialize)]
pub struct ServerInfo {
    pub port: u16,
}

/// MCP client types
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpClient {
    ClaudeDesktop,
    ClaudeCode,
    CodexCli,
    GeminiCli,
}

/// Installation status for a single client
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInstallation {
    pub client: McpClient,
    pub installed: bool,
    pub config_path: String,
}

/// Get MCP server status: phase and error, current on-disk setting, port.
/// See `services::mcp_launch::current_status` (ADR-0039, ADR-0040 WI-5).
#[tauri::command]
pub fn mcp_get_status(controller: State<'_, Arc<McpController>>) -> Result<McpStatus, String> {
    mcp_launch::current_status(&controller, get_mcp_binary_path()?)
}

/// Check which MCP clients have config installed
#[tauri::command]
pub fn mcp_get_installations() -> Result<Vec<McpInstallation>, String> {
    let clients = [
        McpClient::ClaudeDesktop,
        McpClient::ClaudeCode,
        McpClient::CodexCli,
        McpClient::GeminiCli,
    ];

    let mut installations = Vec::new();
    for client in clients {
        let config_path = get_client_config_path(client)?;
        let installed = check_mcp_installed(&config_path, client);
        installations.push(McpInstallation {
            client,
            installed,
            config_path: config_path.to_string_lossy().to_string(),
        });
    }

    Ok(installations)
}

/// Install MCP config to a specific client
#[tauri::command]
pub fn mcp_install_config(client: McpClient) -> Result<(), String> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.install_config".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "client": format!("{:?}", client) })),
        duration_ms: None,
        error: None,
    });

    let result = (|| {
        let config_path = get_client_config_path(client)?;
        let binary_path = get_mcp_binary_path()?;

        // Ensure parent directory exists
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        match client {
            McpClient::ClaudeDesktop | McpClient::ClaudeCode | McpClient::GeminiCli => {
                install_json_config(&config_path, &binary_path, client)
            }
            McpClient::CodexCli => install_toml_config(&config_path, &binary_path),
        }
    })();

    let elapsed = start.elapsed().as_millis() as u64;
    match &result {
        Ok(()) => logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "mcp.install_config".to_string(),
            status: LogStatus::Success,
            action_id: Some(action_id),
            context: Some(json!({ "client": format!("{:?}", client) })),
            duration_ms: Some(elapsed),
            error: None,
        }),
        Err(e) => logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "mcp.install_config".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id),
            context: Some(json!({ "client": format!("{:?}", client) })),
            duration_ms: Some(elapsed),
            error: Some(e.clone()),
        }),
    }
    result
}

/// Remove MCP config from a specific client
#[tauri::command]
pub fn mcp_remove_config(client: McpClient) -> Result<(), String> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.remove_config".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "client": format!("{:?}", client) })),
        duration_ms: None,
        error: None,
    });

    let config_path = get_client_config_path(client)?;
    let result = match client {
        McpClient::ClaudeDesktop | McpClient::ClaudeCode | McpClient::GeminiCli => {
            remove_json_config(&config_path)
        }
        McpClient::CodexCli => remove_toml_config(&config_path),
    };

    let elapsed = start.elapsed().as_millis() as u64;
    match &result {
        Ok(()) => logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "mcp.remove_config".to_string(),
            status: LogStatus::Success,
            action_id: Some(action_id),
            context: Some(json!({ "client": format!("{:?}", client) })),
            duration_ms: Some(elapsed),
            error: None,
        }),
        Err(e) => logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "mcp.remove_config".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id),
            context: Some(json!({ "client": format!("{:?}", client) })),
            duration_ms: Some(elapsed),
            error: Some(e.clone()),
        }),
    }
    result
}

// Helper functions

pub(crate) fn get_mcp_binary_path() -> Result<String, String> {
    let binary_name = if cfg!(windows) {
        "mdpro_mcp.exe"
    } else {
        "mdpro_mcp"
    };

    // Check if we're in a bundled app
    if let Ok(exe_path) = std::env::current_exe() {
        let bundled_path = exe_path.parent().map(|p| p.join(binary_name));

        if let Some(path) = bundled_path {
            if path.exists() {
                return Ok(path.to_string_lossy().to_string());
            }
        }
    }

    // Fallback for development - use debug/release build relative to project root
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_paths = [
        manifest_dir.join("target/debug").join(binary_name),
        manifest_dir.join("target/release").join(binary_name),
    ];

    for path in dev_paths {
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    // Platform-specific default path for installed app
    #[cfg(target_os = "macos")]
    {
        Ok("/Applications/mdpro.app/Contents/MacOS/mdpro_mcp".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        // On Windows, fall back to the binary next to the current exe
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .ok_or_else(|| "Could not determine executable directory".to_string())?;
        Ok(exe_dir.join("mdpro_mcp.exe").to_string_lossy().to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(format!("/usr/local/bin/{}", binary_name))
    }
}

/// The config file of `client`, built from `dirs::home_dir()` (and on Windows
/// `dirs::config_dir()`). `pub(crate)` so the run-isolation test (ADR-0047
/// WI-002 WI-8) can resolve every client's path under a temp HOME.
pub(crate) fn get_client_config_path(client: McpClient) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;

    let path = match client {
        McpClient::ClaudeDesktop => {
            #[cfg(target_os = "macos")]
            {
                home.join("Library/Application Support/Claude/claude_desktop_config.json")
            }
            #[cfg(target_os = "windows")]
            {
                dirs::config_dir()
                    .ok_or_else(|| "Could not determine config directory".to_string())?
                    .join("Claude/claude_desktop_config.json")
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                home.join(".config/Claude/claude_desktop_config.json")
            }
        }
        McpClient::ClaudeCode => home.join(".claude/settings.json"),
        McpClient::CodexCli => home.join(".codex/config.toml"),
        McpClient::GeminiCli => {
            #[cfg(target_os = "windows")]
            {
                dirs::config_dir()
                    .ok_or_else(|| "Could not determine config directory".to_string())?
                    .join("Google")
                    .join("gemini")
                    .join("settings.json")
            }
            #[cfg(not(target_os = "windows"))]
            {
                home.join(".config/gemini/settings.json")
            }
        }
    };
    Ok(path)
}

fn check_mcp_installed(config_path: &PathBuf, client: McpClient) -> bool {
    if !config_path.exists() {
        return false;
    }

    match client {
        McpClient::ClaudeDesktop | McpClient::ClaudeCode | McpClient::GeminiCli => {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    return json
                        .get("mcpServers")
                        .and_then(|s| s.get("mdpro"))
                        .is_some();
                }
            }
            false
        }
        McpClient::CodexCli => {
            if let Ok(content) = fs::read_to_string(config_path) {
                content.contains("[mcp_servers.mdpro]") || content.contains("mcp_servers.mdpro")
            } else {
                false
            }
        }
    }
}

fn install_json_config(
    config_path: &PathBuf,
    binary_path: &str,
    _client: McpClient,
) -> Result<(), String> {
    let mut config: serde_json::Value = if config_path.exists() {
        let content =
            fs::read_to_string(config_path).map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?
    } else {
        serde_json::json!({})
    };

    // Ensure mcpServers object exists
    if config.get("mcpServers").is_none() {
        config["mcpServers"] = serde_json::json!({});
    }

    // Add mdpro config
    config["mcpServers"]["mdpro"] = serde_json::json!({
        "command": binary_path
    });

    // Write back
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_path, content).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn remove_json_config(config_path: &PathBuf) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content =
        fs::read_to_string(config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    // Remove mdpro from mcpServers
    if let Some(servers) = config.get_mut("mcpServers") {
        if let Some(obj) = servers.as_object_mut() {
            obj.remove("mdpro");
        }
    }

    // Write back
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_path, content).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn install_toml_config(config_path: &PathBuf, binary_path: &str) -> Result<(), String> {
    let mut content = if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| format!("Failed to read config: {}", e))?
    } else {
        String::new()
    };

    // Check if already has mdpro config
    if content.contains("[mcp_servers.mdpro]") {
        return Ok(());
    }

    // Add mdpro config
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    // Escape TOML special characters in the binary path (fixes #145):
    // - Backslashes → forward slashes (Windows path normalization)
    // - Double quotes → escaped (prevents TOML injection)
    let safe_path = binary_path.replace('\\', "/").replace('"', "\\\"");
    content.push_str(&format!(
        "\n[mcp_servers.mdpro]\ncommand = \"{}\"\n",
        safe_path
    ));

    fs::write(config_path, content).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn remove_toml_config(config_path: &PathBuf) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content =
        fs::read_to_string(config_path).map_err(|e| format!("Failed to read config: {}", e))?;

    // Simple removal - find and remove the [mcp_servers.mdpro] section
    let mut lines: Vec<&str> = content.lines().collect();
    let mut in_mdpro_section = false;
    let mut start_idx = None;
    let mut end_idx = None;

    for (i, line) in lines.iter().enumerate() {
        if line.trim() == "[mcp_servers.mdpro]" {
            in_mdpro_section = true;
            start_idx = Some(i);
        } else if in_mdpro_section && line.starts_with('[') {
            end_idx = Some(i);
            break;
        }
    }

    if let Some(start) = start_idx {
        let end = end_idx.unwrap_or(lines.len());
        lines.drain(start..end);
    }

    let new_content = lines.join("\n");
    fs::write(config_path, new_content).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DocumentState;

    fn make_doc(id: &str, content: &str) -> DocumentState {
        DocumentState {
            id: id.to_string(),
            title: "Test".to_string(),
            path: None,
            content: content.to_string(),
            cursor: 0,
            is_dirty: false,
            is_active: false,
        }
    }

    fn make_payload(window_label: &str, docs: Vec<DocumentState>) -> SyncDocumentsPayload {
        SyncDocumentsPayload {
            window_label: window_label.to_string(),
            documents: docs,
            active_document_id: None,
            routable: false,
        }
    }

    #[test]
    fn validate_accepts_valid_payload() {
        let payload = make_payload("main", vec![make_doc("doc-1", "# Hello")]);
        assert!(validate_sync_payload(&payload).is_ok());
    }

    #[test]
    fn validate_rejects_too_many_documents() {
        let docs: Vec<_> = (0..=MAX_DOCUMENTS_PER_WINDOW)
            .map(|i| make_doc(&format!("doc-{i}"), "content"))
            .collect();
        let payload = make_payload("main", docs);
        let err = validate_sync_payload(&payload).unwrap_err();
        assert!(
            err.contains("too many documents"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn validate_accepts_exactly_max_documents() {
        let docs: Vec<_> = (0..MAX_DOCUMENTS_PER_WINDOW)
            .map(|i| make_doc(&format!("doc-{i}"), "content"))
            .collect();
        let payload = make_payload("main", docs);
        assert!(validate_sync_payload(&payload).is_ok());
    }

    #[test]
    fn validate_rejects_oversized_document_content() {
        let big_content = "x".repeat(MAX_DOCUMENT_CONTENT_BYTES + 1);
        let payload = make_payload("main", vec![make_doc("doc-1", &big_content)]);
        let err = validate_sync_payload(&payload).unwrap_err();
        assert!(err.contains("content exceeds"), "unexpected error: {err}");
        assert!(
            err.contains("doc-1"),
            "error should name the document: {err}"
        );
    }

    #[test]
    fn validate_accepts_exactly_max_content_size() {
        let content = "x".repeat(MAX_DOCUMENT_CONTENT_BYTES);
        let payload = make_payload("main", vec![make_doc("doc-1", &content)]);
        assert!(validate_sync_payload(&payload).is_ok());
    }

    #[test]
    fn validate_rejects_oversized_window_label() {
        let long_label = "a".repeat(MAX_WINDOW_LABEL_BYTES + 1);
        let payload = make_payload(&long_label, vec![]);
        let err = validate_sync_payload(&payload).unwrap_err();
        assert!(err.contains("window_label"), "unexpected error: {err}");
    }

    #[test]
    fn validate_accepts_exactly_max_window_label() {
        let label = "a".repeat(MAX_WINDOW_LABEL_BYTES);
        let payload = make_payload(&label, vec![]);
        assert!(validate_sync_payload(&payload).is_ok());
    }

    #[test]
    fn validate_rejects_first_oversized_doc_in_mixed_payload() {
        // Ensures validation catches an oversized doc that is not the first in the list
        let ok_doc = make_doc("ok", "content");
        let big_content = "x".repeat(MAX_DOCUMENT_CONTENT_BYTES + 1);
        let big_doc = make_doc("too-big", &big_content);
        let payload = make_payload("main", vec![ok_doc, big_doc]);
        let err = validate_sync_payload(&payload).unwrap_err();
        assert!(
            err.contains("too-big"),
            "error must identify the offending document: {err}"
        );
    }

    // ── get_client_config_path tests ──────────────────────────────────────────

    /// On non-Windows, GeminiCli must use the XDG convention: ~/.config/gemini/settings.json.
    /// This path is what the Gemini CLI itself reads on macOS and Linux.
    ///
    /// Holds `crate::HOME_LOCK` for its whole body (D28): it reads `$HOME`
    /// twice — inside `get_client_config_path` and again via `home_dir()` — and
    /// other tests redirect `$HOME` on parallel threads. Without the lock a
    /// redirect landing between the two reads makes `starts_with` fail.
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn gemini_cli_config_path_uses_xdg_on_non_windows() {
        let _guard = crate::HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = get_client_config_path(McpClient::GeminiCli).unwrap();
        assert!(
            path.ends_with(".config/gemini/settings.json"),
            "expected XDG path on non-Windows; got {path:?}"
        );
        let home = dirs::home_dir().unwrap();
        assert!(
            path.starts_with(&home),
            "path should be under home_dir on non-Windows; got {path:?}"
        );
    }

    /// On Windows, GeminiCli must use %APPDATA%\Google\gemini\settings.json.
    /// Using home.join(".config/gemini") produces a Linux-style path that does
    /// not exist on Windows — detection always returns false for all Windows users.
    #[test]
    #[cfg(target_os = "windows")]
    fn gemini_cli_config_path_uses_appdata_on_windows() {
        let path = get_client_config_path(McpClient::GeminiCli).unwrap();
        let expected_suffix = std::path::Path::new("Google")
            .join("gemini")
            .join("settings.json");
        assert!(
            path.ends_with(&expected_suffix),
            "expected %APPDATA%\\Google\\gemini\\settings.json on Windows; got {path:?}"
        );
        let config_dir = dirs::config_dir().unwrap();
        assert!(
            path.starts_with(&config_dir),
            "path must be under config_dir (%APPDATA%) on Windows; got {path:?}"
        );
    }
}
