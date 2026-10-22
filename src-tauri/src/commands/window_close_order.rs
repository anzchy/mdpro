//! Purpose: stage a secondary window's teardown after frontend consent.
//! The default waits for a main-thread hide acknowledgement before its short
//! settle interval; the opt-in D294 diagnostic skips hide for comparison.
//! The frontend still calls its ordinary guarded `close()` after this returns.

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::json;
use std::future::Future;
#[cfg(not(feature = "d294-diag-no-hide"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(feature = "d294-diag-no-hide"))]
use std::sync::Arc;
use std::time::Duration;
#[cfg(not(feature = "d294-diag-no-hide"))]
use tauri::Manager;
use tauri::WebviewWindow;
#[cfg(not(feature = "d294-diag-no-hide"))]
use tokio::sync::oneshot;
use uuid::Uuid;

/// A mitigation interval spanning several 60 Hz display periods. This does
/// not establish that WebKit has finished every pending display-link callback.
const CLOSE_SCROLL_SETTLE_MS: u64 = 50;
#[cfg(not(feature = "d294-diag-no-hide"))]
const HIDE_ACK_TIMEOUT_MS: u64 = 1_000;

#[cfg(feature = "d294-diag-no-hide")]
const CLOSE_VARIANT: &str = "no_hide";
#[cfg(not(feature = "d294-diag-no-hide"))]
const CLOSE_VARIANT: &str = "hide_ack";

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
            event("hide_ack", LogStatus::Success);
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
        context: Some(
            json!({ "windowLabel": label, "operation": operation, "step": step, "variant": CLOSE_VARIANT }),
        ),
        duration_ms: None,
        error: None,
    }
}

fn log_step(action_id: &str, label: &str, operation: &str, step: &str, status: LogStatus) {
    logger::log_event(close_order_payload(
        action_id, label, operation, step, status,
    ));
}

// Wry's main-thread hide message may return Ok when its native window was
// already removed. The registry can still contain the wrapper until Destroyed;
// its native getter fails once Wry has cleared the inner handle.
#[cfg(not(feature = "d294-diag-no-hide"))]
fn hide_registered_window<E, N, H>(exists: E, native_exists: N, hide: H) -> Result<(), String>
where
    E: FnOnce() -> bool,
    N: FnOnce() -> bool,
    H: FnOnce() -> Result<(), String>,
{
    if !exists() || !native_exists() {
        return Err("window_close_hide_failed".to_string());
    }
    hide()
}

/// Schedule the native hide and await its main-thread result before starting
/// the settle timer. A job still queued after timeout is cancelled before it
/// can hide a window which the frontend may already have restored.
#[cfg(not(feature = "d294-diag-no-hide"))]
async fn stage_with_ack<S, H, E>(schedule: S, hide: H, event: E) -> Result<(), String>
where
    S: FnOnce(Box<dyn FnOnce() + Send>) -> Result<(), String>,
    H: FnOnce() -> Result<(), String> + Send + 'static,
    E: Fn(&'static str, LogStatus) + Send + Sync + 'static,
{
    let event = Arc::new(event);
    let cancelled = Arc::new(AtomicBool::new(false));
    let (send, receive) = oneshot::channel();
    let native_event = event.clone();
    let native_cancelled = cancelled.clone();
    let job = Box::new(move || {
        if native_cancelled.load(Ordering::SeqCst) {
            return;
        }
        let result = hide();
        native_event(
            "hide",
            if result.is_ok() {
                LogStatus::Success
            } else {
                LogStatus::Fail
            },
        );
        let _ = send.send(result);
    });
    if schedule(job).is_err() {
        cancelled.store(true, Ordering::SeqCst);
        event("hide_ack", LogStatus::Fail);
        return Err("window_close_hide_failed".to_string());
    }
    match tokio::time::timeout(Duration::from_millis(HIDE_ACK_TIMEOUT_MS), receive).await {
        Ok(Ok(Ok(()))) => {
            event("hide_ack", LogStatus::Success);
            tokio::time::sleep(Duration::from_millis(CLOSE_SCROLL_SETTLE_MS)).await;
            event("wait", LogStatus::Success);
            Ok(())
        }
        _ => {
            cancelled.store(true, Ordering::SeqCst);
            event("hide_ack", LogStatus::Fail);
            Err("window_close_hide_failed".to_string())
        }
    }
}

#[cfg(feature = "d294-diag-no-hide")]
async fn stage_without_hide<E: Fn(&'static str, LogStatus)>(event: E) -> Result<(), String> {
    tokio::time::sleep(Duration::from_millis(CLOSE_SCROLL_SETTLE_MS)).await;
    event("wait", LogStatus::Success);
    Ok(())
}

/// Stage or restore only the injected caller window. The default stage awaits
/// native main-thread hide completion; the diagnostic build omits hide.
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
    let result = match operation.as_str() {
        "stage" => {
            #[cfg(not(feature = "d294-diag-no-hide"))]
            {
                let native_window = window.clone();
                let lookup_window = window.clone();
                let native_label = label.to_string();
                let dispatch_window = window.clone();
                let action = action_id.clone();
                let target = label.to_string();
                stage_with_ack(
                    move |job| {
                        dispatch_window
                            .run_on_main_thread(job)
                            .map_err(|e| e.to_string())
                    },
                    move || {
                        hide_registered_window(
                            || {
                                lookup_window
                                    .app_handle()
                                    .get_webview_window(&native_label)
                                    .is_some()
                            },
                            || lookup_window.is_visible().is_ok(),
                            || {
                                native_window
                                    .hide()
                                    .map_err(|_| "window_close_hide_failed".to_string())
                            },
                        )
                    },
                    move |step, status| log_step(&action, &target, "stage", step, status),
                )
                .await
            }
            #[cfg(feature = "d294-diag-no-hide")]
            {
                stage_without_hide(|step, status| {
                    log_step(&action_id, label, "stage", step, status)
                })
                .await
            }
        }
        "restore" => {
            close_order_steps(
                "restore",
                || Ok(()),
                || {
                    window
                        .show()
                        .map_err(|_| "window_close_show_failed".to_string())
                },
                async {},
                |step, status| log_step(&action_id, label, "restore", step, status),
            )
            .await
        }
        _ => {
            log_step(&action_id, label, "invalid", "validate", LogStatus::Fail);
            Err("window_close_operation_refused".to_string())
        }
    };
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
