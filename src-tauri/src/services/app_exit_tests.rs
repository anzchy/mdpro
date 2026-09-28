//! Test cases for `services::app_exit::run_exit_cleanup(&McpController)`
//! (ADR-0040 WI-5): L-4, L-5 and the migrated C5 log case. L-6 lives in
//! `app_exit_idempotence_tests.rs`.
//!
//! Stated spec change: the signature moved from `&Mutex<Option<Sender>>` to
//! `&McpController`. C1-C4 (sender signalled, `data_dir()` files removed,
//! poisoned sender slot) were deleted with that slot; L-6 is their
//! controller-era replacement. C5 is migrated unchanged apart from the
//! argument. Every test holds a temp `$HOME` (so no log reaches the real
//! `~/.mdpro`), a `temp_files_dir`, and `127.0.0.1` ephemeral ports only.

use super::*;
use crate::models::{LogLevel, LogSettings};
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::files::TOKEN_TMP_NAME;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError};
use crate::services::mcp_controller::test_routers::{blocking_router, gated, plain, Gated};
use crate::services::mcp_controller::test_support::{
    connect_refused, files_present, loopback, raw_get, read_published, remove_test_dir,
    temp_files_dir, test_env, test_env0, wait_until, with_free_port, SetupCollision, GENEROUS,
    TEST_DRAIN, TEST_EXIT_BUDGET, TEST_JOIN_GRACE,
};
use crate::services::window_restore::test_home::TestHome;
use std::fs;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tokio::time::timeout;

/// Run `run_exit_cleanup` on a std thread (no runtime context there, so
/// its `block_on` is legal) and wait for it without blocking the runtime.
fn exit_on_thread(c: &Arc<McpController>) -> Result<Duration, mpsc::RecvTimeoutError> {
    let (tx, rx) = mpsc::channel();
    let c = c.clone();
    std::thread::spawn(move || {
        let t0 = Instant::now();
        run_exit_cleanup(&c);
        let _ = tx.send(t0.elapsed());
    });
    tokio::task::block_in_place(|| rx.recv_timeout(GENEROUS))
}

/// L-4: exit during a start parked before publish. The start never
/// publishes (the sentinel survives), no listener survives, and a later
/// reconcile starts nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l4_exit_during_a_parked_start_never_publishes_and_nothing_restarts() {
    let _h = TestHome::new("exit_l4");
    with_free_port(|p| async move {
        let dir = temp_files_dir("l4");
        fs::create_dir_all(&dir).unwrap();
        let c = Arc::new(McpController::new(test_env(&dir, loopback(p))));
        let Gated {
            factory,
            entered,
            release,
        } = gated();
        let c2 = c.clone();
        let start = tokio::spawn(async move { c2.reconcile(true, factory).await });

        // 1. Parked in the router factory: bound, nothing published.
        let entered = timeout(GENEROUS, entered)
            .await
            .expect("start hung before bind");
        if entered.is_err() {
            let _ = timeout(GENEROUS, start).await;
            let err = c.snapshot().ok().and_then(|s| s.error);
            remove_test_dir(&dir);
            if err == Some(McpServerError::BindInUse) {
                return Err(SetupCollision);
            }
            panic!("start never reached the router factory: {err:?}");
        }

        // 2. Exit, bounded.
        let elapsed = exit_on_thread(&c).expect("run_exit_cleanup did not return");
        assert!(elapsed < GENEROUS, "exit took {elapsed:?}");

        // 3. A sentinel any publish would destroy.
        fs::write(dir.join(TOKEN_TMP_NAME), b"sentinel").unwrap();

        // 4. Let the start finish.
        let _ = release.send(());
        let _ = timeout(GENEROUS, start)
            .await
            .expect("start hung after release");
        let s = c.snapshot().expect("snapshot");
        assert_ne!(s.error, Some(McpServerError::PublishFailed), "{s:?}");
        assert!(
            fs::read(dir.join(TOKEN_TMP_NAME)).ok().as_deref() == Some(&b"sentinel"[..]),
            "a publish ran after exit"
        );
        assert_eq!(files_present(&dir), (false, false), "files after exit");
        assert_ne!(s.phase, McpPhase::Running, "{s:?}");
        assert!(
            wait_until(GENEROUS, || connect_refused(p)).await,
            "port {p} still accepts after exit"
        );

        // 5. Nothing restarts.
        let again = timeout(GENEROUS, c.reconcile(true, plain())).await;
        let again = again.expect("reconcile hung").expect("snapshot");
        assert_ne!(again.phase, McpPhase::Running, "{again:?}");
        std::net::TcpListener::bind(loopback(p)).expect("port is free again");
        remove_test_dir(&dir);
        Ok(())
    })
    .await;
}

/// L-5: exit with a handler blocked forever is bounded, the files are gone
/// on return, and the port is closed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l5_exit_with_a_handler_blocked_forever_is_bounded() {
    let _h = TestHome::new("exit_l5");
    assert!(
        TEST_EXIT_BUDGET > TEST_DRAIN + TEST_JOIN_GRACE,
        "precondition"
    );
    let dir = temp_files_dir("l5");
    let c = Arc::new(McpController::new(test_env0(&dir)));
    let b = blocking_router();
    let s = timeout(GENEROUS, c.start(b.factory()))
        .await
        .expect("start")
        .expect("snap");
    assert_eq!(s.phase, McpPhase::Running, "precondition: {s:?}");
    let (port, token) = read_published(&dir).expect("published");
    let client =
        tokio::spawn(async move { raw_get(port, "/block-forever", Some(&token), GENEROUS).await });
    timeout(GENEROUS, b.entered)
        .await
        .expect("handler never entered")
        .expect("entered");

    let elapsed = exit_on_thread(&c).expect("run_exit_cleanup did not return");

    assert!(elapsed < GENEROUS, "exit took {elapsed:?}");
    assert_eq!(files_present(&dir), (false, false), "files left on return");
    assert!(
        connect_refused(port),
        "port {port} still accepts after exit"
    );
    client.abort();
    remove_test_dir(&dir);
}

/// Restores the log settings on drop.
struct LogSettingsRestorer(LogSettings);
impl Drop for LogSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

fn quit_lines(path: &Path) -> Vec<serde_json::Value> {
    let text = fs::read_to_string(path).unwrap_or_default();
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.get("event").and_then(|e| e.as_str()) == Some("app.quit"))
        .collect()
}

/// C5 (migrated): exactly one `app.quit` success line per run, no content.
#[test]
fn c5_writes_exactly_one_app_quit_success_line_per_run_with_no_content() {
    let h = TestHome::new("exit_c5");
    let _log_guard = LogSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let log_path = h.dir.join(".mdpro").join("mdpro.log");
    let dir = temp_files_dir("c5");
    let c = McpController::new(test_env0(&dir));

    run_exit_cleanup(&c);
    let after_one = quit_lines(&log_path);
    assert_eq!(after_one.len(), 1, "expected one app.quit line per run");

    run_exit_cleanup(&c);
    let after_two = quit_lines(&log_path);
    assert_eq!(after_two.len(), 2, "expected one app.quit line per run");

    for line in &after_two {
        assert_eq!(line.get("status").and_then(|s| s.as_str()), Some("success"));
        let context = line.get("context").cloned().unwrap_or(json!({}));
        for key in ["content", "documentIds", "text"] {
            assert!(
                context.get(key).is_none(),
                "app.quit context leaked `{}`",
                key
            );
        }
    }
    remove_test_dir(&dir);
}
