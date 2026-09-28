//! Test cases for `McpController#stop`'s abort path and rebinding
//! (ADR-0040 WI-3: C-5, C-5b, C-6, C-6b). Real sockets on `127.0.0.1`.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError, McpSnapshot};
use crate::services::mcp_controller::test_routers::{blocking_router, plain};
use crate::services::mcp_controller::test_support::{
    connect_refused, loopback, raw_get, remove_test_dir, temp_files_dir, test_env, test_env0,
    with_free_port, SetupCollision, GENEROUS,
};
use std::time::Duration;
use tokio::time::timeout;

/// C-5: a handler that never completes is dropped, and stop is bounded.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c5_a_handler_that_never_completes_is_dropped_and_stop_is_bounded() {
    let dir = temp_files_dir("c5");
    let c = McpController::new(test_env0(&dir));
    let blocking = blocking_router();
    let snap = c.start(blocking.factory()).await.expect("snapshot");
    assert_eq!(snap.phase, McpPhase::Running, "start did not run: {snap:?}");
    let p = snap.port.expect("port");
    let token = c.server_config().expect("config").token;
    let client =
        tokio::spawn(async move { raw_get(p, "/block-forever", Some(&token), 2 * GENEROUS).await });
    timeout(GENEROUS, blocking.entered)
        .await
        .expect("handler entered")
        .expect("entered sent");

    let snap = timeout(GENEROUS, c.stop())
        .await
        .expect("stop is bounded")
        .expect("snapshot");
    assert_eq!(snap.phase, McpPhase::Disabled);
    assert_eq!(c.snapshot().expect("snapshot").phase, McpPhase::Disabled);
    assert!(connect_refused(p), "port {p} still accepts after stop");

    let outcome = timeout(GENEROUS, client)
        .await
        .expect("the parked client was released by the abort")
        .expect("client task");
    match outcome {
        Ok(code) => panic!("a handler that never completes answered {code}"),
        Err(e) => assert!(!e.is_timeout(), "client timed out instead: {e}"),
    }
    remove_test_dir(&dir);
}

/// C-5b: after stop returns on the abort path, the handler future has been
/// dropped: its `done` sender is gone unsent.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c5b_after_an_abort_path_stop_the_handler_future_is_dropped() {
    let dir = temp_files_dir("c5b");
    let c = McpController::new(test_env0(&dir));
    let blocking = blocking_router();
    let snap = c.start(blocking.factory()).await.expect("snapshot");
    assert_eq!(snap.phase, McpPhase::Running, "start did not run: {snap:?}");
    let p = snap.port.expect("port");
    let token = c.server_config().expect("config").token;
    let _client =
        tokio::spawn(async move { raw_get(p, "/block-done", Some(&token), GENEROUS).await });
    timeout(GENEROUS, blocking.entered)
        .await
        .expect("handler entered")
        .expect("entered sent");

    timeout(GENEROUS, c.stop())
        .await
        .expect("stop is bounded")
        .expect("snapshot");
    let _ = blocking.release.send(());
    let done = timeout(GENEROUS, blocking.done).await;
    assert!(
        matches!(done, Ok(Err(_))),
        "the handler outlived stop and finished: {done:?}"
    );
    remove_test_dir(&dir);
}

/// C-6: the same port can be bound again immediately after a served
/// keep-alive connection.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c6_the_port_rebinds_immediately_after_a_keep_alive_connection() {
    with_free_port(|p| async move {
        let dir = temp_files_dir("c6");
        let c = McpController::new(test_env(&dir, loopback(p)));
        let first = c.start(plain()).await.expect("snapshot");
        if first.error == Some(McpServerError::BindInUse) {
            remove_test_dir(&dir);
            return Err(SetupCollision);
        }
        assert_eq!(
            first.phase,
            McpPhase::Running,
            "start did not run: {first:?}"
        );
        let token = c.server_config().expect("config").token;
        let keep_alive = reqwest::Client::builder()
            .no_proxy()
            .timeout(GENEROUS)
            .build()
            .expect("client");
        let code = keep_alive
            .get(format!("http://127.0.0.1:{p}/ping"))
            .header("X-MDPRO-Token", &token)
            .send()
            .await
            .expect("keep-alive GET")
            .status()
            .as_u16();
        assert_eq!(code, 200);

        c.stop().await.expect("stop");
        let second = c.start(plain()).await.expect("snapshot");
        assert_eq!(
            (second.phase, second.port, second.error),
            (McpPhase::Running, Some(p), None),
            "no immediate rebind: {second:?}"
        );
        let new_token = c.server_config().expect("config").token;
        assert_eq!(
            raw_get(p, "/ping", Some(&new_token), GENEROUS)
                .await
                .unwrap(),
            200
        );
        drop(keep_alive);
        c.stop().await.expect("stop");
        remove_test_dir(&dir);
        Ok(())
    })
    .await;
}

/// C-6b (r2: current_thread): after an abort-path stop, an immediate
/// `reconcile(true)` rebinds the same port.
#[tokio::test(flavor = "current_thread")]
async fn c6b_an_abort_path_stop_frees_the_port_for_an_immediate_restart() {
    with_free_port(|p| async move {
        let dir = temp_files_dir("c6b");
        let mut env = test_env(&dir, loopback(p));
        env.drain = Duration::from_millis(200);
        env.join_grace = Duration::from_millis(200);
        let c = McpController::new(env);
        let blocking = blocking_router();
        let first = c
            .reconcile(true, blocking.factory())
            .await
            .expect("snapshot");
        if first.error == Some(McpServerError::BindInUse) {
            remove_test_dir(&dir);
            return Err(SetupCollision);
        }
        assert_eq!(
            first.phase,
            McpPhase::Running,
            "start did not run: {first:?}"
        );
        let token = c.server_config().expect("config").token;
        let restart = blocking.factory();
        let _client =
            tokio::spawn(async move { raw_get(p, "/block-forever", Some(&token), GENEROUS).await });
        timeout(GENEROUS, blocking.entered)
            .await
            .expect("handler entered")
            .expect("entered sent");

        timeout(GENEROUS, c.stop())
            .await
            .expect("stop is bounded")
            .expect("snapshot");
        let second = c.reconcile(true, restart).await.expect("snapshot");
        assert_eq!(
            second,
            McpSnapshot {
                phase: McpPhase::Running,
                port: Some(p),
                error: None,
                generation: 2,
            }
        );
        let new_token = c.server_config().expect("config").token;
        assert_eq!(
            raw_get(p, "/ping", Some(&new_token), GENEROUS)
                .await
                .unwrap(),
            200
        );
        c.stop().await.expect("stop");
        remove_test_dir(&dir);
        Ok(())
    })
    .await;
}
