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

#[cfg(not(feature = "d294-diag-no-hide"))]
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
        ["hide", "hide_ack", "wait"]
    );
    assert!(rows.iter().all(|r| r["event"] == "window.close_order"
        && r["actionId"] == "same-id"
        && r["context"]["windowLabel"] == "mdpro-a"
        && r["context"]["variant"] == "hide_ack"));
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

#[cfg(not(feature = "d294-diag-no-hide"))]
#[tokio::test(start_paused = true)]
async fn d294r_ack_waits_for_native_hide_then_full_settle() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let hidden = Arc::new(AtomicBool::new(false));
    let job = Arc::new(Mutex::new(None));
    let trace = Arc::new(Mutex::new(Vec::new()));
    let stage = tokio::spawn(stage_with_ack(
        {
            let job = job.clone();
            move |run| {
                *job.lock().unwrap() = Some(run);
                Ok(())
            }
        },
        {
            let hidden = hidden.clone();
            move || {
                hidden.store(true, Ordering::SeqCst);
                Ok(())
            }
        },
        {
            let trace = trace.clone();
            move |step, status| trace.lock().unwrap().push((step, status))
        },
    ));
    tokio::task::yield_now().await;
    assert!(!stage.is_finished());
    tokio::time::advance(Duration::from_millis(75)).await;
    assert!(!stage.is_finished());
    job.lock().unwrap().take().unwrap()();
    tokio::task::yield_now().await;
    assert!(hidden.load(Ordering::SeqCst));
    assert!(!stage.is_finished());
    tokio::time::advance(Duration::from_millis(49)).await;
    assert!(!stage.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(stage.await.unwrap().is_ok());
    assert_eq!(
        trace.lock().unwrap().as_slice(),
        &[
            ("hide", LogStatus::Success),
            ("hide_ack", LogStatus::Success),
            ("wait", LogStatus::Success)
        ]
    );
}

#[cfg(not(feature = "d294-diag-no-hide"))]
#[tokio::test(start_paused = true)]
async fn d294r_immediate_ack_still_waits_full_interval() {
    let stage = tokio::spawn(stage_with_ack(
        |run| {
            run();
            Ok(())
        },
        || Ok(()),
        |_, _| {},
    ));
    tokio::task::yield_now().await;
    assert!(!stage.is_finished());
    tokio::time::advance(Duration::from_millis(49)).await;
    assert!(!stage.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(stage.await.unwrap().is_ok());
}

#[cfg(not(feature = "d294-diag-no-hide"))]
#[tokio::test(start_paused = true)]
async fn d294r_scheduler_drop_timeout_and_late_job_never_wait_or_hide() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let dropped = stage_with_ack(|_run| Ok(()), || Ok(()), {
        let trace = trace.clone();
        move |step, _| trace.lock().unwrap().push(step)
    })
    .await;
    assert_eq!(dropped, Err("window_close_hide_failed".to_string()));
    assert_eq!(trace.lock().unwrap().as_slice(), &["hide_ack"]);

    trace.lock().unwrap().clear();
    let job = Arc::new(Mutex::new(None));
    let hidden = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stage = tokio::spawn(stage_with_ack(
        {
            let job = job.clone();
            move |run| {
                *job.lock().unwrap() = Some(run);
                Ok(())
            }
        },
        {
            let hidden = hidden.clone();
            move || {
                hidden.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            }
        },
        {
            let trace = trace.clone();
            move |step, _| trace.lock().unwrap().push(step)
        },
    ));
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(HIDE_ACK_TIMEOUT_MS)).await;
    assert_eq!(
        stage.await.unwrap(),
        Err("window_close_hide_failed".to_string())
    );
    job.lock().unwrap().take().unwrap()();
    assert!(!hidden.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(trace.lock().unwrap().as_slice(), &["hide_ack"]);
}

#[cfg(not(feature = "d294-diag-no-hide"))]
#[tokio::test]
async fn d294r_scheduler_and_native_hide_fail_closed() {
    let refused = stage_with_ack(
        |_run| Err("dispatch failed".to_string()),
        || Ok(()),
        |_, _| {},
    )
    .await;
    assert_eq!(refused, Err("window_close_hide_failed".to_string()));
    let steps = Arc::new(Mutex::new(Vec::new()));
    let failed = stage_with_ack(
        |run| {
            run();
            Ok(())
        },
        || Err("destroyed".to_string()),
        {
            let steps = steps.clone();
            move |step, status| steps.lock().unwrap().push((step, status))
        },
    )
    .await;
    assert_eq!(failed, Err("window_close_hide_failed".to_string()));
    assert_eq!(
        steps.lock().unwrap().as_slice(),
        &[("hide", LogStatus::Fail), ("hide_ack", LogStatus::Fail)]
    );
}

#[test]
fn d294r_diagnostic_feature_is_explicit_and_off_by_default() {
    let manifest = include_str!("../../Cargo.toml");
    assert!(manifest.contains("d294-diag-no-hide = []"));
    assert!(!manifest.contains("default = [\"d294-diag-no-hide\"]"));
    #[cfg(not(feature = "d294-diag-no-hide"))]
    assert_eq!(CLOSE_VARIANT, "hide_ack");
}

#[cfg(feature = "d294-diag-no-hide")]
#[tokio::test(start_paused = true)]
async fn d294r_diagnostic_waits_without_hide_or_ack_and_labels_every_line() {
    let steps = Arc::new(Mutex::new(Vec::new()));
    let task = tokio::spawn(stage_without_hide({
        let steps = steps.clone();
        move |step, status| {
            steps.lock().unwrap().push(
                serde_json::to_value(close_order_payload(
                    "same-id", "mdpro-a", "stage", step, status,
                ))
                .unwrap(),
            );
        }
    }));
    tokio::task::yield_now().await;
    assert!(!task.is_finished());
    tokio::time::advance(Duration::from_millis(49)).await;
    assert!(!task.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(task.await.unwrap().is_ok());
    let rows = steps.lock().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["context"]["step"], "wait");
    assert_eq!(rows[0]["context"]["variant"], "no_hide");
    assert_eq!(rows[0]["actionId"], "same-id");
}

#[cfg(not(feature = "d294-diag-no-hide"))]
#[test]
fn d294r_destroyed_window_rejects_noop_hide() {
    let hide_called = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let result = hide_registered_window(|| true, || false, {
        let hide_called = hide_called.clone();
        move || {
            hide_called.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }
    });
    assert_eq!(result, Err("window_close_hide_failed".to_string()));
    assert!(!hide_called.load(std::sync::atomic::Ordering::SeqCst));
    assert!(hide_registered_window(|| true, || true, || Ok(())).is_ok());
}

#[test]
fn d294r_default_feature_check_catches_companion_features() {
    fn default_features(manifest: &str) -> String {
        let section = manifest.split("[features]").nth(1).unwrap_or("");
        let section = section
            .split('\n')
            .take_while(|line| !line.starts_with('['));
        let mut collecting = false;
        let mut value = String::new();
        for line in section {
            let line = line.split('#').next().unwrap_or("").trim();
            if line.starts_with("default ") || line.starts_with("default=") {
                collecting = true;
            }
            if collecting {
                value.push_str(line);
                if line.contains(']') {
                    break;
                }
            }
        }
        value
    }
    let manifest = include_str!("../../Cargo.toml");
    assert!(!default_features(manifest).contains("d294-diag-no-hide"));
    let with_companion = manifest.replace(
        "d294-diag-no-hide = []",
        "default = [\"verify-run\", \"d294-diag-no-hide\"]\nd294-diag-no-hide = []",
    );
    assert!(default_features(&with_companion).contains("d294-diag-no-hide"));
}

#[test]
fn d294r_cargo_resolved_defaults_exclude_diagnostic() {
    use std::collections::HashSet;
    fn reaches(features: &serde_json::Value, target: &str) -> bool {
        let mut pending = vec!["default".to_string()];
        let mut seen = HashSet::new();
        while let Some(feature) = pending.pop() {
            if !seen.insert(feature.clone()) {
                continue;
            }
            if feature == target {
                return true;
            }
            if let Some(next) = features[&feature].as_array() {
                pending.extend(next.iter().filter_map(|v| v.as_str().map(str::to_string)));
            }
        }
        false
    }
    let metadata = std::process::Command::new("cargo")
        .args([
            "metadata",
            "--offline",
            "--no-deps",
            "--format-version",
            "1",
            "--manifest-path",
        ])
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .output()
        .unwrap();
    assert!(
        metadata.status.success(),
        "{}",
        String::from_utf8_lossy(&metadata.stderr)
    );
    let data: serde_json::Value = serde_json::from_slice(&metadata.stdout).unwrap();
    let package = data["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "tauri-app")
        .unwrap();
    assert!(!reaches(&package["features"], "d294-diag-no-hide"));
    let transitive =
        serde_json::json!({"default": ["verify-run"], "verify-run": ["d294-diag-no-hide"]});
    assert!(reaches(&transitive, "d294-diag-no-hide"));
}

#[cfg(not(feature = "d294-diag-no-hide"))]
#[tokio::test]
async fn d294r_failed_ack_logs_failure_without_wait() {
    let steps = Arc::new(Mutex::new(Vec::new()));
    let result = stage_with_ack(|_run| Ok(()), || Ok(()), {
        let steps = steps.clone();
        move |step, status| steps.lock().unwrap().push((step, status))
    })
    .await;
    assert_eq!(result, Err("window_close_hide_failed".to_string()));
    assert_eq!(
        steps.lock().unwrap().as_slice(),
        &[("hide_ack", LogStatus::Fail)]
    );
}
