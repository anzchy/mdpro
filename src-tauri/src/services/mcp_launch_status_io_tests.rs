//! Temp-HOME cases for the MCP status path (ADR-0039, WI-5).
//!
//! BS-02, BS-03 (reader + `build_status`) and BS-07 (a)…(i) through
//! `current_status_in` / `current_status`, the whole `mcp_get_status` body.
//! Real filesystem, real mutexes, real poison, the real
//! `preferences_rw_lock`. Poison is applied to local mutexes only.

use super::*;
use crate::models::ServerConfig;
use crate::services::preferences::preferences_rw_lock;
use crate::services::window_restore::test_home::{
    config_file, config_mtime, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::json;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use McpLaunchStatus::{Running, Starting};

/// Poison `m` by panicking while holding it on another thread.
fn poison<T: Send + 'static>(m: &Arc<Mutex<T>>) {
    let m2 = Arc::clone(m);
    let _ = std::thread::spawn(move || {
        let _g = m2.lock();
        panic!("poisoning a local test mutex on purpose");
    })
    .join();
    assert!(m.is_poisoned(), "precondition: lock is poisoned");
}

fn server_with(port: u16, token: &str) -> SharedServerConfig {
    Arc::new(Mutex::new(Some(ServerConfig {
        port,
        token: token.to_string(),
    })))
}

#[test]
fn bs02_flipping_the_disk_changes_configured_and_conserves_launch() {
    let h = TestHome::new("mcp_bs02");
    let m = Mutex::new(());

    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
    let s1 = build_status(Running, read_server_enabled_in(&m), Some(1), "b".into());
    assert_eq!(read_config_bytes(&h.dir), before);

    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));
    let s2 = build_status(Running, read_server_enabled_in(&m), Some(1), "b".into());
    assert_eq!(read_config_bytes(&h.dir), before);

    let before = write_raw_config(&h.dir, "{ corrupt");
    let s3 = build_status(Running, read_server_enabled_in(&m), Some(1), "b".into());
    assert_eq!(read_config_bytes(&h.dir), before);

    assert_eq!(s1.configured, McpConfigured::Enabled);
    assert_eq!(s2.configured, McpConfigured::Disabled);
    assert_eq!(s3.configured, McpConfigured::Unreadable);
    for s in [&s1, &s2, &s3] {
        assert_eq!(s.launch, Running);
    }
}

#[test]
fn bs03_status_with_no_config_is_enabled_and_creates_nothing() {
    let h = TestHome::new("mcp_bs03");
    let m = Mutex::new(());

    let s = build_status(
        McpLaunchStatus::Disabled,
        read_server_enabled_in(&m),
        None,
        "b".into(),
    );

    assert_eq!(s.configured, McpConfigured::Enabled);
    assert!(!config_file(&h.dir).exists());
    assert!(!h.dir.join(".mdpro").exists());
}

#[test]
fn bs07_through_the_command_body_disk_flips_are_seen_and_unreadable_is_reported() {
    let h = TestHome::new("mcp_bs07");
    let launch: SharedMcpLaunchState = Arc::new(Mutex::new(Running));
    let server = server_with(55045, "secret-tok");
    let m = Mutex::new(());
    let no_token = |s: &McpStatus, step: &str| {
        let wire = serde_json::to_string(s).unwrap();
        assert!(
            !wire.contains("secret-tok"),
            "({step}) token leaked: {wire}"
        );
    };

    // (a) empty HOME
    assert!(!h.dir.join(".mdpro").exists(), "precondition: empty HOME");
    let a = current_status_in(&m, &launch, &server, "b".into()).expect("(a) Ok");
    assert_eq!(a.configured, McpConfigured::Enabled, "(a)");
    assert_eq!(a.launch, Running, "(a)");
    assert!(a.running, "(a)");
    assert_eq!(a.port, Some(55045), "(a)");
    assert!(
        !h.dir.join(".mdpro").exists(),
        "(a) status path created ~/.mdpro"
    );
    no_token(&a, "a");

    // (b) disabled on disk
    seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));
    let (bytes, mtime) = (read_config_bytes(&h.dir), config_mtime(&h.dir));
    let b = current_status_in(&m, &launch, &server, "b".into()).expect("(b) Ok");
    assert_eq!(b.configured, McpConfigured::Disabled, "(b)");
    assert_eq!(
        (b.launch, b.running, b.port),
        (a.launch, a.running, a.port),
        "(b)"
    );
    assert_eq!(
        (read_config_bytes(&h.dir), config_mtime(&h.dir)),
        (bytes, mtime)
    );
    no_token(&b, "b");

    // (c) the reverse flip
    seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
    let (bytes, mtime) = (read_config_bytes(&h.dir), config_mtime(&h.dir));
    let c = current_status_in(&m, &launch, &server, "b".into()).expect("(c) Ok");
    assert_eq!(c.configured, McpConfigured::Enabled, "(c)");
    assert_eq!(
        (read_config_bytes(&h.dir), config_mtime(&h.dir)),
        (bytes, mtime)
    );
    no_token(&c, "c");

    // (d) corrupt: reported, not raised
    write_raw_config(&h.dir, "{ not valid json");
    let (bytes, mtime) = (read_config_bytes(&h.dir), config_mtime(&h.dir));
    let d = current_status_in(&m, &launch, &server, "b".into());
    assert!(
        matches!(&d, Ok(s) if s.configured == McpConfigured::Unreadable),
        "(d) {d:?}"
    );
    assert_eq!(
        (read_config_bytes(&h.dir), config_mtime(&h.dir)),
        (bytes, mtime)
    );
    no_token(d.as_ref().unwrap(), "d");

    // (e) poisoned preferences lock: unreadable, never read through
    seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));
    let (bytes, mtime) = (read_config_bytes(&h.dir), config_mtime(&h.dir));
    let poisoned = Arc::new(Mutex::new(()));
    poison(&poisoned);
    let e = current_status_in(&poisoned, &launch, &server, "b".into());
    assert!(
        matches!(&e, Ok(s) if s.configured == McpConfigured::Unreadable),
        "(e) {e:?}"
    );
    assert_eq!(
        (read_config_bytes(&h.dir), config_mtime(&h.dir)),
        (bytes, mtime)
    );
    no_token(e.as_ref().unwrap(), "e");

    // (f) poisoned launch state (a separate one): Err, no panic
    let poisoned_launch: SharedMcpLaunchState = Arc::new(Mutex::new(Running));
    poison(&poisoned_launch);
    let f = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        current_status_in(&m, &poisoned_launch, &server, "b".into())
    }))
    .expect("(f) panicked");
    assert!(
        matches!(&f, Err(msg) if !msg.contains('/')),
        "(f) expected a path-free Err, got {f:?}"
    );

    // (g) production wrapper blocks on preferences_rw_lock; empty HOME again
    let _ = std::fs::remove_dir_all(h.dir.join(".mdpro"));
    assert!(!h.dir.join(".mdpro").exists(), "precondition: empty HOME");
    let guard = preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = mpsc::channel();
    let (l2, s2) = (Arc::clone(&launch), Arc::clone(&server));
    let caller = std::thread::spawn(move || {
        let _ = tx.send(current_status(&l2, &s2, "b".into()));
    });
    let while_held = rx.recv_timeout(Duration::from_millis(150));
    // Released before any assertion, so a failure cannot poison the global lock.
    drop(guard);
    let after_release = rx.recv_timeout(Duration::from_secs(5));
    let _ = caller.join();
    assert!(
        matches!(while_held, Err(RecvTimeoutError::Timeout)),
        "(g) status completed while the lock was held: {while_held:?}"
    );
    assert!(
        matches!(&after_release, Ok(Ok(s)) if s.configured == McpConfigured::Enabled),
        "(g) {after_release:?}"
    );
    assert!(
        !h.dir.join(".mdpro").exists(),
        "(g) status path created ~/.mdpro"
    );
}

#[test]
fn bs07_h_server_state_is_an_independent_input() {
    let _h = TestHome::new("mcp_bs07h");
    let m = Mutex::new(());

    let h1 = current_status_in(
        &m,
        &Arc::new(Mutex::new(Starting)),
        &server_with(7, "t"),
        "b".into(),
    )
    .expect("(h1) Ok");
    assert_eq!(h1.launch, Starting, "(h1)");
    assert!(h1.running, "(h1)");
    assert_eq!(h1.port, Some(7), "(h1)");

    let running_launch: SharedMcpLaunchState = Arc::new(Mutex::new(Running));
    let h2 = current_status_in(&m, &running_launch, &Arc::new(Mutex::new(None)), "b".into())
        .expect("(h2) Ok");
    assert_eq!(h2.launch, Running, "(h2)");
    assert!(!h2.running, "(h2)");
    assert!(h2.port.is_none(), "(h2)");
}

#[test]
fn bs07_i_poisoned_server_state_is_err_not_panic() {
    let _h = TestHome::new("mcp_bs07i");
    let m = Mutex::new(());
    let launch: SharedMcpLaunchState = Arc::new(Mutex::new(Running));
    let server = server_with(55045, "t");
    poison(&server);

    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        current_status_in(&m, &launch, &server, "b".into())
    }))
    .expect("(i) panicked");
    assert!(
        matches!(&r, Err(msg) if !msg.contains('/')),
        "(i) expected a path-free Err, got {r:?}"
    );
}
