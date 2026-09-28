//! Test cases for serve exits and snapshot reads (ADR-0040 WI-3: C-9c,
//! C-9, C-11). C-9c is pure; C-9 and C-11 use real sockets on `127.0.0.1`.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::serve::ServeError;
use crate::services::mcp_controller::snapshot::{
    apply_serve_exit, McpPhase, McpServerError, McpSnapshot, ServeExit,
};
use crate::services::mcp_controller::test_routers::{blocking_router, plain, stuck_serve_once};
use crate::services::mcp_controller::test_support::{
    files_present, raw_get, remove_test_dir, temp_files_dir, test_env0, wait_until, GENEROUS,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tokio::time::timeout;

const PHASES: [McpPhase; 5] = [
    McpPhase::Disabled,
    McpPhase::Starting,
    McpPhase::Running,
    McpPhase::Stopping,
    McpPhase::Failed,
];

fn c9c_snapshot(phase: McpPhase) -> McpSnapshot {
    let live = matches!(phase, McpPhase::Running | McpPhase::Stopping);
    McpSnapshot {
        phase,
        port: live.then_some(41234),
        error: (phase == McpPhase::Failed).then_some(McpServerError::BindInUse),
        generation: 7,
    }
}

/// The oracle, written independently of the implementation.
fn c9c_oracle(snap: McpSnapshot, exited_gen: u64, exit: ServeExit) -> McpSnapshot {
    let current = exited_gen == snap.generation;
    let should_be_live = matches!(snap.phase, McpPhase::Starting | McpPhase::Running);
    let by_itself = matches!(exit, ServeExit::Finished(_));
    if current && should_be_live && by_itself {
        McpSnapshot {
            phase: McpPhase::Failed,
            port: None,
            error: Some(McpServerError::ServeFailed),
            generation: 7,
        }
    } else {
        snap
    }
}

/// C-9c: `apply_serve_exit` over its whole bounded domain (30 rows).
#[test]
fn c9c_apply_serve_exit_over_its_whole_domain() {
    let exits = [
        ServeExit::Finished(Ok(())),
        ServeExit::Finished(Err(ServeError::Io)),
        ServeExit::Cancelled,
    ];
    let mut rows = 0;
    let mut wrong = Vec::new();
    for exited_gen in [7u64, 6] {
        for phase in PHASES {
            for exit in exits {
                rows += 1;
                let snap = c9c_snapshot(phase);
                let got = apply_serve_exit(snap, exited_gen, exit);
                let want = c9c_oracle(snap, exited_gen, exit);
                if got != want {
                    wrong.push(format!(
                        "({exited_gen}, {phase:?}, {exit:?}) → got {got:?} / want {want:?}"
                    ));
                }
            }
        }
    }
    assert_eq!(rows, 30);
    assert!(
        wrong.is_empty(),
        "{} rows wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// C-9: an aborted stuck task never reports `ServeFailed`; a
/// current-generation serve error does.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c9_an_aborted_task_is_not_serve_failed_but_a_current_error_is() {
    let dir = temp_files_dir("c9");
    let mut env = test_env0(&dir);
    env.drain = Duration::from_millis(200);
    env.join_grace = Duration::from_millis(200);
    let (serve, fails) = stuck_serve_once();
    env.serve = serve;
    let c = McpController::new(env);

    // (a)
    let up = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!((up.phase, up.generation), (McpPhase::Running, 1), "{up:?}");
    let fail1 = fails.recv_timeout(GENEROUS).expect("gen-1 fail sender");
    let off = timeout(GENEROUS, c.reconcile(false, plain()))
        .await
        .expect("stop is bounded")
        .expect("snapshot");
    assert_eq!(
        (off.phase, off.error, off.generation),
        (McpPhase::Disabled, None, 1)
    );
    let up2 = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(
        (up2.phase, up2.generation),
        (McpPhase::Running, 2),
        "{up2:?}"
    );
    let fail2 = fails.recv_timeout(GENEROUS).expect("gen-2 fail sender");
    let _ = fail1.send(());
    tokio::task::yield_now().await;
    let now = c.snapshot().expect("snapshot");
    assert_eq!(
        (now.phase, now.error, now.generation),
        (McpPhase::Running, None, 2)
    );
    let token = c.server_config().expect("config").token;
    let p2 = now.port.expect("port");
    assert_eq!(
        raw_get(p2, "/ping", Some(&token), GENEROUS).await.unwrap(),
        200
    );

    // (b)
    fail2.send(()).expect("gen-2 serve alive");
    let failed = wait_until(GENEROUS, || {
        c.snapshot().ok()
            == Some(McpSnapshot {
                phase: McpPhase::Failed,
                port: None,
                error: Some(McpServerError::ServeFailed),
                generation: 2,
            })
    })
    .await;
    assert!(
        failed,
        "never reported gen-2 ServeFailed: {:?}",
        c.snapshot()
    );
    assert_eq!(files_present(&dir), (false, false));
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// C-11(a): `snapshot()` answers from a plain thread while `stop()` is
/// parked in drain.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c11a_snapshot_answers_while_stop_is_parked_in_drain() {
    let dir = temp_files_dir("c11a");
    let mut env = test_env0(&dir);
    env.drain = Duration::from_secs(30);
    let c = Arc::new(McpController::new(env));
    let blocking = blocking_router();
    let up = c.start(blocking.factory()).await.expect("snapshot");
    assert_eq!(up.phase, McpPhase::Running, "start did not run: {up:?}");
    let p = up.port.expect("port");
    let token = c.server_config().expect("config").token;
    let client = tokio::spawn(async move { raw_get(p, "/block", Some(&token), GENEROUS).await });
    timeout(GENEROUS, blocking.entered)
        .await
        .expect("handler entered")
        .expect("entered sent");
    let stopper = c.clone();
    let stop = tokio::spawn(async move { stopper.stop().await });
    let observed = wait_until(GENEROUS, || {
        files_present(&dir) == (false, false)
            && c.server_config().is_none()
            && c.snapshot()
                .map(|s| s.phase != McpPhase::Running)
                .unwrap_or(false)
    })
    .await;
    assert!(observed, "never reached the C-4 observation point");

    let (tx, rx) = mpsc::channel();
    let reader = c.clone();
    std::thread::spawn(move || {
        let _ = tx.send(reader.snapshot());
    });
    let read = rx.recv_timeout(GENEROUS).expect("snapshot answered");
    assert_eq!(read.expect("snapshot").phase, McpPhase::Stopping);

    blocking.release.send(()).expect("handler waiting");
    let _ = timeout(GENEROUS, client).await;
    let _ = timeout(GENEROUS, stop).await.expect("stop returned");
    remove_test_dir(&dir);
}

/// C-11(b): a poisoned snapshot is `Err`, never a panic; no path in text.
#[test]
fn c11b_a_poisoned_snapshot_is_an_error_not_a_panic() {
    let dir = temp_files_dir("c11b");
    let c = McpController::new(test_env0(&dir));
    c.poison_snapshot_for_test();
    let read = catch_unwind(AssertUnwindSafe(|| c.snapshot()));
    let read = read.expect("snapshot() panicked");
    let err = read.expect_err("a poisoned snapshot was read through");
    assert!(!err.to_string().contains('/'), "error text names a path");
    remove_test_dir(&dir);
}

/// Test hook (added): `set_snapshot_for_test` is what `snapshot()` reads
/// back, including a `Stopping` row no real transition leaves behind.
#[test]
fn set_snapshot_for_test_is_read_back() {
    let dir = temp_files_dir("hook");
    let c = McpController::new(test_env0(&dir));
    let stopping = McpSnapshot {
        phase: McpPhase::Stopping,
        port: Some(41234),
        error: None,
        generation: 3,
    };
    c.set_snapshot_for_test(stopping);
    assert_eq!(c.snapshot().expect("snapshot"), stopping);
    remove_test_dir(&dir);
}
