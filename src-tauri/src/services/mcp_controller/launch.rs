//! Purpose: apply the ADR-0039 launch decision through the `McpController`
//! (ADR-0040 WI-5), so launch is one more serialized transition rather than
//! a separate code path with its own one-shot state.
//!
//! Pipeline: `main.rs` setup -> `mcp_launch::decide_mcp_launch` ->
//! `launch(controller, decision, make_router)` -> { log
//! `mcp_launch::launch_log_entry`; take the transition lock synchronously
//! (PC-7); spawn: Skip -> unpublish + `stop_locked` (Disabled), Start ->
//! `start_locked` -> log `started_log_entry` }.
//!
//! Key decisions:
//! - The lock is taken with `try_lock_owned` before `launch` returns, so a
//!   toggle issued during launch is applied after it (L-2, L-2c). If the
//!   lock is somehow busy, the task waits for it instead of failing.
//! - The task runs on the caller's tokio runtime when there is one, and on
//!   Tauri's otherwise (the setup hook runs outside any runtime), so launch
//!   never panics for want of a runtime.
//! - Log lines carry enum strings and a port only, never OS error text, a
//!   path or the token (L-3).
//!
//! @coordinates-with src/main.rs (the only production caller)
//! @coordinates-with src/services/mcp_launch.rs (the decision and its log line)
//! @coordinates-with src/services/mcp_controller/transitions.rs

use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedServerConfig};
use crate::services::logger;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::files;
use crate::services::mcp_controller::snapshot::{McpPhase, McpSnapshot, SnapshotError};
use crate::services::mcp_launch::{launch_log_entry, McpLaunchDecision};
use axum::Router;
use serde::Serialize;
use serde_json::json;
use std::future::Future;
use std::sync::Arc;
use tokio::task::JoinHandle;

/// Apply `decision` through `controller`. Returns once the transition lock
/// is held; the returned handle completes when the launch transition has.
pub fn launch<F, Fut>(
    controller: Arc<McpController>,
    decision: McpLaunchDecision,
    make_router: F,
) -> JoinHandle<()>
where
    F: FnOnce(SharedServerConfig) -> Fut + Send + 'static,
    Fut: Future<Output = Router> + Send + 'static,
{
    if let Some(entry) = launch_log_entry(decision) {
        logger::log_event(entry);
    }
    // Synchronous, before any await (PC-7): a toggle queued from here on
    // runs after this launch.
    let held = controller.inner.clone().try_lock_owned().ok();
    runtime().spawn(async move {
        let mut inner = match held {
            Some(guard) => guard,
            None => controller.inner.clone().lock_owned().await,
        };
        match decision {
            McpLaunchDecision::Skip(_) => {
                // Stale files from an earlier run, removed without reading.
                files::unpublish(&controller.env.files_dir);
                controller.stop_locked(&mut inner).await;
            }
            McpLaunchDecision::Start(_) => {
                controller.start_locked(&mut inner, make_router).await;
                logger::log_event(started_log_entry(controller.snapshot()));
            }
        }
    })
}

/// The caller's runtime if there is one, else Tauri's.
fn runtime() -> tokio::runtime::Handle {
    tokio::runtime::Handle::try_current()
        .unwrap_or_else(|_| tauri::async_runtime::handle().inner().clone())
}

/// The post-start log line (`mcp.http_server.start`), from the snapshot the
/// start left behind: Running -> Info/Success `{phase, port}`; Failed ->
/// Error/Fail `{phase, error}` with `error` the enum string; any other
/// phase -> Info/Success `{phase}`; a poisoned snapshot -> Error/Fail
/// `{error: "status_unavailable"}`. Enum strings and a port only.
pub fn started_log_entry(snapshot: Result<McpSnapshot, SnapshotError>) -> LogEntryPayload {
    let (level, status, context, error) = match snapshot {
        Ok(s) => {
            let phase = enum_str(&s.phase);
            match (s.phase, s.error, s.port) {
                (McpPhase::Running, _, Some(port)) => (
                    LogLevel::Info,
                    LogStatus::Success,
                    json!({ "phase": phase, "port": port }),
                    None,
                ),
                (McpPhase::Failed, Some(e), _) => {
                    let e = enum_str(&e);
                    (
                        LogLevel::Error,
                        LogStatus::Fail,
                        json!({ "phase": phase, "error": e }),
                        Some(e),
                    )
                }
                _ => (
                    LogLevel::Info,
                    LogStatus::Success,
                    json!({ "phase": phase }),
                    None,
                ),
            }
        }
        Err(_) => (
            LogLevel::Error,
            LogStatus::Fail,
            json!({ "error": STATUS_UNAVAILABLE }),
            Some(STATUS_UNAVAILABLE.to_string()),
        ),
    };
    LogEntryPayload {
        level,
        event: "mcp.http_server.start".to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error,
    }
}

/// The log word for a poisoned snapshot.
const STATUS_UNAVAILABLE: &str = "status_unavailable";

/// A wire enum's snake_case string (`McpPhase`, `McpServerError`).
fn enum_str<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}
