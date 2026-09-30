//! Purpose: run the one-shot cleanup that must happen as the app process exits.
//!
//! Pipeline: `RunEvent::Exit` (main.rs) -> `run_exit_cleanup(&controller)` ->
//! { `app.quit` log line; `McpController::begin_exit` (mark exiting, stop
//! hook `AppExit` so pending MCP write confirmations end and later ones are
//! refused (ADR-0042), unpublish, forget the token); `stop` bounded by
//! `exit_budget`; `mcp.http_server.stop` log line }.
//!
//! Key decisions:
//! - Cleanup is bound to `RunEvent::Exit`, never `ExitRequested`: an
//!   `ExitRequested` can be vetoed, and running cleanup there left stale
//!   `server.port` / `server.token` files behind on every real quit.
//! - It deletes exactly the two MCP files. Everything else in the files dir
//!   (drafts and siblings) is conserved byte for byte.
//! - The files go first, outside the controller's transition lock, so they
//!   are gone even when a transition holds that lock past the budget; once
//!   `exiting` is set no start publishes again (ADR-0040 PC-2).
//! - Bounded: the wait on the controller is `exit_budget`. It is idempotent
//!   and panic-free: repeated runs and a poisoned snapshot leave the same
//!   end state.
//!
//! @coordinates-with src/main.rs (the only caller, from `RunEvent::Exit`)
//! @coordinates-with src/services/mcp_controller/controller.rs (`begin_exit`,
//!   `stop`, `exit_budget`)

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use crate::services::mcp_controller::controller::McpController;
use serde_json::json;

/// Run the process-exit cleanup: log `app.quit`, remove the MCP server files,
/// and stop the MCP server within the controller's exit budget.
///
/// Never panics and never returns an error: it is the last thing to run before
/// the process goes away, so a poisoned snapshot, a busy transition lock or a
/// missing file are all normal, and none of them may abort the remaining steps.
pub fn run_exit_cleanup(controller: &McpController) {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.quit".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({})),
        duration_ms: None,
        error: None,
    });

    controller.begin_exit();

    // `block_on` panics inside a runtime; `RunEvent::Exit` is never on one,
    // but a caller that is gets the files removed and an honest log line.
    let outcome = if tokio::runtime::Handle::try_current().is_ok() {
        "skipped"
    } else {
        let budget = controller.exit_budget();
        let stopped = tauri::async_runtime::block_on(async {
            tokio::time::timeout(budget, controller.stop()).await
        });
        if stopped.is_ok() {
            "stopped"
        } else {
            "timeout"
        }
    };
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "mcp.http_server.stop".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({ "outcome": outcome })),
        duration_ms: None,
        error: None,
    });
}

#[cfg(test)]
#[path = "app_exit_confirm_tests.rs"]
mod confirm_tests;
#[cfg(test)]
#[path = "app_exit_idempotence_tests.rs"]
mod idempotence_tests;
#[cfg(test)]
#[path = "app_exit_tests.rs"]
mod tests;
