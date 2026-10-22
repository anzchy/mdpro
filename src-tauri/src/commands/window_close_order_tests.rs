use super::*;
use std::sync::{Arc, Mutex};

#[test]
fn d294_rejects_cross_window_and_main_targets() {
    assert!(validate_close_target("mdpro-a", "mdpro-b").is_err());
    assert!(validate_close_target("main", "main").is_err());
    assert!(validate_close_target("mdpro-a", "mdpro-a").is_ok());
}

#[test]
fn d294_stage_order_is_hide_then_wait_and_restore_is_show_only() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let hide = {
        let trace = trace.clone();
        move || {
            trace.lock().unwrap().push("hide");
            Ok(())
        }
    };
    let show = || Ok(());
    let wait = {
        let trace = trace.clone();
        async move { trace.lock().unwrap().push("wait") }
    };
    tauri::async_runtime::block_on(close_order_steps("stage", hide, show, wait, |_, _| {}))
        .unwrap();
    assert_eq!(*trace.lock().unwrap(), ["hide", "wait"]);

    trace.lock().unwrap().clear();
    let show = {
        let trace = trace.clone();
        move || {
            trace.lock().unwrap().push("show");
            Ok(())
        }
    };
    tauri::async_runtime::block_on(close_order_steps(
        "restore",
        || Ok(()),
        show,
        async {},
        |_, _| {},
    ))
    .unwrap();
    assert_eq!(*trace.lock().unwrap(), ["show"]);
}

#[test]
fn d294_stage_logs_have_ordered_steps_and_one_action_identity() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let emitted = events.clone();
    tauri::async_runtime::block_on(close_order_steps(
        "stage",
        || Ok(()),
        || Ok(()),
        async {},
        move |step, status| {
            emitted.lock().unwrap().push(close_order_payload(
                "same-id", "mdpro-a", "stage", step, status,
            ))
        },
    ))
    .unwrap();
    let payloads = events.lock().unwrap();
    let rows: Vec<_> = payloads
        .iter()
        .map(|p| serde_json::to_value(p).unwrap())
        .collect();
    assert_eq!(
        rows.iter()
            .map(|r| r["context"]["step"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["hide", "wait"]
    );
    assert!(rows.iter().all(|r| r["event"] == "window.close_order"
        && r["actionId"] == "same-id"
        && r["context"]["windowLabel"] == "mdpro-a"));
    let failed = serde_json::to_value(close_order_payload(
        "same-id",
        "mdpro-a",
        "invalid",
        "complete",
        LogStatus::Fail,
    ))
    .unwrap();
    assert_eq!(failed["status"], "fail");
    assert_eq!(failed["context"]["operation"], "invalid");
}

#[test]
fn d294_restore_and_failed_operations_emit_show_and_fail_steps() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let restored = events.clone();
    tauri::async_runtime::block_on(close_order_steps(
        "restore",
        || Ok(()),
        || Ok(()),
        async {},
        move |step, status| {
            restored.lock().unwrap().push(close_order_payload(
                "restore-id",
                "mdpro-a",
                "restore",
                step,
                status,
            ))
        },
    ))
    .unwrap();
    let hidden = events.clone();
    let hide_result = tauri::async_runtime::block_on(close_order_steps(
        "stage",
        || Err("hide failed".to_string()),
        || Ok(()),
        async {},
        move |step, status| {
            hidden.lock().unwrap().push(close_order_payload(
                "hide-id", "mdpro-a", "stage", step, status,
            ))
        },
    ));
    assert!(hide_result.is_err());
    let shown = events.clone();
    let show_result = tauri::async_runtime::block_on(close_order_steps(
        "restore",
        || Ok(()),
        || Err("show failed".to_string()),
        async {},
        move |step, status| {
            shown.lock().unwrap().push(close_order_payload(
                "show-id", "mdpro-a", "restore", step, status,
            ))
        },
    ));
    assert!(show_result.is_err());
    let rows: Vec<_> = events
        .lock()
        .unwrap()
        .iter()
        .map(|p| serde_json::to_value(p).unwrap())
        .collect();
    assert_eq!(
        rows.iter()
            .map(|r| r["context"]["step"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["show", "hide", "show"]
    );
    assert_eq!(
        rows.iter()
            .map(|r| r["status"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["success", "fail", "fail"]
    );
    assert_eq!(
        rows.iter()
            .map(|r| r["actionId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["restore-id", "hide-id", "show-id"]
    );
}

#[test]
fn d294_hide_failure_does_not_wait_or_close() {
    let waited = Arc::new(Mutex::new(false));
    let future = {
        let waited = waited.clone();
        async move { *waited.lock().unwrap() = true }
    };
    let result = tauri::async_runtime::block_on(close_order_steps(
        "stage",
        || Err("hide failed".to_string()),
        || Ok(()),
        future,
        |_, _| {},
    ));
    assert!(result.is_err());
    assert!(!*waited.lock().unwrap());
}

#[test]
fn d294_restore_failure_returns_error_without_waiting() {
    let waited = Arc::new(Mutex::new(false));
    let future = {
        let waited = waited.clone();
        async move { *waited.lock().unwrap() = true }
    };
    let result = tauri::async_runtime::block_on(close_order_steps(
        "restore",
        || Ok(()),
        || Err("show failed".to_string()),
        future,
        |_, _| {},
    ));
    assert!(result.is_err());
    assert!(!*waited.lock().unwrap());
}

#[test]
fn d294_invalid_operation_touches_neither_surface() {
    let touched = Arc::new(Mutex::new(false));
    let hide = {
        let touched = touched.clone();
        move || {
            *touched.lock().unwrap() = true;
            Ok(())
        }
    };
    assert!(tauri::async_runtime::block_on(close_order_steps(
        "bad",
        hide,
        || Ok(()),
        async {},
        |_, _| {}
    ))
    .is_err());
    assert!(!*touched.lock().unwrap());
}
