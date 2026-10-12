//! WI-2 (D24 follow-up) — `read_stored_geometry(_in)`, the I/O half of restore.
//!
//! Cases rd1-rd6 of `.claude/tdd-guardian/tests-20260926-062337.md`.
//!
//! **Law (idempotent, read-only):** repeated reads of an existing `config.json`
//! return equal results and leave its bytes and mtime unchanged.
//! **Law (mutual exclusion):** a read never proceeds while
//! `preferences_rw_lock` is held elsewhere.
//!
//! Every case runs in a temp `$HOME` under `HOME_LOCK` ([`TestHome`]) against a
//! real `config.json`, real serde and the real `load_preferences`. Nothing is
//! mocked. rd5 poisons a **local** mutex through the injectable seam, never
//! the process-global `preferences_rw_lock`.

use super::restore_fixture::Fixture;
use super::test_home::{
    config_file, config_mtime, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use super::*;
use crate::services::preferences::preferences_rw_lock;
use serde_json::json;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const B: &str = "/tmp/mdpro-restore-b.md";

fn full(x: i32, y: i32, width: u32, height: u32, last_accessed: i64) -> WindowGeometry {
    WindowGeometry {
        x,
        y,
        width,
        height,
        last_accessed,
    }
}

fn tmp_file_absent(home: &std::path::Path) -> bool {
    !home.join(".mdpro").join("config.json.tmp").exists()
}

#[test]
fn rd1_seeded_record_under_raw_key_is_read_back() {
    let h = TestHome::new("rd1");
    seed_config(&h.dir, |v| {
        v["windowStates"] = json!({
            B: { "x": 333, "y": 177, "width": 1011, "height": 655, "lastAccessed": 42 }
        });
    });
    assert_eq!(
        read_stored_geometry(B),
        Ok(Some(full(333, 177, 1011, 655, 42)))
    );
}

#[test]
fn rd2_alias_read_against_real_store() {
    let h = TestHome::new("rd2");
    let fx = Fixture::new();
    seed_config(&h.dir, |v| {
        v["windowStates"] = json!({
            fx.canon_a.clone(): { "x": 5, "y": 6, "width": 900, "height": 600, "lastAccessed": 1 }
        });
    });
    let canonical = read_stored_geometry(&fx.canon_a);
    assert_eq!(canonical, Ok(Some(full(5, 6, 900, 600, 1))));
    #[allow(unused_mut)]
    let mut spellings = vec![fx.a.clone(), fx.alias.clone(), fx.dotted_a.clone()];
    #[cfg(target_os = "macos")]
    spellings.push(fx.private_a.clone());
    for q in spellings {
        assert_eq!(read_stored_geometry(&q), canonical, "spelling {q}");
    }
}

#[test]
fn rd3_corrupt_config_is_an_error_and_is_not_rewritten() {
    let h = TestHome::new("rd3");
    let before = write_raw_config(&h.dir, "{ not valid json !! }");
    let mtime = config_mtime(&h.dir);

    let result = read_stored_geometry("/tmp/x.md");
    assert!(
        matches!(result, Err(RestoreReadError::Parse(_))),
        "expected a parse error, got {result:?}"
    );
    let (r, o) = decide_window_geometry(
        Some("/tmp/x.md"),
        result,
        work_area(0.0, 0.0, 1440.0, 900.0),
    );
    assert_eq!(
        o,
        RestoreOutcome {
            source: GeometrySource::Default,
            reason: RestoreReason::ReadFailed,
            clamped: false,
        }
    );
    assert_eq!(r.position, None);
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
    assert_eq!(config_mtime(&h.dir), mtime, "mtime unchanged");
    assert!(tmp_file_absent(&h.dir), "no config.json.tmp");
}

#[test]
fn rd4_read_blocks_while_preferences_lock_is_held() {
    let h = TestHome::new("rd4");
    assert!(
        !config_file(&h.dir).exists(),
        "precondition: no config.json"
    );

    let guard = preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let _ = tx.send(read_stored_geometry("/tmp/x.md"));
    });
    let while_held = rx.recv_timeout(Duration::from_millis(150));
    // Released before any assertion, so a failure cannot poison the global lock.
    drop(guard);
    let after_release = rx.recv_timeout(Duration::from_secs(5));
    let _ = reader.join();

    assert!(
        matches!(while_held, Err(RecvTimeoutError::Timeout)),
        "read completed while the lock was held: {while_held:?}"
    );
    assert_eq!(after_release, Ok(Ok(None)));
}

#[test]
fn rd5_poisoned_lock_is_a_typed_error_and_nothing_is_written() {
    let h = TestHome::new("rd5");
    let poisoned = Arc::new(Mutex::new(()));
    let p2 = Arc::clone(&poisoned);
    let _ = std::thread::spawn(move || {
        let _g = p2.lock();
        panic!("poisoning the local test mutex on purpose");
    })
    .join();
    assert!(poisoned.is_poisoned(), "precondition: lock is poisoned");

    let before = seed_config(&h.dir, |v| {
        v["windowStates"] = json!({
            "/tmp/x.md": { "x": 1, "y": 2, "width": 700, "height": 500, "lastAccessed": 3 }
        });
    });
    let result = read_stored_geometry_in(&poisoned, "/tmp/x.md");
    assert!(
        matches!(result, Err(RestoreReadError::LockPoisoned)),
        "expected LockPoisoned, got {result:?}"
    );
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
    let (_, o) = decide_window_geometry(
        Some("/tmp/x.md"),
        result,
        work_area(0.0, 0.0, 1440.0, 900.0),
    );
    assert_eq!(o.reason, RestoreReason::ReadFailed);
}

#[test]
fn rd6_two_reads_are_equal_and_leave_the_file_untouched() {
    let h = TestHome::new("rd6");
    let before = seed_config(&h.dir, |v| {
        v["windowStates"] = json!({
            B: { "x": 333, "y": 177, "width": 1011, "height": 655, "lastAccessed": 42 },
            "/tmp/mdpro-restore-c.md": { "x": 1, "y": 1, "width": 800, "height": 600, "lastAccessed": 7 },
            "/tmp/mdpro-restore-d.md": { "x": 2, "y": 2, "width": 800, "height": 600, "lastAccessed": 9 }
        });
    });
    let mtime = config_mtime(&h.dir);

    let first = read_stored_geometry(B);
    let second = read_stored_geometry(B);
    let none = read_stored_geometry("/tmp/mdpro-restore-none.md");

    assert_eq!(first, second);
    assert_eq!(first, Ok(Some(full(333, 177, 1011, 655, 42))));
    assert_eq!(none, Ok(None));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
    assert_eq!(config_mtime(&h.dir), mtime, "mtime unchanged");
}

fn work_area(x: f64, y: f64, width: f64, height: f64) -> WorkArea {
    WorkArea {
        x,
        y,
        width,
        height,
    }
}
