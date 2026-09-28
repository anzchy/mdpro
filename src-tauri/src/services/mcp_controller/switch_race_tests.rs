//! S-10 (ADR-0040 WI-7b): concurrent switches are serialized end to end.
//! Two toggles (e.g. two windows' settings pages) must not interleave as
//! persist A -> persist B -> reconcile B -> reconcile A, which would leave
//! the disk at B and the server at A. The persist stub parks call A after its
//! write, starts call B, then releases A. Temp `$HOME` (`TestHome`), temp
//! files dir, real sockets on `127.0.0.1`.

use super::switch_tests::{disk_enabled, seed_disk, BIN};
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::switch::set_server_enabled;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{remove_test_dir, temp_files_dir, test_env0};
use crate::services::preferences_mcp::persist_server_enabled;
use crate::services::window_restore::test_home::TestHome;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// How long call B gets to run to completion while call A is parked. On
/// unserialized code B finishes in milliseconds; serialized, it cannot.
const B_WINDOW: Duration = Duration::from_millis(1500);
/// Upper bound on each call once A is released.
const JOIN_BOUND: Duration = Duration::from_secs(15);

type Events = Arc<Mutex<Vec<&'static str>>>;

fn push(events: &Events, what: &'static str) {
    events.lock().expect("event log").push(what);
}

fn index_of(events: &[&'static str], what: &str) -> usize {
    events
        .iter()
        .position(|e| *e == what)
        .unwrap_or_else(|| panic!("event {what:?} missing from {events:?}"))
}

/// S-10: A(true) persists and parks inside the persist; B(false) is started
/// and given a window; A is released. Afterwards the disk agrees with the
/// server, and B's persist began only after A's switch (reconcile included)
/// had returned.
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn s10_concurrent_switches_are_serialized_so_disk_matches_the_server() {
    let h = TestHome::new("wi7b_s10");
    seed_disk(&h.dir, false);
    let dir = temp_files_dir("s10");
    let c = Arc::new(McpController::new(test_env0(&dir)));
    let events: Events = Arc::new(Mutex::new(Vec::new()));

    let (parked_tx, parked_rx) = tokio::sync::oneshot::channel::<()>();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let persist_a = {
        let events = events.clone();
        move |enabled: bool| {
            push(&events, "A persist-start");
            let r = persist_server_enabled(enabled);
            push(&events, "A persist-end");
            let _ = parked_tx.send(());
            // Park A between its persist and its reconcile.
            let _ = release_rx.recv_timeout(JOIN_BOUND);
            r
        }
    };
    let task_a = {
        let (c, events) = (c.clone(), events.clone());
        tokio::spawn(async move {
            let r = set_server_enabled(&c, persist_a, true, plain(), BIN.into()).await;
            push(&events, "A done");
            r
        })
    };
    tokio::time::timeout(JOIN_BOUND, parked_rx)
        .await
        .expect("A never reached its persist")
        .expect("A's persist stub dropped its signal");

    let persist_b = {
        let events = events.clone();
        move |enabled: bool| {
            push(&events, "B persist-start");
            let r = persist_server_enabled(enabled);
            push(&events, "B persist-end");
            r
        }
    };
    let mut task_b = {
        let (c, events) = (c.clone(), events.clone());
        tokio::spawn(async move {
            let r = set_server_enabled(&c, persist_b, false, plain(), BIN.into()).await;
            push(&events, "B done");
            r
        })
    };
    // Give B its window while A is parked; serialized, B cannot finish here.
    let early_b = tokio::time::timeout(B_WINDOW, &mut task_b).await.ok();
    let _ = release_tx.send(());

    let res_a = tokio::time::timeout(JOIN_BOUND, task_a)
        .await
        .expect("A hung after release")
        .expect("A panicked");
    let res_b = match early_b {
        Some(joined) => joined,
        None => tokio::time::timeout(JOIN_BOUND, task_b)
            .await
            .expect("B hung after A finished"),
    }
    .expect("B panicked");
    assert!(res_a.is_ok(), "A: {res_a:?}");
    assert!(res_b.is_ok(), "B: {res_b:?}");

    let log = events.lock().expect("event log").clone();
    let phase = c.snapshot().expect("snapshot").phase;
    let disk = disk_enabled(&h.dir);
    let want_phase = if disk {
        McpPhase::Running
    } else {
        McpPhase::Disabled
    };
    assert_eq!(
        phase, want_phase,
        "disk says serverEnabled={disk} but the server is {phase:?}; events {log:?}"
    );
    assert!(
        index_of(&log, "B persist-start") > index_of(&log, "A done"),
        "B persisted before A's reconcile finished: {log:?}"
    );
    assert!(!disk, "B ran last, so the disk must hold B's false");

    c.reconcile(false, plain()).await.expect("cleanup");
    remove_test_dir(&dir);
}
