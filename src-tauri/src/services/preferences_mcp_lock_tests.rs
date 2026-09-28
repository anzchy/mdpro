//! P-8 (ADR-0040 WI-6): `persist_server_enabled` waits on the shared
//! `preferences_rw_lock()`, so it cannot interleave its load→save with a
//! concurrent `set_preferences` and lose that update.
//!
//! Holds a `TestHome` (temp `$HOME` under `HOME_LOCK`) for the whole case.

use super::persist_server_enabled;
use crate::services::preferences::{load_preferences, preferences_rw_lock};
use crate::services::window_restore::test_home::{read_config_bytes, seed_config, TestHome};
use serde_json::json;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

/// Long enough that a correct persist never looks blocked.
const BLOCKED_WINDOW: Duration = Duration::from_millis(500);
/// Generous bound for the persist once the lock is released.
const GENEROUS: Duration = Duration::from_secs(10);

#[test]
fn p8_persist_waits_on_the_shared_preferences_lock() {
    let h = TestHome::new("wi6_p8");
    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));

    let g = preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _ = tx.send(persist_server_enabled(false));
    });

    let blocked = rx.recv_timeout(BLOCKED_WINDOW);
    let bytes_while_held = read_config_bytes(&h.dir);
    drop(g);
    let released = rx.recv_timeout(GENEROUS);
    let _ = worker.join();

    assert_eq!(
        blocked,
        Err(RecvTimeoutError::Timeout),
        "the persist must not finish while the preferences lock is held"
    );
    assert_eq!(
        bytes_while_held, before,
        "config.json changed while the lock was held"
    );
    assert_eq!(
        released,
        Ok(Ok(())),
        "the persist must finish once released"
    );
    let reloaded = load_preferences().expect("reload");
    assert!(!reloaded.mcp.server_enabled, "reloaded serverEnabled");
}
