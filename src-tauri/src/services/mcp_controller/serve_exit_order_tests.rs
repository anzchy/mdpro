//! Test cases for D205: when a serve task exits by itself, "files present
//! <=> Running" must hold for every reader, and its cleanup must not reach
//! the next generation. The serve task used to turn the snapshot `Failed`,
//! release the cell lock, then unpublish and clear the token unlocked; a
//! reader in between saw `Failed` with the files still on disk (the
//! intermittent C-9 `(false, true)`), and a start of the next generation in
//! between had its files and token deleted.
//!
//! The `post_serve_exit` seam parks the serve task right after it applied
//! its exit, deterministically, the way `exit_publish_race_tests` parks a
//! start with `pre_publish`.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError};
use crate::services::mcp_controller::test_routers::{failable_serve, plain, stuck_serve_once};
use crate::services::mcp_controller::test_support::{
    files_present, read_published, remove_test_dir, temp_files_dir, test_env0, wait_until, GENEROUS,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tokio::time::timeout;

/// A parking `post_serve_exit` hook: it counts its calls, reports that it
/// parked, and waits for the release (bounded by `GENEROUS`).
struct Park {
    calls: Arc<AtomicUsize>,
    parked: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
}

fn park_hook() -> (Park, Arc<dyn Fn() + Send + Sync>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let (parked_tx, parked_rx) = mpsc::channel::<()>();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let parked_tx = Mutex::new(parked_tx);
    let release_rx = Mutex::new(release_rx);
    let counter = calls.clone();
    let hook: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        if let Ok(tx) = parked_tx.lock() {
            let _ = tx.send(());
        }
        if let Ok(rx) = release_rx.lock() {
            let _ = rx.recv_timeout(GENEROUS);
        }
    });
    (
        Park {
            calls,
            parked: parked_rx,
            release: release_tx,
        },
        hook,
    )
}

/// O1: the moment the snapshot reads `Failed`, the server files are gone and
/// no token is in memory.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn o1_failed_is_never_seen_with_the_files_or_the_token_still_there() {
    let dir = temp_files_dir("d205o1");
    let mut env = test_env0(&dir);
    let (serve, fails) = failable_serve();
    env.serve = serve;
    let (park, hook) = park_hook();
    env.post_serve_exit = Some(hook);
    let c = McpController::new(env);

    let up = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!((up.phase, up.generation), (McpPhase::Running, 1), "{up:?}");
    assert_eq!(files_present(&dir), (true, true), "gen 1 published");
    let fail = fails.recv_timeout(GENEROUS).expect("gen-1 fail sender");
    fail.send(()).expect("gen-1 serve alive");
    park.parked
        .recv_timeout(GENEROUS)
        .expect("the serve task never reached post_serve_exit");

    let now = c.snapshot().expect("snapshot");
    assert_eq!(
        (now.phase, now.error, now.generation),
        (McpPhase::Failed, Some(McpServerError::ServeFailed), 1)
    );
    assert_eq!(
        files_present(&dir),
        (false, false),
        "the snapshot reads Failed while server files are still published"
    );
    assert!(
        c.server_config().is_none(),
        "the snapshot reads Failed while a token is still in memory"
    );
    assert_eq!(park.calls.load(Ordering::SeqCst), 1, "seam reached once");

    park.release.send(()).expect("serve task still parked");
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// O2: a start of the next generation that lands while the failed serve
/// task is still finishing keeps its files and its token.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn o2_a_failed_generation_never_removes_the_next_generations_files_or_token() {
    let dir = temp_files_dir("d205o2");
    let mut env = test_env0(&dir);
    let (serve, fails) = failable_serve();
    env.serve = serve;
    let (park, hook) = park_hook();
    env.post_serve_exit = Some(hook);
    let c = Arc::new(McpController::new(env));

    let up = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!((up.phase, up.generation), (McpPhase::Running, 1), "{up:?}");
    let fail1 = fails.recv_timeout(GENEROUS).expect("gen-1 fail sender");
    fail1.send(()).expect("gen-1 serve alive");
    park.parked
        .recv_timeout(GENEROUS)
        .expect("the serve task never reached post_serve_exit");

    // Gen 2 starts while gen 1's serve task is parked.
    let up2 = timeout(GENEROUS, c.reconcile(true, plain()))
        .await
        .expect("start is bounded")
        .expect("snapshot");
    assert_eq!(
        (up2.phase, up2.generation),
        (McpPhase::Running, 2),
        "{up2:?}"
    );
    let _fail2 = fails.recv_timeout(GENEROUS).expect("gen-2 fail sender");
    let token2 = c.server_config().expect("gen-2 config").token;
    let port2 = up2.port.expect("gen-2 port");

    park.release.send(()).expect("serve task still parked");
    // Let gen 1's serve task finish whatever follows the seam.
    let finished = wait_until(GENEROUS, || park.calls.load(Ordering::SeqCst) == 1).await;
    assert!(finished, "seam reached once");
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert_eq!(
        read_published(&dir),
        Some((port2, token2.clone())),
        "gen 1's cleanup removed gen 2's server files"
    );
    assert_eq!(
        c.server_config().map(|cfg| cfg.token),
        Some(token2),
        "gen 1's cleanup cleared gen 2's token"
    );
    let now = c.snapshot().expect("snapshot");
    assert_eq!(
        (now.phase, now.generation),
        (McpPhase::Running, 2),
        "{now:?}"
    );

    // Gen 2's own exit on stop passes the seam too.
    let _ = park.release.send(());
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// O3 guard: an aborted stuck serve task (C-9 (a)) never runs the cleanup,
/// so the next generation's files stay.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn o3_guard_an_aborted_task_runs_no_cleanup() {
    let dir = temp_files_dir("d205o3");
    let mut env = test_env0(&dir);
    env.drain = Duration::from_millis(200);
    env.join_grace = Duration::from_millis(200);
    let (serve, fails) = stuck_serve_once();
    env.serve = serve;
    let (park, hook) = park_hook();
    env.post_serve_exit = Some(hook);
    let c = McpController::new(env);

    c.reconcile(true, plain()).await.expect("snapshot");
    let fail1 = fails.recv_timeout(GENEROUS).expect("gen-1 fail sender");
    let off = timeout(GENEROUS, c.reconcile(false, plain()))
        .await
        .expect("stop is bounded")
        .expect("snapshot");
    assert_eq!(off.phase, McpPhase::Disabled);
    let up2 = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(
        (up2.phase, up2.generation),
        (McpPhase::Running, 2),
        "{up2:?}"
    );
    let _fail2 = fails.recv_timeout(GENEROUS).expect("gen-2 fail sender");
    let _ = fail1.send(());
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert_eq!(
        park.calls.load(Ordering::SeqCst),
        0,
        "an aborted task applied its exit"
    );
    assert_eq!(files_present(&dir), (true, true), "gen 2's files");
    assert!(c.server_config().is_some(), "gen 2's token");
    drop(park);
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// O4 guard: `stop()` still ends `Disabled` with the files gone, and a
/// stopped server's task does not count as a serve failure.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn o4_guard_stop_ends_disabled_with_no_files() {
    let dir = temp_files_dir("d205o4");
    let mut env = test_env0(&dir);
    let (park, hook) = park_hook();
    env.post_serve_exit = Some(hook);
    let c = McpController::new(env);

    c.reconcile(true, plain()).await.expect("snapshot");
    // A gracefully stopped serve future also returns by itself; let the
    // seam pass straight through.
    park.release.send(()).expect("release queued");
    let off = timeout(GENEROUS, c.stop())
        .await
        .expect("stop is bounded")
        .expect("snapshot");
    assert_eq!((off.phase, off.error), (McpPhase::Disabled, None));
    assert_eq!(files_present(&dir), (false, false));
    assert!(c.server_config().is_none());
    remove_test_dir(&dir);
}

/// O5 guard (C-11a): `snapshot()` answers from a plain thread while the
/// failed serve task is parked after applying its exit.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn o5_guard_snapshot_answers_while_the_serve_task_is_parked() {
    let dir = temp_files_dir("d205o5");
    let mut env = test_env0(&dir);
    let (serve, fails) = failable_serve();
    env.serve = serve;
    let (park, hook) = park_hook();
    env.post_serve_exit = Some(hook);
    let c = Arc::new(McpController::new(env));

    c.reconcile(true, plain()).await.expect("snapshot");
    let fail = fails.recv_timeout(GENEROUS).expect("gen-1 fail sender");
    fail.send(()).expect("gen-1 serve alive");
    park.parked
        .recv_timeout(GENEROUS)
        .expect("the serve task never reached post_serve_exit");

    let reader = c.clone();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(reader.snapshot().map(|s| s.phase));
    });
    let phase = rx.recv_timeout(GENEROUS).expect("snapshot() answered");
    assert_eq!(phase.expect("snapshot"), McpPhase::Failed);

    park.release.send(()).expect("serve task still parked");
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}
