//! Purpose: the MCP server switch (ADR-0040 WI-7): persist the user's intent,
//! then bring the server to it, then report one status. Tauri-independent;
//! `commands/mcp_server_switch.rs` is its thin command shell.
//!
//! Pipeline: `set_server_enabled(controller, persist_fn, enabled, make_router,
//! binary_path)` -> log Start -> take `switch_lock` -> refuse if exiting ->
//! `persist_fn(enabled)` -> `controller.reconcile(enabled)` ->
//! `mcp_launch::current_status_in` -> release -> log Success / Fail ->
//! `Result<McpStatus, McpSwitchError>`.
//!
//! Key decisions:
//! - **Persist before act.** A persist failure returns before the server is
//!   touched, so (phase, generation, token file) are conserved. An unreadable
//!   config is `ConfigUnreadable` (this includes a missing config whose
//!   `~/.mdpro` cannot be created, which `persist_server_enabled` reports as
//!   `Unreadable`); a failed write or a poisoned preferences lock is
//!   `PersistFailed`.
//! - **Intent is kept.** Once persisted, the disk value stands: a failed bind
//!   is `Ok` with `phase: failed` (no rollback), and an unreadable snapshot is
//!   `Err(StatusUnavailable)`, never a panic or a default status (PC-4).
//!   `StatusUnavailable` means persisted; the server may not have been
//!   reconciled: `reconcile` reads the snapshot before acting, so a poisoned
//!   snapshot returns before any start or stop.
//! - **After exit, nothing.** `exiting` refuses before persist or bind.
//! - **Log contract** (`mcp.server.toggle`): one uuid `action_id` per toggle,
//!   Start then Success or Fail; the context holds only `direction`,
//!   `phase`, `error`, all closed enum strings, plus `duration_ms` on the
//!   terminal line. Never a token, a path or OS text.
//! - **Switches are serialized** (WI-7b) by the controller's `switch_lock`,
//!   an async `tokio::sync::Mutex<()>` taken first, before the exiting
//!   check, and held across persist, reconcile and the status read. Two
//!   toggles (e.g. from two windows) therefore run whole, one after the
//!   other, in lock-acquisition order: the disk value and the server phase
//!   always come from the same switch. No std lock is held across an await.
//!
//! @coordinates-with src/commands/mcp_server_switch.rs (the Tauri command)
//! @coordinates-with src/services/preferences_mcp.rs (`persist_server_enabled`)
//! @coordinates-with src/services/mcp_launch.rs (`current_status_in`)
//! @coordinates-with tests/fixtures/mcp-status-contract.json (`switchError`)

use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedServerConfig};
use crate::services::logger;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_launch::{current_status_in, McpStatus};
use crate::services::preferences::preferences_rw_lock;
use crate::services::preferences_mcp::PersistError;
use axum::Router;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::future::Future;
use std::sync::atomic::Ordering;
use std::time::Instant;

/// The switch's log event.
const EVENT: &str = "mcp.server.toggle";

/// Why the switch refused, or could not report. Wire: `"config_unreadable"`,
/// … — the fixture's `switchError` list. Payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSwitchError {
    /// The config could not be read; nothing was written, the server is as it was.
    ConfigUnreadable,
    /// The config could not be written (or its lock was poisoned); the server
    /// is as it was.
    PersistFailed,
    /// The app is exiting; nothing was persisted or started.
    Exiting,
    /// The value was persisted; the server may not have been reconciled to
    /// it (a poisoned snapshot fails `reconcile` before it acts), and the
    /// status could not be read.
    StatusUnavailable,
}

impl From<PersistError> for McpSwitchError {
    fn from(e: PersistError) -> Self {
        match e {
            PersistError::Unreadable => McpSwitchError::ConfigUnreadable,
            PersistError::WriteFailed | PersistError::LockPoisoned => McpSwitchError::PersistFailed,
        }
    }
}

/// Persist `enabled` with `persist_fn`, then reconcile the server to it, and
/// return the status (`binary_path` is echoed into it). Logs one
/// `mcp.server.toggle` group. Never panics.
pub async fn set_server_enabled<P, F, Fut>(
    controller: &McpController,
    persist_fn: P,
    enabled: bool,
    make_router: F,
    binary_path: String,
) -> Result<McpStatus, McpSwitchError>
where
    P: FnOnce(bool) -> Result<(), PersistError>,
    F: FnOnce(SharedServerConfig) -> Fut + Send,
    Fut: Future<Output = Router> + Send,
{
    let action_id = uuid::Uuid::new_v4().to_string();
    let started = Instant::now();
    logger::log_event(start_entry(&action_id, enabled));
    let result = switch(controller, persist_fn, enabled, make_router, binary_path).await;
    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    logger::log_event(end_entry(&action_id, enabled, &result, duration_ms));
    result
}

async fn switch<P, F, Fut>(
    controller: &McpController,
    persist_fn: P,
    enabled: bool,
    make_router: F,
    binary_path: String,
) -> Result<McpStatus, McpSwitchError>
where
    P: FnOnce(bool) -> Result<(), PersistError>,
    F: FnOnce(SharedServerConfig) -> Fut + Send,
    Fut: Future<Output = Router> + Send,
{
    // Held until return: persist, reconcile and status are one critical section.
    let _switch = controller.switch_lock.lock().await;
    if controller.exiting.load(Ordering::SeqCst) {
        return Err(McpSwitchError::Exiting);
    }
    persist_fn(enabled)?;
    controller
        .reconcile(enabled, make_router)
        .await
        .map_err(|_| McpSwitchError::StatusUnavailable)?;
    current_status_in(preferences_rw_lock(), controller, binary_path)
        .map_err(|_| McpSwitchError::StatusUnavailable)
}

fn direction(enabled: bool) -> &'static str {
    if enabled {
        "on"
    } else {
        "off"
    }
}

fn start_entry(action_id: &str, enabled: bool) -> LogEntryPayload {
    LogEntryPayload {
        level: LogLevel::Info,
        event: EVENT.to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.to_string()),
        context: Some(json!({ "direction": direction(enabled) })),
        duration_ms: None,
        error: None,
    }
}

/// The terminal line: Success `{direction, phase}` when the server reached
/// a non-failed phase; Fail `{direction, phase, error}` when the bind or
/// serve failed; Fail `{direction, error}` when the switch refused. Every
/// value is an enum string.
fn end_entry(
    action_id: &str,
    enabled: bool,
    result: &Result<McpStatus, McpSwitchError>,
    duration_ms: u64,
) -> LogEntryPayload {
    let mut context = Map::new();
    context.insert("direction".into(), json!(direction(enabled)));
    let error = match result {
        Ok(status) => {
            context.insert("phase".into(), json!(enum_str(&status.phase)));
            match (status.phase, status.error) {
                (McpPhase::Failed, Some(e)) => Some(enum_str(&e)),
                _ => None,
            }
        }
        Err(e) => Some(enum_str(e)),
    };
    if let Some(e) = &error {
        context.insert("error".into(), json!(e));
    }
    let (level, status) = match (result, &error) {
        (Ok(_), None) => (LogLevel::Info, LogStatus::Success),
        (Err(McpSwitchError::Exiting), _) => (LogLevel::Info, LogStatus::Fail),
        _ => (LogLevel::Warn, LogStatus::Fail),
    };
    LogEntryPayload {
        level,
        event: EVENT.to_string(),
        status,
        action_id: Some(action_id.to_string()),
        context: Some(Value::Object(context)),
        duration_ms: Some(duration_ms),
        error,
    }
}

/// A wire enum's snake_case string.
fn enum_str<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}
