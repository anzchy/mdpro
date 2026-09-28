//! Test cases for `McpController#start` / `#stop` ordering (ADR-0040 WI-3:
//! C-1..C-4, plus PC-2). Real sockets on `127.0.0.1`, files in a temp dir.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError, McpSnapshot};
use crate::services::mcp_controller::test_routers::{blocking_router, gated, plain};
use crate::services::mcp_controller::test_support::{
    connect_refused, files_present, hold_port, loopback, raw_get, read_published, remove_test_dir,
    temp_files_dir, test_env, test_env0, wait_until, with_free_port, SetupCollision, GENEROUS,
};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;

pub(crate) fn is_hex64(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// C-1: start publishes a fresh 64-hex token that equals the in-memory one.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c1_start_publishes_a_fresh_hex_token_equal_to_memory() {
    let dir = temp_files_dir("c1");
    let c = McpController::new(test_env0(&dir));
    let snap = c.start(plain()).await.expect("snapshot");
    assert_eq!(snap.phase, McpPhase::Running, "start did not run: {snap:?}");
    let p = snap.port.expect("running has a port");
    assert_ne!(p, 0);
    let want = McpSnapshot {
        phase: McpPhase::Running,
        port: Some(p),
        error: None,
        generation: 1,
    };
    assert_eq!(snap, want);
    assert_eq!(c.snapshot().expect("snapshot"), want);

    let (file_port, file_token) = read_published(&dir).expect("files published");
    assert_eq!(file_port, p);
    assert!(is_hex64(&file_token), "token is not 64 hex");
    let mem = c.server_config().expect("in-memory config set");
    assert!(mem.token == file_token, "in-memory token != file token");
    assert_eq!(mem.port, p);
    assert_eq!(
        raw_get(p, "/ping", Some(&file_token), GENEROUS)
            .await
            .unwrap(),
        200
    );

    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// C-2: tokens are fresh across 5 start/stop cycles; old tokens are revoked.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c2_tokens_are_fresh_across_cycles_and_old_ones_are_revoked() {
    let dir = temp_files_dir("c2");
    let c = McpController::new(test_env0(&dir));
    let mut tokens = Vec::new();
    let mut generations = Vec::new();
    for cycle in 1..=5u64 {
        let snap = c.start(plain()).await.expect("snapshot");
        assert_eq!(snap.phase, McpPhase::Running, "cycle {cycle}: {snap:?}");
        let p = snap.port.expect("port");
        let token = c.server_config().expect("config").token;
        generations.push(snap.generation);
        if let Some(previous) = tokens.last() {
            let old: &String = previous;
            assert_eq!(
                raw_get(p, "/ping", Some(old), GENEROUS).await.unwrap(),
                401,
                "cycle {cycle}: the previous token still works"
            );
        }
        assert_eq!(
            raw_get(p, "/ping", Some(&token), GENEROUS).await.unwrap(),
            200
        );
        tokens.push(token);
        c.stop().await.expect("stop");
    }
    let distinct: HashSet<&String> = tokens.iter().collect();
    assert_eq!(distinct.len(), 5, "tokens repeat across cycles");
    assert_eq!(generations, vec![1, 2, 3, 4, 5]);
    remove_test_dir(&dir);
}

/// C-3: a port held by someone else gives `Failed(BindInUse)` and no files.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c3_a_held_port_fails_with_bind_in_use_and_writes_no_files() {
    let dir = temp_files_dir("c3");
    let (_held, p) = hold_port();
    let c = McpController::new(test_env(&dir, loopback(p)));
    let snap = c.start(plain()).await.expect("snapshot");
    let want = McpSnapshot {
        phase: McpPhase::Failed,
        port: None,
        error: Some(McpServerError::BindInUse),
        generation: 1,
    };
    assert_eq!(snap, want);
    assert_eq!(c.snapshot().expect("snapshot"), want);
    assert!(c.server_config().is_none());
    assert_eq!(files_present(&dir), (false, false));
    remove_test_dir(&dir);
}

/// C-4 (r2): stop order observed at a deterministic point; the in-flight
/// request completes during drain; `Disabled` only after the join.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c4_stop_order_is_observable_and_the_in_flight_request_completes() {
    let dir = temp_files_dir("c4");
    let mut env = test_env0(&dir);
    env.drain = Duration::from_secs(30);
    let c = Arc::new(McpController::new(env));
    let blocking = blocking_router();
    let snap = c.start(blocking.factory()).await.expect("snapshot");
    assert_eq!(snap.phase, McpPhase::Running, "start did not run: {snap:?}");
    let p = snap.port.expect("port");
    let token = c.server_config().expect("config").token;

    let client_token = token.clone();
    let client =
        tokio::spawn(async move { raw_get(p, "/block", Some(&client_token), GENEROUS).await });
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
    assert!(
        observed,
        "never saw files gone + token cleared + not Running"
    );

    // (a) the handler is still parked, so the join cannot have happened.
    assert_eq!(c.snapshot().expect("snapshot").phase, McpPhase::Stopping);
    // (b) a new connection with the old token is refused or rejected.
    match raw_get(p, "/ping", Some(&token), GENEROUS).await {
        Ok(code) => assert_eq!(code, 401, "old token accepted during stop"),
        Err(e) => assert!(!e.is_timeout(), "new connection hung: {e}"),
    }

    blocking.release.send(()).expect("handler still waiting");
    // (c) graceful: the in-flight request completes.
    let answered = timeout(GENEROUS, client).await.expect("client done");
    assert_eq!(answered.expect("client task").expect("response"), 200);
    // (d) stop returns, then Disabled.
    let stopped = timeout(GENEROUS, stop).await.expect("stop returned");
    let snap = stopped.expect("stop task").expect("snapshot");
    assert_eq!(
        (snap.phase, snap.port, snap.error),
        (McpPhase::Disabled, None, None)
    );
    // (e)
    assert!(connect_refused(p), "port {p} still accepts after stop");
    remove_test_dir(&dir);
}

/// PC-2 (added): `exiting` set while a start is parked between bind and
/// publish: the start never publishes, never reaches Running, and drops its
/// listener; a later reconcile does not start either.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pc2_a_start_that_finds_exiting_never_publishes() {
    with_free_port(|p| async move {
        let dir = temp_files_dir("pc2");
        let c = Arc::new(McpController::new(test_env(&dir, loopback(p))));
        let gate = gated();
        let starter = c.clone();
        let factory = gate.factory;
        let mut start = tokio::spawn(async move { starter.reconcile(true, factory).await });
        tokio::select! {
            _ = gate.entered => {}
            r = &mut start => {
                let snap = r.expect("start task").expect("snapshot");
                assert_eq!(snap.error, Some(McpServerError::BindInUse), "{snap:?}");
                remove_test_dir(&dir);
                return Err(SetupCollision);
            }
        }
        assert!(
            !c.inner_try_lock_for_test(),
            "the transition lock is free while a start is parked"
        );
        c.mark_exiting();
        gate.release.send(()).expect("factory waiting");
        let snap = timeout(GENEROUS, start)
            .await
            .expect("start returned")
            .expect("start task")
            .expect("snapshot");
        assert_ne!(snap.phase, McpPhase::Running, "{snap:?}");
        assert_eq!(files_present(&dir), (false, false));
        assert!(c.server_config().is_none());
        assert!(wait_until(GENEROUS, || connect_refused(p)).await);

        let again = c.reconcile(true, plain()).await.expect("snapshot");
        assert_ne!(again.phase, McpPhase::Running, "{again:?}");
        assert_eq!(files_present(&dir), (false, false));
        remove_test_dir(&dir);
        Ok(())
    })
    .await;
}
