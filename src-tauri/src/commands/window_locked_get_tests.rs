//! D24 review follow-up — `get_window_geometry` reads under
//! `preferences_rw_lock`, like restore does.
//!
//! On first run `load_preferences` materialises a default `config.json`; doing
//! that unlocked could overwrite a concurrent `save_window_geometry`.
//!
//! Runs in a temp `$HOME` under `HOME_LOCK` (`TestHome`). Nothing is mocked.

use super::*;
use crate::services::window_restore::test_home::{config_file, TestHome};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

#[test]
fn gl1_get_blocks_while_preferences_lock_is_held() {
    let h = TestHome::new("gl1");
    assert!(
        !config_file(&h.dir).exists(),
        "precondition: no config.json"
    );

    let guard = preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let r = tauri::async_runtime::block_on(get_window_geometry("/tmp/x.md".to_string()));
        let _ = tx.send(r.map(|resp| resp.geometry));
    });
    let while_held = rx.recv_timeout(Duration::from_millis(150));
    // Released before any assertion, so a failure cannot poison the global lock.
    drop(guard);
    let after_release = rx.recv_timeout(Duration::from_secs(5));
    let _ = reader.join();

    assert!(
        matches!(while_held, Err(RecvTimeoutError::Timeout)),
        "get completed while the lock was held: {while_held:?}"
    );
    assert_eq!(after_release, Ok(Ok(None)));
}
