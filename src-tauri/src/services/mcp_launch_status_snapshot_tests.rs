//! L-7 and C-11(b) (ADR-0040 WI-5): `current_status_in` is the controller
//! snapshot (`phase`, `error`, `port`) crossed with a fresh config read
//! (`configured`), read-only; a poisoned snapshot is a path-free `Err`.
//!
//! Real transitions for Disabled, Running and Failed(BindInUse); only the
//! Stopping row uses `set_snapshot_for_test`. Temp HOME under `HOME_LOCK`,
//! temp files dirs, `127.0.0.1` ephemeral ports only.

use super::*;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::{McpServerError, McpSnapshot};
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    hold_port, loopback, remove_test_dir, temp_files_dir, test_env, test_env0, GENEROUS,
};
use crate::services::window_restore::test_home::{
    config_file, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::time::timeout;

/// The four config file states and the `configured` each must report.
#[derive(Clone, Copy, Debug)]
enum Disk {
    True,
    False,
    Missing,
    Corrupt,
}

fn expected(disk: Disk) -> McpConfigured {
    match disk {
        Disk::True | Disk::Missing => McpConfigured::Enabled,
        Disk::False => McpConfigured::Disabled,
        Disk::Corrupt => McpConfigured::Unreadable,
    }
}

/// Put the disk into `disk`; returns the config bytes (None when missing).
fn set_disk(home: &Path, disk: Disk) -> Option<Vec<u8>> {
    match disk {
        Disk::True => Some(seed_config(home, |v| {
            v["mcp"]["serverEnabled"] = json!(true)
        })),
        Disk::False => Some(seed_config(home, |v| {
            v["mcp"]["serverEnabled"] = json!(false)
        })),
        Disk::Missing => {
            let _ = std::fs::remove_dir_all(home.join(".mdpro"));
            None
        }
        Disk::Corrupt => Some(write_raw_config(home, "{ not json")),
    }
}

type State = (&'static str, McpController, PathBuf);

/// A controller over a fresh temp files dir, bound to `port` (0: any).
fn controller(label: &str, port: u16) -> (McpController, PathBuf) {
    let dir = temp_files_dir(label);
    (McpController::new(test_env(&dir, loopback(port))), dir)
}

async fn snapshot_states() -> (Vec<State>, std::net::TcpListener) {
    let (disabled, d1) = controller("l7-disabled", 0);
    timeout(GENEROUS, disabled.start(plain()))
        .await
        .expect("start")
        .expect("snap");
    timeout(GENEROUS, disabled.stop())
        .await
        .expect("stop")
        .expect("snap");

    let (running, d2) = controller("l7-running", 0);
    timeout(GENEROUS, running.start(plain()))
        .await
        .expect("start")
        .expect("snap");

    let (held, p) = hold_port();
    let (failed, d3) = controller("l7-failed", p);
    timeout(GENEROUS, failed.start(plain()))
        .await
        .expect("start")
        .expect("snap");

    let (stopping, d4) = controller("l7-stopping", 0);
    stopping.set_snapshot_for_test(McpSnapshot {
        phase: McpPhase::Stopping,
        port: Some(41234),
        error: None,
        generation: 2,
    });
    let states = vec![
        ("disabled", disabled, d1),
        ("running", running, d2),
        ("failed", failed, d3),
        ("stopping", stopping, d4),
    ];
    (states, held)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l7_status_is_the_snapshot_crossed_with_a_fresh_config_read() {
    let h = TestHome::new("mcp_l7");
    let (states, _held) = snapshot_states().await;

    // Preconditions: the real transitions reached the phases the rows name.
    let phases: Vec<_> = states
        .iter()
        .map(|(_, c, _)| c.snapshot().expect("snapshot"))
        .collect();
    assert_eq!(phases[0].phase, McpPhase::Disabled);
    assert_eq!(phases[1].phase, McpPhase::Running);
    assert!(phases[1].port.is_some());
    assert_eq!(phases[2].phase, McpPhase::Failed);
    assert_eq!(phases[2].error, Some(McpServerError::BindInUse));

    let m = Mutex::new(());
    let mut rows = 0;
    for (name, c, _) in &states {
        let snap = c.snapshot().expect("snapshot");
        for disk in [Disk::True, Disk::False, Disk::Missing, Disk::Corrupt] {
            let before = set_disk(&h.dir, disk);
            let row = format!("{name} x {disk:?}");
            let s = current_status_in(&m, c, "bin".into()).expect(&row);

            assert_eq!(s.phase, snap.phase, "{row}: phase");
            assert_eq!(s.error, snap.error, "{row}: error");
            assert_eq!(s.port, snap.port, "{row}: port");
            assert_eq!(s.running, s.port.is_some(), "{row}: running");
            assert_eq!(s.configured, expected(disk), "{row}: configured");
            assert_eq!(s.binary_path, "bin", "{row}: binary path");
            match before {
                Some(bytes) => assert_eq!(read_config_bytes(&h.dir), bytes, "{row}: bytes"),
                None => {
                    assert!(!config_file(&h.dir).exists(), "{row}: created config");
                    assert!(!h.dir.join(".mdpro").exists(), "{row}: created .mdpro");
                }
            }
            rows += 1;
        }
    }
    assert_eq!(rows, 16);

    for (_, c, dir) in &states {
        timeout(GENEROUS, c.stop())
            .await
            .expect("stop")
            .expect("snap");
        remove_test_dir(dir);
    }
}

/// C-11(b), the `current_status_in` half: a poisoned snapshot is `Err`
/// without a `/`, and never a panic.
#[test]
fn c11b_status_over_a_poisoned_snapshot_is_a_path_free_err() {
    let h = TestHome::new("mcp_c11b");
    seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
    let c = McpController::new(test_env0(&temp_files_dir("c11b-status")));
    c.poison_snapshot_for_test();
    let m = Mutex::new(());

    let got = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        current_status_in(&m, &c, "bin".into())
    }))
    .expect("current_status_in panicked on a poisoned snapshot");
    match got {
        Err(msg) => assert!(!msg.contains('/'), "error names a path: {msg}"),
        Ok(s) => panic!("a poisoned snapshot was reported as {s:?}"),
    }
}
