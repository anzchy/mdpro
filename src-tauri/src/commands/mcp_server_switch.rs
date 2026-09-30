//! Purpose: the `mcp_set_server_enabled` Tauri command (ADR-0040 WI-7), a
//! shell with no logic of its own. It wires the managed `McpController`, the
//! real `persist_server_enabled` and the app's router factory into
//! `services::mcp_controller::switch::set_server_enabled`, which owns the
//! sequence (persist, reconcile, status), the error mapping and the log.
//!
//! Key decisions:
//! - Its own file because `commands/mcp.rs` is past the size limit.
//! - The only input is a bool; every failure, lock poisoning included, is a
//!   `McpSwitchError` string on the wire (`switchError` in
//!   `tests/fixtures/mcp-status-contract.json`), never a panic.
//! - When no controller is managed (no data dir at startup), Tauri rejects
//!   the call with its "state not managed" error, as for `mcp_get_status`.
//! - A server started here gates its writes on the same managed
//!   `AppConfirmBroker` as the one started at launch (ADR-0042 WI-9), so a
//!   toggle never leaves a second, unhooked broker behind.
//!
//! @coordinates-with src/services/mcp_controller/switch.rs
//! @coordinates-with src/commands/mcp.rs (`get_mcp_binary_path`)
//! @coordinates-with src/services/http_server.rs (`router_factory`)
//! @coordinates-with src/services/mcpService.ts (`setServerEnabled`, frontend)

use crate::commands::mcp::get_mcp_binary_path;
use crate::models::SharedShadowStore;
use crate::services::http_server;
use crate::services::mcp_confirm::effects::AppConfirmBroker;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::switch::{set_server_enabled, McpSwitchError};
use crate::services::mcp_launch::McpStatus;
use crate::services::preferences_mcp::persist_server_enabled;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Turn the MCP server on or off now, and persist the choice first.
/// Returns the status after the switch (`phase: failed` when the bind
/// failed — the saved value is kept).
#[tauri::command]
pub async fn mcp_set_server_enabled(
    enabled: bool,
    app: AppHandle,
    controller: State<'_, Arc<McpController>>,
    shadow_store: State<'_, SharedShadowStore>,
    confirm: State<'_, Arc<AppConfirmBroker>>,
) -> Result<McpStatus, McpSwitchError> {
    // Only fails off macOS; the status then carries an empty path.
    let binary_path = get_mcp_binary_path().unwrap_or_default();
    let router =
        http_server::router_factory(shadow_store.inner().clone(), confirm.inner().clone(), app);
    set_server_enabled(
        &controller,
        persist_server_enabled,
        enabled,
        router,
        binary_path,
    )
    .await
}
