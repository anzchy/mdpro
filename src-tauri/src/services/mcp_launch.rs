//! MCP server launch gate (ADR-0039).
//!
//! Purpose: decide, once at launch, whether the local MCP HTTP server is
//! spawned, from `mcp.serverEnabled` in `~/.mdpro/config.json`; and build the
//! `mcp_get_status` reply (what launch did vs. what the disk says now).
//!
//! Pipeline: `read_server_enabled` (read-only) → `decide_mcp_launch` (pure).
//! Status: `current_status` → launch state + server port + a fresh
//! `read_server_enabled` → `build_status` (pure) → `mcp_get_status`.
//!
//! @coordinates-with main.rs (setup glue), commands/mcp.rs (`mcp_get_status`),
//! models/preferences.rs (`McpConfig`), services/preferences.rs
//! (`preferences_rw_lock`)
//!
//! Key decisions:
//! - **Read-only.** The reader never creates or rewrites `config.json`
//!   (`load_preferences` would materialise it — a startup write).
//! - **Narrow parse.** Only the `mcp` group is parsed, so an unrelated
//!   malformed field cannot fail-open past an explicit `serverEnabled: false`.
//! - **Fail-open.** Only `Ok(Some(false))` skips the server; a missing file, a
//!   parse or I/O error, or a poisoned lock starts it.
//! - **Errors carry no text.** `McpConfigReadError` is a bare enum, so no path
//!   or OS message can reach a log line or the status IPC.

use crate::models::{McpConfig, SharedServerConfig};
use crate::services::preferences::{config_path, preferences_rw_lock};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::sync::Mutex;

/// Why `config.json` could not be read. Deliberately carries no message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpConfigReadError {
    LockPoisoned,
    Io,
    Parse,
}

/// The result of reading `mcp.serverEnabled`: `Ok(None)` means no file.
pub type McpConfigRead = Result<Option<bool>, McpConfigReadError>;

/// Why the server is started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartReason {
    Enabled,
    NoConfig,
    ConfigUnreadable(McpConfigReadError),
}

/// Why the server is skipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    Disabled,
}

/// The launch decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpLaunchDecision {
    Start(StartReason),
    Skip(SkipReason),
}

/// The only part of `config.json` the gate parses (decision D-1). Unknown and
/// other top-level fields are ignored; a wrong-typed `mcp` is a parse error.
#[derive(Deserialize)]
struct McpGateDoc {
    #[serde(default)]
    mcp: McpConfig,
}

/// Read `mcp.serverEnabled`, holding `lock` for the file read only.
///
/// The seam behind [`read_server_enabled`]: tests inject a genuinely poisoned
/// mutex here. A poisoned lock is `LockPoisoned` — never read through with
/// `into_inner`. A missing file is `Ok(None)`; any other read failure
/// (including a directory in the file's place) is `Io`; an empty or malformed
/// file is `Parse`. Never creates, rewrites or repairs anything.
pub fn read_server_enabled_in(lock: &Mutex<()>) -> McpConfigRead {
    let path = config_path().map_err(|_| McpConfigReadError::Io)?;
    let bytes = {
        let _guard = lock.lock().map_err(|_| McpConfigReadError::LockPoisoned)?;
        match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(McpConfigReadError::Io),
        }
    };
    serde_json::from_slice::<McpGateDoc>(&bytes)
        .map(|doc| Some(doc.mcp.server_enabled))
        .map_err(|_| McpConfigReadError::Parse)
}

/// Read `mcp.serverEnabled` under the global `preferences_rw_lock`, so a
/// concurrent `set_preferences` write is never observed half-done.
pub fn read_server_enabled() -> McpConfigRead {
    read_server_enabled_in(preferences_rw_lock())
}

/// Decide the launch from a read. Pure and fail-open: only an explicit
/// `serverEnabled: false` skips; every other input starts the server.
pub fn decide_mcp_launch(read: McpConfigRead) -> McpLaunchDecision {
    match read {
        Ok(Some(true)) => McpLaunchDecision::Start(StartReason::Enabled),
        Ok(Some(false)) => McpLaunchDecision::Skip(SkipReason::Disabled),
        Ok(None) => McpLaunchDecision::Start(StartReason::NoConfig),
        Err(e) => McpLaunchDecision::Start(StartReason::ConfigUnreadable(e)),
    }
}

/// The on-disk setting as the status IPC reports it (`configured`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpConfigured {
    Enabled,
    Disabled,
    Unreadable,
}

/// The `mcp_get_status` reply (camelCase on the wire). Carries no token.
///
/// `launch` is what this process did at startup; `configured` is what the
/// disk says now. They diverge until a restart (ADR-0039: read once).
/// `running == port.is_some()`, kept for the existing frontend reader.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub binary_path: String,
    pub launch: McpLaunchStatus,
    pub configured: McpConfigured,
}

/// Project the three independent inputs into a status. Pure; each output
/// field depends on exactly one input. A missing file reads as `Enabled`
/// (the default); any read error is `Unreadable`, reported rather than raised.
pub fn build_status(
    launch: McpLaunchStatus,
    read: McpConfigRead,
    port: Option<u16>,
    binary_path: String,
) -> McpStatus {
    let configured = match read {
        Ok(Some(true)) | Ok(None) => McpConfigured::Enabled,
        Ok(Some(false)) => McpConfigured::Disabled,
        Err(_) => McpConfigured::Unreadable,
    };
    McpStatus {
        running: port.is_some(),
        port,
        binary_path,
        launch,
        configured,
    }
}

/// Snapshot the launch state. A poisoned lock is a path-free `Err` — never
/// read through with `into_inner`.
pub fn current_launch(state: &SharedMcpLaunchState) -> Result<McpLaunchStatus, String> {
    state
        .lock()
        .map(|g| *g)
        .map_err(|_| "MCP launch state lock poisoned".to_string())
}

/// The whole `mcp_get_status` body, with the preferences lock injected (test
/// seam). Poisoned launch or server state is `Err`; an unreadable config is
/// `Ok` with `configured: Unreadable`. Read-only: creates nothing on disk.
pub fn current_status_in(
    prefs_lock: &Mutex<()>,
    launch: &SharedMcpLaunchState,
    server: &SharedServerConfig,
    binary_path: String,
) -> Result<McpStatus, String> {
    let launch = current_launch(launch)?;
    let port = server
        .lock()
        .map_err(|_| "MCP server config lock poisoned".to_string())?
        .as_ref()
        .map(|c| c.port);
    Ok(build_status(
        launch,
        read_server_enabled_in(prefs_lock),
        port,
        binary_path,
    ))
}

/// [`current_status_in`] under the global `preferences_rw_lock`.
pub fn current_status(
    launch: &SharedMcpLaunchState,
    server: &SharedServerConfig,
    binary_path: String,
) -> Result<McpStatus, String> {
    current_status_in(preferences_rw_lock(), launch, server, binary_path)
}

#[path = "mcp_launch_state.rs"]
mod launch_state;
pub use launch_state::{
    apply, bind_event, launch_log_entry, on_skip, record_event, LaunchEvent, McpLaunchStatus,
    SharedMcpLaunchState,
};

#[cfg(test)]
#[path = "mcp_launch_io_tests.rs"]
mod mcp_launch_io_tests;
#[cfg(test)]
#[path = "mcp_launch_skip_tests.rs"]
mod mcp_launch_skip_tests;
#[cfg(test)]
#[path = "mcp_launch_state_tests.rs"]
mod mcp_launch_state_tests;
#[cfg(test)]
#[path = "mcp_launch_status_io_tests.rs"]
mod mcp_launch_status_io_tests;
#[cfg(test)]
#[path = "mcp_launch_status_tests.rs"]
mod mcp_launch_status_tests;
#[cfg(test)]
#[path = "mcp_launch_tests.rs"]
mod mcp_launch_tests;
