//! MCP Commands
//!
//! Tauri IPC commands for MCP integration, including document sync
//! from frontend to Rust Shadow Store and MCP client configuration.

use crate::models::{SharedShadowStore, SharedServerConfig, SyncDocumentsPayload};
use crate::services::shadow_store;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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
    }))
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

/// Status of MCP server
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub binary_path: String,
}

/// Installation status for a single client
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInstallation {
    pub client: McpClient,
    pub installed: bool,
    pub config_path: String,
}

/// Get MCP server status
#[tauri::command]
pub fn mcp_get_status(
    state: State<'_, SharedServerConfig>,
) -> Result<McpStatus, String> {
    let config = state
        .lock()
        .map_err(|e| format!("Failed to lock server config: {}", e))?;

    // Get the binary path - in production it's bundled with the app
    let binary_path = get_mcp_binary_path()?;

    Ok(McpStatus {
        running: config.is_some(),
        port: config.as_ref().map(|c| c.port),
        binary_path,
    })
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
        let config_path = get_client_config_path(client);
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
    let config_path = get_client_config_path(client);
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
        McpClient::CodexCli => {
            install_toml_config(&config_path, &binary_path)
        }
    }
}

/// Remove MCP config from a specific client
#[tauri::command]
pub fn mcp_remove_config(client: McpClient) -> Result<(), String> {
    let config_path = get_client_config_path(client);

    match client {
        McpClient::ClaudeDesktop | McpClient::ClaudeCode | McpClient::GeminiCli => {
            remove_json_config(&config_path)
        }
        McpClient::CodexCli => {
            remove_toml_config(&config_path)
        }
    }
}

// Helper functions

fn get_mcp_binary_path() -> Result<String, String> {
    let binary_name = if cfg!(windows) { "mdpro_mcp.exe" } else { "mdpro_mcp" };

    // Check if we're in a bundled app
    if let Ok(exe_path) = std::env::current_exe() {
        let bundled_path = exe_path.parent()
            .map(|p| p.join(binary_name));

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
    #[cfg(not(target_os = "macos"))]
    {
        Err("Could not locate mdpro_mcp binary. Ensure mdpro is installed correctly.".to_string())
    }
}

fn get_client_config_path(client: McpClient) -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();

    match client {
        McpClient::ClaudeDesktop => {
            #[cfg(target_os = "macos")]
            {
                home.join("Library/Application Support/Claude/claude_desktop_config.json")
            }
            #[cfg(target_os = "windows")]
            {
                dirs::config_dir()
                    .unwrap_or_default()
                    .join("Claude/claude_desktop_config.json")
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                home.join(".config/Claude/claude_desktop_config.json")
            }
        }
        McpClient::ClaudeCode => {
            home.join(".claude/settings.json")
        }
        McpClient::CodexCli => {
            home.join(".codex/config.toml")
        }
        McpClient::GeminiCli => {
            home.join(".config/gemini/settings.json")
        }
    }
}

fn check_mcp_installed(config_path: &PathBuf, client: McpClient) -> bool {
    if !config_path.exists() {
        return false;
    }

    match client {
        McpClient::ClaudeDesktop | McpClient::ClaudeCode | McpClient::GeminiCli => {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    return json.get("mcpServers")
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

fn install_json_config(config_path: &PathBuf, binary_path: &str, client: McpClient) -> Result<(), String> {
    let mut config: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?
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

    // For Claude Code, add args if needed
    if client == McpClient::ClaudeCode {
        config["mcpServers"]["mdpro"] = serde_json::json!({
            "command": binary_path
        });
    }

    // Write back
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn remove_json_config(config_path: &PathBuf) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    // Remove mdpro from mcpServers
    if let Some(servers) = config.get_mut("mcpServers") {
        if let Some(obj) = servers.as_object_mut() {
            obj.remove("mdpro");
        }
    }

    // Write back
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn install_toml_config(config_path: &PathBuf, binary_path: &str) -> Result<(), String> {
    let mut content = if config_path.exists() {
        fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?
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
    // Use forward slashes to avoid malformed TOML from unescaped backslashes on Windows
    let safe_path = binary_path.replace('\\', "/");
    content.push_str(&format!(
        "\n[mcp_servers.mdpro]\ncommand = \"{}\"\n",
        safe_path
    ));

    fs::write(config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn remove_toml_config(config_path: &PathBuf) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

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
    fs::write(config_path, new_content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}
