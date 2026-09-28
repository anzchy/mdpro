//! L-6 (ADR-0040 WI-5): `run_exit_cleanup(&McpController)` is idempotent over
//! three runs, conserves every sibling of the MCP files byte for byte, never
//! panics, and still cleans up over a poisoned snapshot.
//!
//! Start states: Running, Disabled with stale files, Failed(BindInUse) with
//! stale files, and Running with a poisoned snapshot. Replaces the deleted
//! C1-C4 (sender-slot era). Temp `$HOME`, `temp_files_dir`, `127.0.0.1`
//! ephemeral ports only.

use super::*;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::files::{PORT_FILE, TOKEN_FILE};
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError};
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    connect_refused, files_present, hold_port, loopback, remove_test_dir, temp_files_dir, test_env,
    test_env0, wait_until, GENEROUS,
};
use crate::services::window_restore::test_home::TestHome;
use std::collections::BTreeMap;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::{mpsc, Arc};
use tokio::time::timeout;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Start {
    Running,
    Disabled,
    Failed,
    RunningPoisoned,
}

/// Every entry under `dir` except the two MCP files: path -> bytes (None
/// for a directory).
fn listing(dir: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn walk(root: &Path, at: &Path, out: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in fs::read_dir(at).expect("read_dir").flatten() {
            let path = entry.path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if rel == PORT_FILE || rel == TOKEN_FILE {
                continue;
            }
            if path.is_dir() {
                out.insert(rel, None);
                walk(root, &path, out);
            } else {
                out.insert(rel, Some(fs::read(&path).expect("read")));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn seed_siblings(dir: &Path) {
    fs::create_dir_all(dir.join("drafts")).unwrap();
    fs::write(dir.join("drafts").join("x.md"), b"\xffdraft").unwrap();
    fs::write(dir.join("other.json"), b"{\"keep\":true}").unwrap();
}

fn seed_stale(dir: &Path) {
    fs::write(dir.join(PORT_FILE), "55045").unwrap();
    fs::write(dir.join(TOKEN_FILE), "stale").unwrap();
}

/// One run on a std thread under `catch_unwind`; true iff it returned.
fn run_once(c: &Arc<McpController>) -> bool {
    let (tx, rx) = mpsc::channel();
    let c = c.clone();
    std::thread::spawn(move || {
        let ok = catch_unwind(AssertUnwindSafe(|| run_exit_cleanup(&c))).is_ok();
        let _ = tx.send(ok);
    });
    tokio::task::block_in_place(|| rx.recv_timeout(GENEROUS)).unwrap_or(false)
}

/// Build a controller in `start`; returns it, its dir, its live port (the
/// Running states) and the held port (Failed).
async fn setup(
    start: Start,
) -> (
    Arc<McpController>,
    std::path::PathBuf,
    Option<u16>,
    Option<std::net::TcpListener>,
) {
    let dir = temp_files_dir("l6");
    fs::create_dir_all(&dir).unwrap();
    seed_siblings(&dir);
    let mut held = None;
    let c = match start {
        Start::Failed => {
            let (l, p) = hold_port();
            held = Some(l);
            Arc::new(McpController::new(test_env(&dir, loopback(p))))
        }
        _ => Arc::new(McpController::new(test_env0(&dir))),
    };
    let mut port = None;
    match start {
        Start::Running | Start::RunningPoisoned => {
            let s = timeout(GENEROUS, c.start(plain()))
                .await
                .expect("start")
                .expect("snap");
            assert_eq!(s.phase, McpPhase::Running, "precondition: {s:?}");
            port = s.port;
        }
        Start::Failed => {
            let s = timeout(GENEROUS, c.start(plain()))
                .await
                .expect("start")
                .expect("snap");
            assert_eq!(
                s.error,
                Some(McpServerError::BindInUse),
                "precondition: {s:?}"
            );
            seed_stale(&dir);
        }
        Start::Disabled => seed_stale(&dir),
    }
    if start == Start::RunningPoisoned {
        c.poison_snapshot_for_test();
    }
    (c, dir, port, held)
}

/// L-6: idempotent over 3 runs, siblings conserved, never panics.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l6_exit_is_idempotent_conserves_siblings_and_survives_a_poisoned_snapshot() {
    let _h = TestHome::new("exit_l6");
    for start in [
        Start::Running,
        Start::Disabled,
        Start::Failed,
        Start::RunningPoisoned,
    ] {
        let (c, dir, port, _held) = setup(start).await;
        let pre = listing(&dir);
        let mut after = Vec::new();
        for run in 1..=3 {
            assert!(run_once(&c), "{start:?} run {run}: panicked or hung");
            assert_eq!(files_present(&dir), (false, false), "{start:?} run {run}");
            assert_eq!(listing(&dir), pre, "{start:?} run {run}: siblings changed");
            if let Some(p) = port {
                assert!(
                    wait_until(GENEROUS, || connect_refused(p)).await,
                    "{start:?} run {run}: port {p} still accepts"
                );
            }
            let snap = format!("{:?}", c.snapshot());
            after.push((files_present(&dir), listing(&dir), snap));
        }
        assert_eq!(after[0], after[2], "{start:?}: run 3 differs from run 1");
        remove_test_dir(&dir);
    }
}
