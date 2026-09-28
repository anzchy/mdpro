//! S-1..S-4 (ADR-0040 WI-7): `set_server_enabled` persists first, then
//! reconciles, and returns one status. Real persist on a temp `$HOME`
//! (`TestHome`, under `HOME_LOCK`), real sockets on `127.0.0.1`, server files
//! in a temp dir. Also the shared helpers the other switch suites use.

use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::files::TOKEN_FILE;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError};
use crate::services::mcp_controller::switch::{set_server_enabled, McpSwitchError};
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    files_present, hold_port, loopback, raw_get, read_published, remove_test_dir, temp_files_dir,
    test_env, test_env0, with_free_port, SetupCollision, GENEROUS,
};
use crate::services::mcp_launch::{McpConfigured, McpStatus};
use crate::services::preferences_mcp::{persist_server_enabled, PersistError};
use crate::services::window_restore::test_home::{
    read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::{json, Value};
use std::fs;
use std::net::TcpListener;
use std::path::Path;

/// The binary path the switch echoes into the status (never logged).
pub(super) const BIN: &str = "mdpro_mcp";

/// Seed a full `config.json` with `mcp.serverEnabled = enabled`.
pub(super) fn seed_disk(home: &Path, enabled: bool) -> Vec<u8> {
    seed_config(home, |v| v["mcp"]["serverEnabled"] = json!(enabled))
}

/// The on-disk `mcp.serverEnabled`, parsed.
pub(super) fn disk_enabled(home: &Path) -> bool {
    let v: Value = serde_json::from_slice(&read_config_bytes(home)).expect("config.json is JSON");
    v["mcp"]["serverEnabled"]
        .as_bool()
        .expect("mcp.serverEnabled is a bool")
}

/// The switch with the real persist and the `/ping` router.
pub(super) async fn set(c: &McpController, enabled: bool) -> Result<McpStatus, McpSwitchError> {
    set_server_enabled(c, persist_server_enabled, enabled, plain(), BIN.to_string()).await
}

/// S-1: off, on, off, on from Running follows disk and runtime; every
/// restart gets a fresh token; the final generation is 3.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s1_toggles_from_running_follow_disk_and_runtime_with_fresh_tokens() {
    let h = TestHome::new("wi7_s1");
    seed_disk(&h.dir, true);
    let dir = temp_files_dir("s1");
    let c = McpController::new(test_env0(&dir));
    let first = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!((first.phase, first.generation), (McpPhase::Running, 1));
    let (_, t1) = read_published(&dir).expect("t1 published");
    let mut tokens = vec![t1];

    for enabled in [false, true, false, true] {
        let status = set(&c, enabled)
            .await
            .unwrap_or_else(|e| panic!("set({enabled}) → {e:?}"));
        let (phase, configured) = if enabled {
            (McpPhase::Running, McpConfigured::Enabled)
        } else {
            (McpPhase::Disabled, McpConfigured::Disabled)
        };
        assert_eq!(status.phase, phase, "set({enabled}) phase");
        assert_eq!(status.configured, configured, "set({enabled}) configured");
        assert_eq!(status.error, None, "set({enabled}) error");
        assert_eq!(disk_enabled(&h.dir), enabled, "set({enabled}) disk");
        assert_eq!(
            files_present(&dir),
            (enabled, enabled),
            "set({enabled}) files"
        );
        if enabled {
            let (port, token) = read_published(&dir).expect("published after on");
            assert_eq!(status.port, Some(port), "status port is the published port");
            assert!(
                !tokens.contains(&token),
                "a restart reused an earlier token"
            );
            tokens.push(token);
        } else {
            assert_eq!(status.port, None, "no port once off");
        }
    }
    assert_eq!(c.snapshot().expect("snapshot").generation, 3);
    assert_eq!(tokens.len(), 3);
    c.reconcile(false, plain()).await.expect("cleanup");
    remove_test_dir(&dir);
}

fn failing(err: PersistError) -> impl FnOnce(bool) -> Result<(), PersistError> {
    move |_| Err(err)
}

/// S-2: every persist failure, from Running and from Disabled, is
/// `Err(PersistFailed)` and conserves (phase, generation, port, token bytes).
// WI-7b: without its own TestHome, S-2's toggle log leaked into S-8's temp HOME.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s2_persist_failure_conserves_the_server_exactly() {
    let _h = TestHome::new("wi7_s2");
    for err in [PersistError::WriteFailed, PersistError::LockPoisoned] {
        // Running on `p`, `set(false)` requested.
        with_free_port(|p| async move {
            let dir = temp_files_dir("s2-run");
            let c = McpController::new(test_env(&dir, loopback(p)));
            let before = c.reconcile(true, plain()).await.expect("snapshot");
            if before.error == Some(McpServerError::BindInUse) {
                remove_test_dir(&dir);
                return Err(SetupCollision);
            }
            assert_eq!(before.phase, McpPhase::Running, "{err:?} setup");
            let token_bytes = fs::read(dir.join(TOKEN_FILE)).expect("token file");

            let res = set_server_enabled(&c, failing(err), false, plain(), BIN.into()).await;
            assert_eq!(
                res.map(|_| ()),
                Err(McpSwitchError::PersistFailed),
                "{err:?} running row"
            );
            let after = c.snapshot().expect("snapshot");
            assert_eq!(
                (after.phase, after.generation, after.port),
                (before.phase, before.generation, before.port),
                "{err:?} running row: snapshot changed"
            );
            let now = fs::read(dir.join(TOKEN_FILE)).expect("token file kept");
            assert!(
                now == token_bytes,
                "{err:?} running row: token bytes changed"
            );
            let token = String::from_utf8(now).expect("token is UTF-8");
            let got = raw_get(p, "/ping", Some(&token), GENEROUS)
                .await
                .expect("GET");
            assert_eq!(got, 200, "{err:?} running row: old token still served");
            c.reconcile(false, plain()).await.expect("cleanup");
            remove_test_dir(&dir);
            Ok(())
        })
        .await;

        // Disabled with `bind_addr = p`, `set(true)` requested.
        with_free_port(|p| async move {
            let dir = temp_files_dir("s2-off");
            let c = McpController::new(test_env(&dir, loopback(p)));
            let before = c.snapshot().expect("snapshot");
            let res = set_server_enabled(&c, failing(err), true, plain(), BIN.into()).await;
            assert_eq!(
                res.map(|_| ()),
                Err(McpSwitchError::PersistFailed),
                "{err:?} off row"
            );
            assert_eq!(
                c.snapshot().expect("snapshot"),
                before,
                "{err:?} off row: snapshot"
            );
            assert_eq!(
                files_present(&dir),
                (false, false),
                "{err:?} off row: files"
            );
            assert!(
                TcpListener::bind(loopback(p)).is_ok(),
                "{err:?} off row: the controller bound its port"
            );
            remove_test_dir(&dir);
            Ok(())
        })
        .await;
    }
}

/// S-3: the real persist on a corrupt config refuses with
/// `ConfigUnreadable`; the bytes and the running server are untouched.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s3_corrupt_config_is_config_unreadable_and_running_is_unchanged() {
    let h = TestHome::new("wi7_s3");
    let bytes = write_raw_config(&h.dir, "{ not json");
    let dir = temp_files_dir("s3");
    let c = McpController::new(test_env0(&dir));
    let before = c.reconcile(true, plain()).await.expect("snapshot");
    assert_eq!(before.phase, McpPhase::Running, "setup");
    let (port, token) = read_published(&dir).expect("published");

    let res = set(&c, false).await;
    assert_eq!(res.map(|_| ()), Err(McpSwitchError::ConfigUnreadable));
    assert_eq!(read_config_bytes(&h.dir), bytes, "config bytes changed");
    let after = c.snapshot().expect("snapshot");
    assert_eq!(
        (after.phase, after.generation),
        (McpPhase::Running, before.generation)
    );
    let (port_now, token_now) = read_published(&dir).expect("still published");
    assert_eq!(port_now, port, "port changed");
    assert!(token_now == token, "token changed");
    let got = raw_get(port, "/ping", Some(&token), GENEROUS)
        .await
        .expect("GET");
    assert_eq!(got, 200, "the server stopped serving");
    c.reconcile(false, plain()).await.expect("cleanup");
    remove_test_dir(&dir);
}

/// S-4: on while the port is held is `Ok{failed, bind_in_use}`, and the
/// saved `true` is not rolled back.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s4_on_with_port_occupied_is_ok_failed_bind_in_use_and_disk_keeps_true() {
    let h = TestHome::new("wi7_s4");
    seed_disk(&h.dir, false);
    let (_held, p) = hold_port();
    let dir = temp_files_dir("s4");
    let c = McpController::new(test_env(&dir, loopback(p)));

    let status = set(&c, true).await.expect("Ok with phase failed");
    assert_eq!(status.phase, McpPhase::Failed, "phase");
    assert_eq!(status.error, Some(McpServerError::BindInUse), "error");
    assert_eq!(status.configured, McpConfigured::Enabled, "configured");
    assert!(disk_enabled(&h.dir), "the saved true was rolled back");
    assert_eq!(files_present(&dir), (false, false), "files published");
    remove_test_dir(&dir);
}
