//! Test cases for the exit-vs-publish race (ADR-0040 final review, M2/M4):
//! `begin_exit` lands after a start's last `exiting` check but before its
//! publish. The start must not leave `server.port` / `server.token` behind,
//! must not keep a token in memory, and must end `Disabled` — even if app
//! exit's bounded `stop` never gets the transition lock.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    files_present, remove_test_dir, temp_files_dir, test_env0, GENEROUS,
};
use std::sync::{mpsc, Arc, Mutex};
use tokio::time::timeout;

/// M4: park the start in the `pre_publish` window, run `begin_exit` there,
/// release it; once the start returns (no `stop` afterwards), nothing is
/// published, no token is in memory, and the phase is `Disabled`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn m4_begin_exit_between_the_exiting_check_and_publish_leaves_nothing() {
    let dir = temp_files_dir("m4");
    let (parked_tx, parked_rx) = mpsc::channel::<()>();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let parked_tx = Mutex::new(parked_tx);
    let release_rx = Mutex::new(release_rx);
    let mut env = test_env0(&dir);
    env.pre_publish = Some(Arc::new(move || {
        if let Ok(tx) = parked_tx.lock() {
            let _ = tx.send(());
        }
        if let Ok(rx) = release_rx.lock() {
            let _ = rx.recv_timeout(GENEROUS);
        }
    }));
    let c = Arc::new(McpController::new(env));

    let starter = c.clone();
    let start = tokio::spawn(async move { starter.start(plain()).await });
    parked_rx
        .recv_timeout(GENEROUS)
        .expect("start never reached the pre-publish window");
    c.begin_exit();
    release_tx.send(()).expect("start still parked");

    let snap = timeout(GENEROUS, start)
        .await
        .expect("start returned")
        .expect("start task")
        .expect("snapshot");

    assert_eq!(
        files_present(&dir),
        (false, false),
        "server files were published after begin_exit"
    );
    assert!(
        c.server_config().is_none(),
        "a token is in memory after begin_exit"
    );
    assert_eq!(snap.phase, McpPhase::Disabled, "start result phase");
    assert_eq!(
        c.snapshot().expect("snapshot").phase,
        McpPhase::Disabled,
        "controller phase"
    );
    remove_test_dir(&dir);
}
