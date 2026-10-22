//! Purpose: stage a secondary window's teardown in native code after frontend
//! consent, so WebKit's pending scrolling work gets a short drain interval.
//! The frontend still calls its ordinary guarded `close()` after this returns.

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::json;
use std::future::Future;
use std::time::Duration;
use tauri::WebviewWindow;
use uuid::Uuid;

/// A mitigation interval spanning several 60 Hz display periods. This does
/// not establish that WebKit has finished every pending display-link callback.
const CLOSE_SCROLL_SETTLE_MS: u64 = 50;

fn validate_close_target(caller: &str, requested: &str) -> Result<(), String> {
    if caller != requested || caller == "main" {
        return Err("window_close_target_refused".to_string());
    }
    Ok(())
}

async fn close_order_steps<H, S, W, E>(
    operation: &str,
    mut hide: H,
    mut show: S,
    wait: W,
    mut event: E,
) -> Result<(), String>
where
    H: FnMut() -> Result<(), String>,
    S: FnMut() -> Result<(), String>,
    W: Future<Output = ()>,
    E: FnMut(&'static str, LogStatus),
{
    match operation {
        "stage" => {
            if let Err(error) = hide() {
                event("hide", LogStatus::Fail);
                return Err(error);
            }
            event("hide", LogStatus::Success);
            wait.await;
            event("wait", LogStatus::Success);
        }
        "restore" => {
            if let Err(error) = show() {
                event("show", LogStatus::Fail);
                return Err(error);
            }
            event("show", LogStatus::Success);
        }
        _ => {
            event("validate", LogStatus::Fail);
            return Err("window_close_operation_refused".to_string());
        }
    }
    Ok(())
}

fn close_order_payload(
    action_id: &str,
    label: &str,
    operation: &str,
    step: &str,
    status: LogStatus,
) -> LogEntryPayload {
    LogEntryPayload {
        level: if matches!(status, LogStatus::Fail) {
            LogLevel::Error
        } else {
            LogLevel::Info
        },
        event: "window.close_order".to_string(),
        status,
        action_id: Some(action_id.to_string()),
        context: Some(json!({ "windowLabel": label, "operation": operation, "step": step })),
        duration_ms: None,
        error: None,
    }
}

fn log_step(action_id: &str, label: &str, operation: &str, step: &str, status: LogStatus) {
    logger::log_event(close_order_payload(
        action_id, label, operation, step, status,
    ));
}

/// Hide, wait, or restore only the window injected for this caller.
pub(super) async fn run_close_order(
    window: WebviewWindow,
    window_label: String,
    operation: String,
) -> Result<(), String> {
    let action_id = Uuid::new_v4().to_string();
    let label = window.label();
    let operation_log = match operation.as_str() {
        "stage" => "stage",
        "restore" => "restore",
        _ => "invalid",
    };
    log_step(
        &action_id,
        label,
        operation_log,
        "validate",
        LogStatus::Start,
    );
    if let Err(reason) = validate_close_target(label, &window_label) {
        log_step(
            &action_id,
            label,
            operation_log,
            "validate",
            LogStatus::Fail,
        );
        return Err(reason);
    }
    let result = close_order_steps(
        &operation,
        || {
            window
                .hide()
                .map_err(|_| "window_close_hide_failed".to_string())
        },
        || {
            window
                .show()
                .map_err(|_| "window_close_show_failed".to_string())
        },
        tokio::time::sleep(Duration::from_millis(CLOSE_SCROLL_SETTLE_MS)),
        |step, status| log_step(&action_id, label, operation_log, step, status),
    )
    .await;
    match &result {
        Ok(()) => log_step(
            &action_id,
            label,
            operation_log,
            "complete",
            LogStatus::Success,
        ),
        Err(_) => log_step(
            &action_id,
            label,
            operation_log,
            "complete",
            LogStatus::Fail,
        ),
    }
    result
}

#[cfg(test)]
#[path = "window_close_order_tests.rs"]
mod tests;
