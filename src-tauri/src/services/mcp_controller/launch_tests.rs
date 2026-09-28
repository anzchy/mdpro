//! L-1, L-2, L-2c and L-3 (ADR-0040 WI-5): the launch decision applied
//! through the controller. Launch holds the transition lock from the moment
//! `launch` returns, so a toggle issued during launch applies after it; its
//! log lines carry enum strings and a port, never OS text, a path or a token.
//!
//! Every test holds a `TestHome` (temp `$HOME` under `HOME_LOCK`), publishes
//! into a `temp_files_dir`, and binds `127.0.0.1` ephemeral ports only.

use super::controller::McpController;
use super::files::{PORT_FILE, TOKEN_FILE};
use super::launch::launch;
use super::snapshot::{McpPhase, McpServerError, McpSnapshot};
use super::test_routers::{gated, plain};
use super::test_support::{
    files_present, force_logger_on, hold_port, is_enum_string, loopback, read_published,
    remove_test_dir, start_lines, temp_files_dir, test_env, test_env0, GENEROUS,
};
use crate::services::mcp_launch::{
    decide_mcp_launch, launch_log_entry, read_server_enabled, McpLaunchDecision, SkipReason,
    StartReason,
};
use crate::services::window_restore::test_home::{
    read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::time::timeout;

const START: McpLaunchDecision = McpLaunchDecision::Start(StartReason::Enabled);
const SKIP: McpLaunchDecision = McpLaunchDecision::Skip(SkipReason::Disabled);

fn snap(
    phase: McpPhase,
    port: Option<u16>,
    error: Option<McpServerError>,
    gen: u64,
) -> McpSnapshot {
    McpSnapshot {
        phase,
        port,
        error,
        generation: gen,
    }
}

/// A controller on `127.0.0.1:0` over a fresh temp files dir.
fn controller(label: &str) -> (Arc<McpController>, std::path::PathBuf) {
    let dir = temp_files_dir(label);
    (Arc::new(McpController::new(test_env0(&dir))), dir)
}

/// L-1: a Skip launch removes stale files, sets Disabled at generation 0,
/// and leaves `config.json` byte-identical (no `.tmp` either).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l1_skip_launch_removes_stale_files_and_leaves_config_bytes() {
    let h = TestHome::new("mcp_l1");
    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));
    let (c, dir) = controller("l1");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(PORT_FILE), "55045").unwrap();
    fs::write(dir.join(TOKEN_FILE), "stale").unwrap();

    let decision = decide_mcp_launch(read_server_enabled());
    assert_eq!(decision, SKIP, "precondition: the disk says skip");
    let h1 = launch(c.clone(), decision, plain());
    timeout(GENEROUS, h1)
        .await
        .expect("launch hung")
        .expect("launch task");

    assert_eq!(
        c.snapshot().expect("snapshot"),
        snap(McpPhase::Disabled, None, None, 0)
    );
    assert_eq!(files_present(&dir), (false, false), "stale files survived");
    assert_eq!(read_config_bytes(&h.dir), before, "config.json rewritten");
    assert!(
        !h.dir.join(".mdpro").join("config.json.tmp").exists(),
        "config.json.tmp written"
    );
    remove_test_dir(&dir);
}

/// L-2: a toggle issued during launch applies after launch, both orders.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l2_a_toggle_issued_during_launch_applies_after_it() {
    let _h = TestHome::new("mcp_l2");

    // (a) Start (gated), then reconcile(false) while the start is parked.
    let (c, dir) = controller("l2a");
    let g = gated();
    let h1 = launch(c.clone(), START, g.factory);
    let c2 = c.clone();
    let off = tokio::spawn(async move { c2.reconcile(false, plain()).await });
    timeout(GENEROUS, g.entered)
        .await
        .expect("launch never reached the router factory")
        .expect("launch dropped the router factory");
    let _ = g.release.send(());
    timeout(GENEROUS, h1)
        .await
        .expect("launch hung")
        .expect("launch task");
    let off = timeout(GENEROUS, off)
        .await
        .expect("reconcile hung")
        .expect("task");
    assert!(off.is_ok(), "(a) reconcile: {off:?}");
    let s = c.snapshot().expect("snapshot");
    assert_eq!(
        (s.phase, s.generation),
        (McpPhase::Disabled, 1),
        "(a) {s:?}"
    );
    assert_eq!(files_present(&dir), (false, false), "(a) files left");
    remove_test_dir(&dir);

    // (b) Skip, then an immediately spawned reconcile(true).
    let (c, dir) = controller("l2b");
    let h1 = launch(c.clone(), SKIP, plain());
    let c2 = c.clone();
    let on = tokio::spawn(async move { c2.reconcile(true, plain()).await });
    timeout(GENEROUS, h1)
        .await
        .expect("launch hung")
        .expect("launch task");
    let on = timeout(GENEROUS, on)
        .await
        .expect("reconcile hung")
        .expect("task");
    assert!(on.is_ok(), "(b) reconcile: {on:?}");
    let s = c.snapshot().expect("snapshot");
    assert_eq!((s.phase, s.generation), (McpPhase::Running, 1), "(b) {s:?}");
    assert_eq!(files_present(&dir), (true, true), "(b) files missing");
    timeout(GENEROUS, c.stop())
        .await
        .expect("stop")
        .expect("snap");
    remove_test_dir(&dir);
}

/// L-2c: on a current-thread runtime the lock is already held when `launch`
/// returns, before the test awaits anything.
#[tokio::test(flavor = "current_thread")]
async fn l2c_the_lock_is_held_when_launch_returns() {
    let _h = TestHome::new("mcp_l2c");

    let (c, dir) = controller("l2c-start");
    let g = gated();
    let h1 = launch(c.clone(), START, g.factory);
    let held = !c.inner_try_lock_for_test();
    let c2 = c.clone();
    let off = tokio::spawn(async move { c2.reconcile(false, plain()).await });
    let entered = timeout(GENEROUS, g.entered).await;
    let _ = g.release.send(());
    let _ = timeout(GENEROUS, h1).await;
    let _ = timeout(GENEROUS, off).await;
    assert!(held, "Start: the lock was free when launch returned");
    assert!(
        matches!(entered, Ok(Ok(()))),
        "Start: factory never entered"
    );
    let s = c.snapshot().expect("snapshot");
    assert_eq!(
        (s.phase, s.generation),
        (McpPhase::Disabled, 1),
        "Start: {s:?}"
    );
    assert_eq!(files_present(&dir), (false, false), "Start: files left");
    remove_test_dir(&dir);

    let (c, dir) = controller("l2c-skip");
    let h1 = launch(c.clone(), SKIP, plain());
    let held = !c.inner_try_lock_for_test();
    timeout(GENEROUS, h1)
        .await
        .expect("launch hung")
        .expect("launch task");
    assert!(held, "Skip: the lock was free when launch returned");
    assert!(
        c.inner_try_lock_for_test(),
        "Skip: the lock was not released"
    );
    remove_test_dir(&dir);
}

/// Run one launch to completion; returns the start lines it added.
async fn run(home: &Path, c: Arc<McpController>, decision: McpLaunchDecision) -> Vec<String> {
    let before = start_lines(home).len();
    let h1 = launch(c, decision, plain());
    timeout(GENEROUS, h1)
        .await
        .expect("launch hung")
        .expect("launch task");
    start_lines(home)[before..].to_vec()
}

/// L-3: launch log lines carry enum strings and a port, never OS text.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l3_launch_log_lines_carry_enums_and_a_port_never_os_text() {
    let h = TestHome::new("mcp_l3");
    let _log = force_logger_on();

    // Start ok.
    seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
    let (ok, ok_dir) = controller("l3-ok");
    let ok_lines = run(&h.dir, ok.clone(), decide_mcp_launch(read_server_enabled())).await;
    let (port, token) = read_published(&ok_dir).expect("Start ok published nothing");
    timeout(GENEROUS, ok.stop())
        .await
        .expect("stop")
        .expect("snap");

    // Start with the port in use.
    let (_held, p) = hold_port();
    let in_use_dir = temp_files_dir("l3-in-use");
    let in_use = Arc::new(McpController::new(test_env(&in_use_dir, loopback(p))));
    let in_use_lines = run(&h.dir, in_use, START).await;

    // Skip.
    seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));
    let (skip, skip_dir) = controller("l3-skip");
    let skip_lines = run(&h.dir, skip, decide_mcp_launch(read_server_enabled())).await;

    // Fail-open start over a corrupt config.
    write_raw_config(&h.dir, "{ not json");
    let (open, open_dir) = controller("l3-open");
    let open_lines = run(
        &h.dir,
        open.clone(),
        decide_mcp_launch(read_server_enabled()),
    )
    .await;
    timeout(GENEROUS, open.stop())
        .await
        .expect("stop")
        .expect("snap");

    let parsed = |l: &String| serde_json::from_str::<Value>(l).expect("json line");
    let all = [&ok_lines, &in_use_lines, &skip_lines, &open_lines];
    // First, so no later message (they print lines) can print the token.
    for line in all.into_iter().flatten() {
        let leaked = line.contains(token.as_str());
        assert!(!leaked, "a launch log line carries the token");
    }
    assert_eq!(ok_lines.len(), 1, "Start ok: {ok_lines:?}");
    let ok_rec = parsed(&ok_lines[0]);
    assert_eq!(ok_rec["context"]["port"], json!(port), "Start ok: {ok_rec}");
    assert_eq!(ok_rec["level"], json!("info"), "Start ok: {ok_rec}");
    assert_eq!(in_use_lines.len(), 1, "in use: {in_use_lines:?}");
    let in_use_rec = parsed(&in_use_lines[0]);
    assert_eq!(in_use_rec["level"], json!("error"), "in use: {in_use_rec}");
    assert_eq!(
        in_use_rec["context"]["error"],
        json!("bind_in_use"),
        "in use"
    );
    assert_eq!(open_lines.len(), 2, "fail-open: {open_lines:?}");
    assert_eq!(
        parsed(&open_lines[0])["context"]["outcome"],
        json!("fail_open")
    );

    assert_eq!(skip_lines.len(), 1, "Skip: {skip_lines:?}");
    let want = launch_log_entry(SKIP).expect("Skip has a log line");
    let got = parsed(&skip_lines[0]);
    assert_eq!(got["level"], serde_json::to_value(want.level).unwrap());
    assert_eq!(got["status"], serde_json::to_value(want.status).unwrap());
    assert_eq!(got["context"], want.context.unwrap());
    assert!(got.get("error").is_none_or(Value::is_null), "Skip: {got}");

    let allowed = ["outcome", "reason", "kind", "port", "phase", "error"];
    for line in all.into_iter().flatten() {
        for bad in ["os error", "Address already in use", "/"] {
            assert!(!line.contains(bad), "{bad:?} in {line}");
        }
        let rec = parsed(line);
        if let Some(e) = rec.get("error").filter(|e| !e.is_null()) {
            assert!(
                e.as_str().is_some_and(is_enum_string),
                "error {e} in {line}"
            );
        }
        let ctx = rec["context"].as_object().expect("context object");
        for (k, v) in ctx {
            assert!(allowed.contains(&k.as_str()), "key {k} in {line}");
            let ok = v.as_u64().is_some() || v.as_str().is_some_and(is_enum_string);
            assert!(ok, "value {v} of {k} in {line}");
        }
    }
    for dir in [&ok_dir, &in_use_dir, &skip_dir, &open_dir] {
        remove_test_dir(dir);
    }
}
