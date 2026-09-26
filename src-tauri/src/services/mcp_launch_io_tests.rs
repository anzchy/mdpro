//! Temp-HOME cases for the MCP launch reader (ADR-0039, WI-3).
//!
//! RD-01 … RD-11. Real filesystem, real mutexes, real poison; nothing mocked.
//! Every case runs under `TestHome` (holds `HOME_LOCK`), so the developer's
//! `~/.mdpro/` is never touched. Poison is applied to a **local** mutex only,
//! never to `preferences_rw_lock()`.

use super::*;
use crate::services::preferences::preferences_rw_lock;
use crate::services::window_restore::test_home::{
    config_file, config_mtime, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A local mutex poisoned by a panicking thread.
fn poisoned_lock() -> Arc<Mutex<()>> {
    let m = Arc::new(Mutex::new(()));
    let m2 = Arc::clone(&m);
    let _ = std::thread::spawn(move || {
        let _g = m2.lock();
        panic!("poisoning the local test mutex on purpose");
    })
    .join();
    assert!(m.is_poisoned(), "precondition: lock is poisoned");
    m
}

/// Sorted recursive listing of every path under `root`.
fn listing(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            out.push(p.clone());
            if p.is_dir() {
                walk(&p, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out.sort();
    out
}

fn read() -> McpConfigRead {
    read_server_enabled_in(&Mutex::new(()))
}

#[test]
fn rd01_missing_config_is_none_and_nothing_is_created() {
    let h = TestHome::new("mcp_rd01");
    assert!(!h.dir.join(".mdpro").exists(), "precondition: empty HOME");

    assert_eq!(read(), Ok(None));

    assert!(!config_file(&h.dir).exists(), "reader created config.json");
    assert!(!h.dir.join(".mdpro").exists(), "reader created ~/.mdpro");
}

#[test]
fn rd02_corrupt_json_is_parse_and_the_file_is_untouched() {
    let h = TestHome::new("mcp_rd02");
    let before = write_raw_config(&h.dir, "{ not valid json !! }");
    let mtime = config_mtime(&h.dir);

    assert_eq!(read(), Err(McpConfigReadError::Parse));

    assert_eq!(read_config_bytes(&h.dir), before);
    assert_eq!(config_mtime(&h.dir), mtime);
    assert!(!h.dir.join(".mdpro/config.json.tmp").exists());
}

#[test]
fn rd03_zero_byte_config_is_parse_not_missing() {
    let h = TestHome::new("mcp_rd03");
    write_raw_config(&h.dir, "");

    assert_eq!(read(), Err(McpConfigReadError::Parse));

    assert!(config_file(&h.dir).exists());
    assert_eq!(read_config_bytes(&h.dir).len(), 0);
}

#[test]
fn rd04_explicit_false_then_true_are_read_as_such() {
    let h = TestHome::new("mcp_rd04");
    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));
    assert_eq!(read(), Ok(Some(false)));
    assert_eq!(read_config_bytes(&h.dir), before);

    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
    assert_eq!(read(), Ok(Some(true)));
    assert_eq!(read_config_bytes(&h.dir), before);
}

#[test]
fn rd05_legacy_enabled_false_only_still_starts_the_server() {
    let h = TestHome::new("mcp_rd05");
    let before = seed_config(&h.dir, |v| {
        v["mcp"] = json!({"enabled": false, "startOnLaunch": false, "autoApproveEdits": false});
    });

    let r = read();
    assert_eq!(r, Ok(Some(true)));
    assert_eq!(
        decide_mcp_launch(r),
        McpLaunchDecision::Start(StartReason::Enabled)
    );

    let after = read_config_bytes(&h.dir);
    assert_eq!(after, before, "reader rewrote the legacy file");
    let v: serde_json::Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(
        v["mcp"]["enabled"],
        json!(false),
        "legacy key still on disk"
    );
}

#[test]
fn rd06_poisoned_lock_is_lock_poisoned_and_not_read_through() {
    let h = TestHome::new("mcp_rd06");
    let poisoned = poisoned_lock();
    // Non-vacuous: reading through the poison would yield Ok(Some(false)).
    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));

    let r = read_server_enabled_in(&poisoned);
    assert_eq!(r, Err(McpConfigReadError::LockPoisoned));
    assert_eq!(
        decide_mcp_launch(r),
        McpLaunchDecision::Start(StartReason::ConfigUnreadable(
            McpConfigReadError::LockPoisoned
        ))
    );
    assert_eq!(read_config_bytes(&h.dir), before);
}

#[test]
fn rd07_two_reads_are_equal_and_change_nothing_over_three_disk_states() {
    let h = TestHome::new("mcp_rd07");
    type Seed = fn(&Path);
    let states: [(&str, Seed); 3] = [
        ("missing", |home: &Path| {
            let _ = fs::remove_dir_all(home.join(".mdpro"));
        }),
        ("false", |home: &Path| {
            seed_config(home, |v| v["mcp"]["serverEnabled"] = json!(false));
        }),
        ("corrupt", |home: &Path| {
            write_raw_config(home, "{ nope");
        }),
    ];
    for (name, seed) in states {
        seed(&h.dir);
        let list_before = listing(&h.dir);
        let file_before = config_file(&h.dir)
            .exists()
            .then(|| (read_config_bytes(&h.dir), config_mtime(&h.dir)));

        let r1 = read();
        let r2 = read();

        assert_eq!(r1, r2, "state {name}: reads differ");
        assert_eq!(
            listing(&h.dir),
            list_before,
            "state {name}: listing changed"
        );
        let file_after = config_file(&h.dir)
            .exists()
            .then(|| (read_config_bytes(&h.dir), config_mtime(&h.dir)));
        assert_eq!(
            file_after, file_before,
            "state {name}: bytes or mtime changed"
        );
    }
}

#[test]
fn rd08_config_path_is_a_directory_is_io_not_missing() {
    let h = TestHome::new("mcp_rd08");
    fs::create_dir_all(config_file(&h.dir)).unwrap();

    assert_eq!(read(), Err(McpConfigReadError::Io));

    assert!(config_file(&h.dir).is_dir());
    assert_eq!(fs::read_dir(config_file(&h.dir)).unwrap().count(), 0);
}

#[test]
fn rd09_narrow_parse_partition() {
    let h = TestHome::new("mcp_rd09");
    let mut full_bad_sidebar =
        serde_json::to_value(crate::models::UserPreferences::default()).unwrap();
    full_bad_sidebar["showSidebar"] = json!("yes");
    full_bad_sidebar["mcp"]["serverEnabled"] = json!(false);
    let full_bad_sidebar = full_bad_sidebar.to_string();

    let rows: [(&str, &str, McpConfigRead); 6] = [
        ("a", r#"{"mcp":{"serverEnabled":false}}"#, Ok(Some(false))),
        ("b", full_bad_sidebar.as_str(), Ok(Some(false))),
        (
            "c",
            r#"{"mcp":{"serverEnabled":"false"}}"#,
            Err(McpConfigReadError::Parse),
        ),
        ("d", r#"{"mcp":5}"#, Err(McpConfigReadError::Parse)),
        ("e", r#"{"mcp":null}"#, Err(McpConfigReadError::Parse)),
        ("f", "{}", Ok(Some(true))),
    ];
    let mut failures = Vec::new();
    for (name, raw, want) in rows {
        let before = write_raw_config(&h.dir, raw);
        let got = read();
        if got != want {
            failures.push(format!("({name}) got {got:?}, want {want:?}"));
        }
        if read_config_bytes(&h.dir) != before {
            failures.push(format!("({name}) bytes changed"));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn rd10_production_wrapper_blocks_on_the_preferences_lock_and_creates_nothing() {
    let h = TestHome::new("mcp_rd10");
    let guard = preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let _ = tx.send(read_server_enabled());
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
    assert!(!config_file(&h.dir).exists(), "wrapper created config.json");
}

#[test]
fn rd11_disk_state_through_reader_and_decide_over_four_partitions() {
    use McpLaunchDecision::{Skip, Start};
    type Seed = fn(&Path);
    let rows: [(&str, Seed, McpLaunchDecision); 4] = [
        ("missing", |_: &Path| {}, Start(StartReason::NoConfig)),
        (
            "true",
            |home: &Path| {
                seed_config(home, |v| v["mcp"]["serverEnabled"] = json!(true));
            },
            Start(StartReason::Enabled),
        ),
        (
            "false",
            |home: &Path| {
                seed_config(home, |v| v["mcp"]["serverEnabled"] = json!(false));
            },
            Skip(SkipReason::Disabled),
        ),
        (
            "corrupt",
            |home: &Path| {
                write_raw_config(home, "{ corrupt");
            },
            Start(StartReason::ConfigUnreadable(McpConfigReadError::Parse)),
        ),
    ];
    for (name, seed, want) in rows {
        let h = TestHome::new(&format!("mcp_rd11_{name}"));
        seed(&h.dir);
        let before = listing(&h.dir);
        let got = decide_mcp_launch(read_server_enabled_in(&Mutex::new(())));
        assert_eq!(got, want, "partition {name}");
        assert_eq!(listing(&h.dir), before, "partition {name}: fs changed");
    }
}
