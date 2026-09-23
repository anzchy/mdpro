//! Purpose: run the one-shot cleanup that must happen as the app process exits.
//!
//! Pipeline: `RunEvent::Exit` (main.rs) -> `run_exit_cleanup` -> { `app.quit`
//! log line, MCP shutdown signal, `http_server::cleanup_server_config` }.
//!
//! Key decisions:
//! - Cleanup is bound to `RunEvent::Exit`, never `ExitRequested`: an
//!   `ExitRequested` can be vetoed, and running cleanup there left stale
//!   `server.port` / `server.token` files behind on every real quit.
//! - It deletes exactly the two MCP config files. Everything else under
//!   `data_dir()/mdpro` (drafts and siblings) is conserved byte for byte.
//! - It is idempotent and panic-free: repeated runs, an already-empty sender
//!   slot and a poisoned lock all leave the same end state. The poisoned lock
//!   is recovered with `into_inner`, so the MCP shutdown is still signalled.
//!
//! @coordinates-with src/main.rs (the only caller, from `RunEvent::Exit`)
//! @coordinates-with src/services/http_server.rs (`cleanup_server_config`)

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::{http_server, logger};
use serde_json::json;
use std::sync::Mutex;
use tokio::sync::oneshot;

/// Run the process-exit cleanup: log `app.quit`, signal the MCP HTTP server to
/// shut down, and remove the MCP server config files.
///
/// Never panics and never returns an error: it is the last thing to run before
/// the process goes away, so a poisoned lock, an empty sender slot or a missing
/// config file are all normal, and none of them may abort the remaining steps.
pub fn run_exit_cleanup(shutdown: &Mutex<Option<oneshot::Sender<()>>>) {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.quit".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({})),
        duration_ms: None,
        error: None,
    });

    // A poisoned lock still has to yield the sender: dropping it here would
    // leave the MCP HTTP server running with no one to shut it down.
    let sender = shutdown
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(tx) = sender {
        // The receiver is already gone if the server task ended first.
        let _ = tx.send(());
    }

    // Unconditional: the config files outlive the sender, so keying this on
    // `Some(tx)` would leave a stale server.port behind on the second run.
    http_server::cleanup_server_config();
}

#[cfg(test)]
#[path = "app_exit_tests.rs"]
mod tests;
