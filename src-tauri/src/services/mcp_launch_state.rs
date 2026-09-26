//! MCP launch-state machine, bind event, launch log entry and skip cleanup
//! (ADR-0039). Split out of `mcp_launch.rs` for the 300-line limit and
//! re-exported from it, so callers use `services::mcp_launch::*`.
//!
//! Purpose: record what happened to the MCP server at launch — still
//! starting, running, failed to bind, or disabled by `serverEnabled: false` —
//! in managed state that `mcp_get_status` reports.
//!
//! Pipeline: main.rs setup → `record_event(Decided(d))` → (Start only)
//! `start_server` → `record_event(bind_event(&result))`.
//!
//! @coordinates-with services/mcp_launch.rs (decision types), main.rs (setup
//! glue), services/http_server.rs (`cleanup_server_config`)
//!
//! Key decisions:
//! - **Terminal states absorb.** `Running`, `Failed` and `Disabled` never
//!   change, so a late bind result cannot overwrite a skip.
//! - **One event name.** The decision and skip lines built by
//!   `launch_log_entry` are `mcp.http_server.start` with enum strings only —
//!   no path, no error text. The bind success/failure lines built in main.rs
//!   share the event name but carry `{port}` and, on failure, the OS error.
//! - **`on_skip` never reads the token.** It only deletes stale files.

use super::{McpConfigReadError, McpLaunchDecision, SkipReason, StartReason};
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::http_server;
use serde::Serialize;
use serde_json::json;
use std::sync::{Arc, Mutex};

/// What happened to the MCP server at launch. Serialised lowercase for the
/// `launch` field of `McpStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpLaunchStatus {
    Starting,
    Running,
    Failed,
    Disabled,
}

/// Managed launch state (`app.manage`), read by `mcp_get_status`.
pub type SharedMcpLaunchState = Arc<Mutex<McpLaunchStatus>>;

/// An input to the launch-state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchEvent {
    Decided(McpLaunchDecision),
    BindOk,
    BindErr,
}

/// The transition function. Pure. From `Starting`: a skip decision gives
/// `Disabled`, a bind result gives `Running` / `Failed`, a start decision
/// keeps `Starting`. Every terminal state maps every event to itself.
pub fn apply(status: McpLaunchStatus, event: LaunchEvent) -> McpLaunchStatus {
    match status {
        McpLaunchStatus::Starting => match event {
            LaunchEvent::Decided(McpLaunchDecision::Skip(_)) => McpLaunchStatus::Disabled,
            LaunchEvent::Decided(McpLaunchDecision::Start(_)) => McpLaunchStatus::Starting,
            LaunchEvent::BindOk => McpLaunchStatus::Running,
            LaunchEvent::BindErr => McpLaunchStatus::Failed,
        },
        McpLaunchStatus::Running | McpLaunchStatus::Failed | McpLaunchStatus::Disabled => status,
    }
}

/// Apply `event` to the shared state under its lock. A poisoned lock leaves
/// the state as it was (the status IPC then reports the poison as `Err`).
pub fn record_event(state: &SharedMcpLaunchState, event: LaunchEvent) {
    if let Ok(mut guard) = state.lock() {
        *guard = apply(*guard, event);
    }
}

/// The event a `start_server` result feeds the machine. Only the variant
/// matters; the payload (port, sender, error text) is never inspected.
pub fn bind_event<T, E>(r: &Result<T, E>) -> LaunchEvent {
    match r {
        Ok(_) => LaunchEvent::BindOk,
        Err(_) => LaunchEvent::BindErr,
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
/// reason:"config_unreadable", kind}`; a normal start → `None` (the post-bind
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

/// Skip-path cleanup: remove a stale `server.port` / `server.token` left by a
/// crashed run, so the sidecar reports "not running" instead of dialling a
/// dead port. Deletes without reading; creates nothing.
pub fn on_skip() {
    http_server::cleanup_server_config();
}
