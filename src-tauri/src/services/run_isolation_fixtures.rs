//! Test-only fixture for `run_isolation_tests.rs` (ADR-0047 WI-002 WI-8):
//! `crate::HOME_LOCK` held for the fixture's lifetime, fresh canonical temp
//! HOMEs under `temp_dir()`, and the original `HOME` restored before the lock
//! is released. The real `HOME` is kept only for a prefix comparison.

use crate::HOME_LOCK;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::MutexGuard;

struct HomeRestore(Option<OsString>);
impl Drop for HomeRestore {
    fn drop(&mut self) {
        // SAFETY: HOME_LOCK is still held; `Locked` drops this field first.
        match self.0.take() {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// HOME_LOCK plus the HOME to restore. Field order: restore, then unlock.
pub(super) struct Locked {
    _restore: HomeRestore,
    _lock: MutexGuard<'static, ()>,
    pub(super) real: Option<OsString>,
    dirs: Vec<PathBuf>,
}

impl Locked {
    pub(super) fn new() -> Self {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let real = std::env::var_os("HOME");
        Locked {
            _restore: HomeRestore(real.clone()),
            _lock: lock,
            real,
            dirs: Vec::new(),
        }
    }

    /// A fresh canonical temp HOME, set as `$HOME`.
    pub(super) fn home(&mut self, label: &str) -> PathBuf {
        let tmp = std::env::temp_dir()
            .canonicalize()
            .expect("canonical temp dir");
        let h = tmp.join(format!("mdpro-iso-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&h).expect("create temp home");
        self.dirs.push(h.clone());
        // SAFETY: HOME_LOCK is held for the lifetime of `self`.
        unsafe { std::env::set_var("HOME", &h) };
        h
    }
}

impl Drop for Locked {
    fn drop(&mut self) {
        for d in &self.dirs {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
