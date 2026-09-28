//! S-5, S-6, S-9, S-9b and S-7 (ADR-0040 WI-7): the switch refuses after
//! exit without persisting or binding, is idempotent, maps a poisoned
//! snapshot to `StatusUnavailable` without panicking (persisted, but the
//! server not started: S-9b), and its error strings equal the fixture's
//! `switchError`. Temp `$HOME` (`TestHome`), temp files dirs.

use super::switch_tests::{disk_enabled, seed_disk, set, BIN};
use crate::services::app_exit::run_exit_cleanup;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::files::TOKEN_FILE;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::switch::{set_server_enabled, McpSwitchError};
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    files_present, loopback, raw_get, read_published, remove_test_dir, temp_files_dir, test_env,
    test_env0, with_free_port, GENEROUS,
};
use crate::services::preferences_mcp::persist_server_enabled;
use crate::services::window_restore::test_home::TestHome;
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering};

/// S-5: after `run_exit_cleanup`, `set(true)` is `Err(Exiting)`: the persist
/// is never called and the controller's port is never bound.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_after_exit_the_switch_refuses_before_persisting_or_binding() {
    let h = TestHome::new("wi7_s5");
    seed_disk(&h.dir, false);
    let home = h.dir.clone();
    with_free_port(|p| {
        let home = home.clone();
        async move {
            let dir = temp_files_dir("s5");
            let c = McpController::new(test_env(&dir, loopback(p)));
            // Exit cleanup blocks on a runtime of its own: run it off this one.
            std::thread::scope(|s| {
                s.spawn(|| run_exit_cleanup(&c));
            });
            let calls = AtomicUsize::new(0);
            let recording = |enabled| {
                calls.fetch_add(1, Ordering::SeqCst);
                persist_server_enabled(enabled)
            };
            let res = set_server_enabled(&c, recording, true, plain(), BIN.into()).await;
            assert_eq!(res.map(|_| ()), Err(McpSwitchError::Exiting));
            assert_eq!(calls.load(Ordering::SeqCst), 0, "persist was called");
            assert!(!disk_enabled(&home), "the disk changed");
            assert!(
                TcpListener::bind(loopback(p)).is_ok(),
                "the switch bound the port after exit"
            );
            remove_test_dir(&dir);
            Ok(())
        }
    })
    .await;
}

/// S-6: `set(x); set(x)` ≡ `set(x)`, from Running with `true` and from
/// Disabled with `false`: same status, generation, port, token bytes, disk.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s6_setting_the_same_value_twice_is_idempotent() {
    let h = TestHome::new("wi7_s6");
    for enabled in [true, false] {
        seed_disk(&h.dir, enabled);
        let dir = temp_files_dir("s6");
        let c = McpController::new(test_env0(&dir));
        let start = c.reconcile(enabled, plain()).await.expect("snapshot");
        let token0 = fs::read(dir.join(TOKEN_FILE)).ok();

        let first = set(&c, enabled).await.expect("first set");
        let snap1 = c.snapshot().expect("snapshot");
        let token1 = fs::read(dir.join(TOKEN_FILE)).ok();
        let second = set(&c, enabled).await.expect("second set");
        let snap2 = c.snapshot().expect("snapshot");
        let token2 = fs::read(dir.join(TOKEN_FILE)).ok();

        let want = if enabled {
            McpPhase::Running
        } else {
            McpPhase::Disabled
        };
        assert_eq!(first.phase, want, "set({enabled}) phase");
        assert_eq!(
            serde_json::to_value(&first).expect("status serializes"),
            serde_json::to_value(&second).expect("status serializes"),
            "set({enabled}): the second status differs"
        );
        assert_eq!(
            snap1, start,
            "set({enabled}): the first set moved the server"
        );
        assert_eq!(
            snap2, snap1,
            "set({enabled}): the second set moved the server"
        );
        assert!(
            token1 == token0 && token2 == token1,
            "set({enabled}): token bytes changed"
        );
        assert_eq!(
            token2.is_some(),
            enabled,
            "set({enabled}): token file presence"
        );
        assert_eq!(disk_enabled(&h.dir), enabled, "set({enabled}): disk");
        c.reconcile(false, plain()).await.expect("cleanup");
        remove_test_dir(&dir);
    }
}

/// S-9: a poisoned snapshot is `Err(StatusUnavailable)`, never a panic, and
/// the persist that already happened stands. No file may name a port that
/// is not serving.
#[test]
fn s9_poisoned_snapshot_is_status_unavailable_and_the_persist_stands() {
    let h = TestHome::new("wi7_s9");
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("runtime");
    for enabled in [true, false] {
        seed_disk(&h.dir, !enabled);
        let dir = temp_files_dir("s9");
        let c = McpController::new(test_env0(&dir));
        c.poison_snapshot_for_test();

        let outcome = catch_unwind(AssertUnwindSafe(|| rt.block_on(set(&c, enabled))));
        let res = outcome.unwrap_or_else(|_| panic!("set({enabled}) panicked"));
        assert_eq!(
            res.map(|_| ()),
            Err(McpSwitchError::StatusUnavailable),
            "set({enabled})"
        );
        assert_eq!(
            disk_enabled(&h.dir),
            enabled,
            "set({enabled}): the persist was lost"
        );
        if let Some((port, token)) = read_published(&dir) {
            let got = rt
                .block_on(raw_get(port, "/ping", Some(&token), GENEROUS))
                .expect("GET on the published port");
            assert_eq!(got, 200, "set({enabled}): files name a dead server");
        }
        assert!(
            files_present(&dir).0 == files_present(&dir).1,
            "half-published files"
        );
        remove_test_dir(&dir);
    }
}

/// S-9b (final review L1): with a poisoned snapshot, `set(true)` persists
/// `true` and returns `StatusUnavailable` without starting: `reconcile` reads
/// the snapshot before acting, so the router factory (called only after a
/// successful bind) never runs, nothing is published, no token is in memory.
#[test]
fn s9b_poisoned_snapshot_persists_true_but_never_starts() {
    let h = TestHome::new("wi7_s9b");
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("runtime");
    seed_disk(&h.dir, false);
    let dir = temp_files_dir("s9b");
    let c = McpController::new(test_env0(&dir));
    c.poison_snapshot_for_test();
    let factory_calls = AtomicUsize::new(0);
    let counting = |config| {
        factory_calls.fetch_add(1, Ordering::SeqCst);
        plain()(config)
    };

    let res = rt.block_on(set_server_enabled(
        &c,
        persist_server_enabled,
        true,
        counting,
        BIN.into(),
    ));
    assert_eq!(res.map(|_| ()), Err(McpSwitchError::StatusUnavailable));
    assert!(disk_enabled(&h.dir), "the persist of true was lost");
    assert_eq!(factory_calls.load(Ordering::SeqCst), 0, "a start ran");
    assert_eq!(files_present(&dir), (false, false), "files published");
    assert!(c.server_config().is_none(), "a token is in memory");
    remove_test_dir(&dir);
}

/// Shared with `tests/mcp-status-contract.test.ts` (TS-01).
const STATUS_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/mcp-status-contract.json"
);

/// S-7 (BS-07): the `McpSwitchError` wire strings are a bijection with the
/// fixture's `switchError`.
#[test]
fn s7_switch_error_wire_strings_equal_the_fixture_switch_error() {
    use McpSwitchError::{ConfigUnreadable, Exiting, PersistFailed, StatusUnavailable};
    let witness = |e: McpSwitchError| match e {
        ConfigUnreadable | PersistFailed | Exiting | StatusUnavailable => (),
    };
    let all = [ConfigUnreadable, PersistFailed, Exiting, StatusUnavailable];
    all.iter().copied().for_each(witness);
    let mut got: Vec<String> = all
        .iter()
        .map(|e| {
            let v = serde_json::to_value(e).expect("serializes");
            v.as_str().expect("a unit variant is a string").to_string()
        })
        .collect();
    got.sort();
    got.dedup();
    assert_eq!(got.len(), all.len(), "two variants share a wire string");

    let text = fs::read_to_string(STATUS_FIXTURE).expect("fixture readable");
    let fixture: Value = serde_json::from_str(&text).expect("fixture is JSON");
    let mut want: Vec<String> = fixture["switchError"]
        .as_array()
        .expect("switchError list")
        .iter()
        .map(|x| x.as_str().expect("fixture string").to_string())
        .collect();
    want.sort();
    assert_eq!(got, want, "Rust vs fixture switchError");
    assert_eq!(
        want,
        [
            "config_unreadable",
            "exiting",
            "persist_failed",
            "status_unavailable"
        ]
    );
}
