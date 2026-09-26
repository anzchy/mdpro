//! Shared temp-`$HOME` harness for the window-restore tests (D24 follow-up).
//!
//! The `HOME_LOCK` + `HomeRestorer` + `temp_home` + `seed_config` +
//! `read_config_bytes` set of `commands/window_tests.rs:33-79`, kept once here
//! so later suites (`commands/window_lookup_tests.rs`) reuse it rather than
//! making another copy. Test-only; registered under `cfg(test)`.
//!
//! [`TestHome`] holds `crate::HOME_LOCK` for its whole life and points `$HOME`
//! at a fresh temp dir, so the developer's `~/.mdpro/` is never touched.

use crate::models::UserPreferences;
use crate::HOME_LOCK;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;
use std::time::SystemTime;

/// Restores the previous `$HOME` when dropped.
pub(crate) struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// A temp `$HOME` held under `HOME_LOCK`. Field order matters: `$HOME` is
/// restored before the lock is released.
pub(crate) struct TestHome {
    _home: HomeRestorer,
    _lock: MutexGuard<'static, ()>,
    pub dir: PathBuf,
}

impl TestHome {
    pub(crate) fn new(label: &str) -> Self {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = temp_home(label);
        let prev = std::env::var("HOME").ok();
        // SAFETY: HOME_LOCK is held for the lifetime of the returned guard.
        unsafe { std::env::set_var("HOME", dir.to_str().expect("temp dir path is non-UTF-8")) };
        TestHome {
            _home: HomeRestorer(prev),
            _lock: lock,
            dir,
        }
    }
}

/// Its own prefix, so parallel test binaries cannot collide on one temp dir.
pub(crate) fn temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_window_restore_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp home");
    dir
}

pub(crate) fn config_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json")
}

/// A complete `config.json` built by round-tripping `UserPreferences::default()`
/// through serde, then mutated. Returns the bytes written.
pub(crate) fn seed_config(home: &Path, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut v = serde_json::to_value(UserPreferences::default()).expect("defaults serialize");
    mutate(&mut v);
    let raw = serde_json::to_string(&v).expect("seed serializes");
    write_raw_config(home, &raw)
}

/// Write `raw` verbatim as `config.json` (for corrupt-file cases).
pub(crate) fn write_raw_config(home: &Path, raw: &str) -> Vec<u8> {
    std::fs::create_dir_all(home.join(".mdpro")).expect("create .mdpro");
    std::fs::write(config_file(home), raw).expect("write config.json");
    raw.as_bytes().to_vec()
}

pub(crate) fn read_config_bytes(home: &Path) -> Vec<u8> {
    std::fs::read(config_file(home)).expect("config.json must still exist")
}

pub(crate) fn config_mtime(home: &Path) -> SystemTime {
    std::fs::metadata(config_file(home))
        .and_then(|m| m.modified())
        .expect("config.json mtime")
}
