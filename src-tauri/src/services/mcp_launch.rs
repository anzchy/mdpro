//! MCP server launch gate (ADR-0039) and status projection (ADR-0040).
//!
//! Purpose: decide, once at launch, whether the local MCP HTTP server is
//! started, from `mcp.serverEnabled` in `~/.mdpro/config.json`; build the
//! launch log line; and build the `mcp_get_status` reply (where the server is
//! now vs. what the disk says now).
//!
//! Pipeline: `read_server_enabled` (read-only) → `decide_mcp_launch` (pure) →
//! `mcp_controller::launch` (logs `launch_log_entry`, applies the decision).
//! Status: `current_status` → the controller snapshot (`phase`, `error`,
//! `port`) + a fresh `read_server_enabled` → `build_status` (pure) →
//! `mcp_get_status`.
//!
//! @coordinates-with main.rs (setup glue), commands/mcp.rs (`mcp_get_status`),
//! services/mcp_controller/launch.rs (applies the decision),
//! services/mcp_controller/controller.rs (the snapshot),
//! models/preferences.rs (`McpConfig`), services/preferences.rs
//! (`preferences_rw_lock`), services/mcp_controller/snapshot.rs (`McpPhase`,
//! `McpServerError` — the wire enums), tests/fixtures/mcp-status-contract.json
//!
//! Key decisions:
//! - **Read-only.** The reader never creates or rewrites `config.json`
//!   (`load_preferences` would materialise it — a startup write).
//! - **Narrow parse.** Only the `mcp` group is parsed, so an unrelated
//!   malformed field cannot fail-open past an explicit `serverEnabled: false`.
//! - **Fail-open.** Only `Ok(Some(false))` skips the server; a missing file, a
//!   parse or I/O error, or a poisoned lock starts it.
//! - **Errors carry no text.** `McpConfigReadError` is a bare enum, so no path
//!   or OS message can reach a log line or the status IPC. The launch log
//!   lines are `mcp.http_server.start` with enum strings only.
//! - **The one-shot launch state is gone** (ADR-0040 decision 2): the status
//!   reads the controller snapshot, which a later toggle can change.

use crate::models::{LogEntryPayload, LogLevel, LogStatus, McpConfig};
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError};
use crate::services::preferences::{config_path, preferences_rw_lock};
use serde::{Deserialize, Serialize};
use serde_json::json;
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
/// `phase` / `error` are where the server is now (ADR-0040 decision 5);
/// `configured` is what the disk says now. `error` is always present on the
/// wire (`null` when `None`). `running == port.is_some()`, kept for the
/// existing frontend reader. The key set is the fixture's `$statusKeys`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub binary_path: String,
    pub phase: McpPhase,
    pub error: Option<McpServerError>,
    pub configured: McpConfigured,
}

/// Project the four independent inputs into a status. Pure; each output
/// field depends on exactly one input. A missing file reads as `Enabled`
/// (the default); any read error is `Unreadable`, reported rather than raised.
pub fn build_status(
    phase: McpPhase,
    error: Option<McpServerError>,
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
        phase,
        error,
        configured,
    }
}

fn read_error_kind(e: McpConfigReadError) -> &'static str {
    match e {
        McpConfigReadError::LockPoisoned => "lock_poisoned",
        McpConfigReadError::Io => "io",
        McpConfigReadError::Parse => "parse",
    }
}

/// The log line a decision adds before any bind attempt (decision D-3).
/// `Skip` → Info/Success `{outcome:"skipped", reason:"disabled"}`; a
/// fail-open start → Warn/Start `{outcome:"fail_open",
/// reason:"config_unreadable", kind}`; a normal start → `None` (the post-start
/// line is its only record).
pub fn launch_log_entry(decision: McpLaunchDecision) -> Option<LogEntryPayload> {
    let (level, status, context) = match decision {
        McpLaunchDecision::Skip(SkipReason::Disabled) => (
            LogLevel::Info,
            LogStatus::Success,
            json!({ "outcome": "skipped", "reason": "disabled" }),
        ),
        McpLaunchDecision::Start(StartReason::ConfigUnreadable(e)) => (
            LogLevel::Warn,
            LogStatus::Start,
            json!({
                "outcome": "fail_open",
                "reason": "config_unreadable",
                "kind": read_error_kind(e),
            }),
        ),
        McpLaunchDecision::Start(StartReason::Enabled | StartReason::NoConfig) => return None,
    };
    Some(LogEntryPayload {
        level,
        event: "mcp.http_server.start".to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    })
}

/// The whole `mcp_get_status` body, with the preferences lock injected (test
/// seam): `phase`, `error` and `port` from the controller snapshot, and
/// `configured` from a fresh read. A poisoned snapshot is a path-free `Err`;
/// an unreadable config is `Ok` with `configured: Unreadable`. Read-only.
pub fn current_status_in(
    prefs_lock: &Mutex<()>,
    controller: &McpController,
    binary_path: String,
) -> Result<McpStatus, String> {
    let snap = controller.snapshot().map_err(|e| e.to_string())?;
    Ok(build_status(
        snap.phase,
        snap.error,
        read_server_enabled_in(prefs_lock),
        snap.port,
        binary_path,
    ))
}

/// [`current_status_in`] under the global `preferences_rw_lock`.
pub fn current_status(
    controller: &McpController,
    binary_path: String,
) -> Result<McpStatus, String> {
    current_status_in(preferences_rw_lock(), controller, binary_path)
}

#[cfg(test)]
#[path = "mcp_launch_io_tests.rs"]
mod mcp_launch_io_tests;
#[cfg(test)]
#[path = "mcp_launch_log_tests.rs"]
mod mcp_launch_log_tests;
#[cfg(test)]
#[path = "mcp_launch_skip_tests.rs"]
mod mcp_launch_skip_tests;
#[cfg(test)]
#[path = "mcp_launch_status_io_tests.rs"]
mod mcp_launch_status_io_tests;
#[cfg(test)]
#[path = "mcp_launch_status_snapshot_tests.rs"]
mod mcp_launch_status_snapshot_tests;
#[cfg(test)]
#[path = "mcp_launch_status_tests.rs"]
mod mcp_launch_status_tests;
#[cfg(test)]
#[path = "mcp_launch_tests.rs"]
mod mcp_launch_tests;
