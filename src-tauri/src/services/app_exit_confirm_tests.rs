//! S-8 (ADR-0042 WI-4): `run_exit_cleanup` on a controller whose stop hook
//! drives the confirmation broker cancels a pending confirmation as
//! `AppExit` exactly once, and a second run leaves the same end state.
//! Temp `$HOME`, `temp_files_dir`, `127.0.0.1` ephemeral ports only.

use super::*;
use crate::services::mcp_confirm::queue::{Cause, Outcome};
use crate::services::mcp_confirm::stop_hook;
use crate::services::mcp_confirm::test_effects::{
    broker, meta, resolved_for, spawn_confirm, Call, RecordingEffects,
};
use crate::services::mcp_confirm::payload::CONFIRM_REQUEST_EVENT;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    files_present, remove_test_dir, temp_files_dir, test_env0, wait_until, GENEROUS,
};
use crate::services::window_restore::test_home::TestHome;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc};
use tokio::time::timeout;

/// One run on a std thread under `catch_unwind`; true iff it returned.
fn run_once(c: &Arc<McpController>) -> bool {
    let (tx, rx) = mpsc::channel();
    let c = c.clone();
    std::thread::spawn(move || {
        let ok = catch_unwind(AssertUnwindSafe(|| run_exit_cleanup(&c))).is_ok();
        let _ = tx.send(ok);
    });
    tokio::task::block_in_place(|| rx.recv_timeout(GENEROUS)).unwrap_or(false)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s8_exit_cleanup_twice_cancels_as_app_exit_once() {
    let _h = TestHome::new("exit_s8");
    let dir = temp_files_dir("s8");
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let env = test_env0(&dir).with_stop_hook(stop_hook(b.clone()));
    let c = Arc::new(McpController::new(env));
    let s = timeout(GENEROUS, c.start(plain())).await.expect("start").expect("snap");
    assert_eq!(s.phase, McpPhase::Running, "precondition");
    let waiter = spawn_confirm(&b, "B");
    assert!(wait_until(GENEROUS, || b.shown("B").is_some()).await, "shown");

    let mut states = Vec::new();
    for run in 1..=2 {
        assert!(run_once(&c), "run {run}: panicked or hung");
        assert_eq!(b.pending_len(), 0, "run {run}");
        assert_eq!(files_present(&dir), (false, false), "run {run}");
        let later = timeout(GENEROUS, b.confirm("A", meta())).await.expect("immediate");
        assert_eq!(later, Outcome::Cancelled(Cause::AppExit), "run {run}");
        let snap = format!("{:?}", c.snapshot());
        states.push((b.pending_len(), files_present(&dir), snap));
    }
    assert_eq!(states[0], states[1], "run 2 differs from run 1");

    let out = timeout(GENEROUS, waiter).await.expect("woken").expect("task");
    assert_eq!(out, Outcome::Cancelled(Cause::AppExit));
    let calls = fx.calls();
    let ends = resolved_for(&calls, "r0");
    assert_eq!(ends.len(), 1, "resolved exactly once: {ends:?}");
    assert_eq!(ends[0].2, "cancelled");
    let prompted_a = calls.iter().any(|c| {
        matches!(c, Call::Emit { window, event, .. }
            if window == "A" && event == CONFIRM_REQUEST_EVENT)
    });
    assert!(!prompted_a, "no prompt after exit");
    remove_test_dir(&dir);
}
