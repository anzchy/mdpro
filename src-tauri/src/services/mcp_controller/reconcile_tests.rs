//! Test cases for `McpController#reconcile` (ADR-0040 WI-3: C-7, C-8,
//! C-10). Real sockets on `127.0.0.1`, files in a temp dir.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError, McpSnapshot};
use crate::services::mcp_controller::test_routers::{failable_serve, gated, plain};
use crate::services::mcp_controller::test_support::{
    connect_refused, files_present, hold_port, loopback, raw_get, read_published, remove_test_dir,
    temp_files_dir, test_env, test_env0, wait_until, with_free_port, SetupCollision, GENEROUS,
};
use std::sync::{Arc, Mutex};

fn snap(phase: McpPhase, port: Option<u16>, generation: u64) -> McpSnapshot {
    McpSnapshot {
        phase,
        port,
        error: None,
        generation,
    }
}

/// Every `Vec<bool>` of length 1..=5 (62 sequences).
fn all_sequences() -> Vec<Vec<bool>> {
    let mut out = Vec::new();
    for len in 1..=5u32 {
        for bits in 0..(1u32 << len) {
            out.push((0..len).map(|i| bits & (1 << i) != 0).collect());
        }
    }
    out
}

/// C-7: an exhaustive law over every reconcile sequence of length <= 5,
/// against a hand-written model `(running, starts)`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_every_reconcile_sequence_matches_the_model() {
    let sequences = all_sequences();
    assert_eq!(sequences.len(), 62);
    for seq in &sequences {
        let dir = temp_files_dir("c7");
        let c = McpController::new(test_env0(&dir));
        let (mut running, mut starts) = (false, 0u64);
        let mut previous: Option<(bool, String, u64)> = None;
        for (step, &enabled) in seq.iter().enumerate() {
            if enabled && !running {
                starts += 1;
            }
            running = enabled;
            let got = c.reconcile(enabled, plain()).await.expect("snapshot");
            let want_phase = if running {
                McpPhase::Running
            } else {
                McpPhase::Disabled
            };
            let at = format!("{seq:?}@{step}");
            assert_eq!(got.phase, want_phase, "{at} phase → got/want");
            assert_eq!(got.generation, starts, "{at} generation → got/want");
            assert_eq!(got.error, None, "{at} error");
            assert_eq!(
                files_present(&dir),
                (running, running),
                "{at} files present"
            );
            let token = c.server_config().map(|cfg| cfg.token).unwrap_or_default();
            if let Some((true, old_token, old_gen)) = &previous {
                if enabled {
                    assert!(&token == old_token, "{at} token changed on repeat true");
                    assert_eq!(got.generation, *old_gen, "{at} generation changed");
                }
            }
            previous = Some((enabled, token, got.generation));
        }
        c.reconcile(false, plain()).await.expect("cleanup");
        remove_test_dir(&dir);
    }
}

/// C-8(a): `Failed(BindInUse)` + `true` retries once the port is free.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8a_true_retries_from_bind_in_use() {
    let dir = temp_files_dir("c8a");
    let (held, p) = hold_port();
    let c = McpController::new(test_env(&dir, loopback(p)));
    let failed = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(
        (failed.phase, failed.error),
        (McpPhase::Failed, Some(McpServerError::BindInUse))
    );
    assert_eq!(failed.generation, 1);
    drop(held);
    let got = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(got, snap(McpPhase::Running, Some(p), 2));
    assert_eq!(files_present(&dir), (true, true));
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// C-8(b): `Failed(BindInUse)` + `false` turns off cleanly; then `true`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8b_false_turns_off_from_bind_in_use() {
    let dir = temp_files_dir("c8b");
    let (held, p) = hold_port();
    let c = McpController::new(test_env(&dir, loopback(p)));
    let failed = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(
        (failed.phase, failed.error),
        (McpPhase::Failed, Some(McpServerError::BindInUse))
    );
    let off = c.reconcile(false, plain()).await.expect("snapshot");
    assert_eq!(off, snap(McpPhase::Disabled, None, 1));
    assert_eq!(files_present(&dir), (false, false));
    drop(held);
    let on = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(on, snap(McpPhase::Running, Some(p), 2));
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// C-8(c): `Failed(ServeFailed)` + `false` turns off cleanly; then `true`
/// restarts past the dead gen-1 handle.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8c_false_turns_off_from_serve_failed() {
    let dir = temp_files_dir("c8c");
    let mut env = test_env0(&dir);
    let (serve, fails) = failable_serve();
    env.serve = serve;
    let c = McpController::new(env);
    let up = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(up.phase, McpPhase::Running, "start did not run: {up:?}");
    let p1 = up.port.expect("port");
    let fail1 = fails.recv_timeout(GENEROUS).expect("gen-1 fail sender");
    fail1.send(()).expect("gen-1 serve alive");
    let failed = wait_until(GENEROUS, || {
        c.snapshot().ok().and_then(|s| s.error) == Some(McpServerError::ServeFailed)
    })
    .await;
    assert!(failed, "never reported ServeFailed: {:?}", c.snapshot());

    let off = c.reconcile(false, plain()).await.expect("snapshot");
    assert_eq!(off, snap(McpPhase::Disabled, None, 1));
    assert_eq!(files_present(&dir), (false, false));
    assert!(connect_refused(p1), "gen-1 port {p1} still accepts");

    let on = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(
        (on.phase, on.error, on.generation),
        (McpPhase::Running, None, 2)
    );
    let token = c.server_config().expect("config").token;
    let p2 = on.port.expect("port");
    assert_eq!(
        raw_get(p2, "/ping", Some(&token), GENEROUS).await.unwrap(),
        200
    );
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
}

/// One C-10 run: task 0 parks inside `start` on a gate; tasks 1..=7 queue
/// with `values`; the last acquirer's value must win.
async fn c10_run(p: u16, values: [bool; 7]) -> Result<(), SetupCollision> {
    let dir = temp_files_dir("c10");
    let c = Arc::new(McpController::new(test_env(&dir, loopback(p))));
    let gate = gated();
    let first = c.clone();
    let factory = gate.factory;
    let mut task0 = tokio::spawn(async move { first.reconcile(true, factory).await });
    tokio::select! {
        _ = gate.entered => {}
        r = &mut task0 => {
            let got = r.expect("task 0").expect("snapshot");
            remove_test_dir(&dir);
            assert_eq!(got.error, Some(McpServerError::BindInUse), "{got:?}");
            return Err(SetupCollision);
        }
    }

    let order = Arc::new(Mutex::new(Vec::new()));
    let mut tasks = Vec::new();
    for (i, &value) in values.iter().enumerate() {
        let (c, order) = (c.clone(), order.clone());
        tasks.push(tokio::spawn(async move {
            order.lock().expect("order").push(i + 1);
            c.reconcile(value, plain()).await
        }));
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
    }
    gate.release.send(()).expect("task 0 waiting");
    let mut returned = vec![task0.await.expect("task 0").expect("snapshot")];
    for task in tasks {
        returned.push(task.await.expect("task").expect("snapshot"));
    }

    assert_eq!(*order.lock().expect("order"), vec![1, 2, 3, 4, 5, 6, 7]);
    for got in &returned {
        assert_ne!(
            got.error,
            Some(McpServerError::BindInUse),
            "second listener: {got:?}"
        );
    }
    let last = c.snapshot().expect("snapshot");
    assert!(last.generation >= 1);
    assert!(returned.iter().all(|s| s.generation <= last.generation));
    if values[6] {
        assert_eq!(
            (last.phase, last.port, last.error),
            (McpPhase::Running, Some(p), None)
        );
        assert_eq!(files_present(&dir), (true, true));
        let (_, token) = read_published(&dir).expect("published");
        assert_eq!(
            raw_get(p, "/ping", Some(&token), GENEROUS).await.unwrap(),
            200
        );
    } else {
        assert_eq!(
            (last.phase, last.port, last.error),
            (McpPhase::Disabled, None, None)
        );
        assert_eq!(files_present(&dir), (false, false));
    }
    c.stop().await.expect("stop");
    remove_test_dir(&dir);
    Ok(())
}

/// C-10: concurrent reconciles are serialized, the last acquirer wins, and
/// there is never a second listener. Run 1 ends `false`, run 2 `true`.
#[tokio::test(flavor = "current_thread")]
async fn c10_concurrent_reconciles_serialize_and_the_last_acquirer_wins() {
    let run1 = [false, true, false, true, false, true, false];
    with_free_port(|p| c10_run(p, run1)).await;
    let run2 = [false, true, false, true, false, true, true];
    with_free_port(|p| c10_run(p, run2)).await;
}
