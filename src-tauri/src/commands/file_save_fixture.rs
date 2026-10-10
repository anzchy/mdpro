//! Shared helpers for the D32 WI-6 save-refresh suites
//! (`file_save_baseline_tests.rs`, `file_save_burst_tests.rs`): a unique
//! temp dir, synthetic notify events, and a `save_file_with` call with the
//! default options. Real files, a real `FileWatcher::for_tests()` store and
//! the real save path; nothing is mocked (ADR-0068 decision 4). `Dir`
//! serializes on `crate::HOME_LOCK` so the watcher's register lines stay
//! out of other suites' logs.
use crate::commands::file::{save_file_with, FileError, SaveResult};
use crate::services::file_watcher::{snapshot, BaselineStore};
use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::{Event, EventKind};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

pub(crate) const EXTENDED: EventKind =
    EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended));
pub(crate) const META_ANY: EventKind = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any));
pub(crate) const CONTENT: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));

/// A unique directory under `temp_dir()`, removed (after restoring 0o700)
/// on drop. It also holds `crate::HOME_LOCK` with `$HOME` pointed at a
/// sibling `_home` dir for its lifetime, like the `TempHome` the other
/// watcher suites use: `FileWatcher::watch` logs `file.watch.register`
/// through the real logger into `$HOME/.mdpro/mdpro.log`, and a suite that
/// owns that log (D59) must not see these lines. Not reentrant: one `Dir`
/// per test at a time.
pub(crate) struct Dir {
    path: PathBuf,
    home: PathBuf,
    prev_home: Option<String>,
    _lock: MutexGuard<'static, ()>,
}

impl Dir {
    pub(crate) fn new(label: &str) -> Self {
        let lock = crate::HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = unique_temp(label);
        let mut home = path.clone().into_os_string();
        home.push("_home");
        let home = PathBuf::from(home);
        for d in [&path, &home] {
            let _ = fs::remove_dir_all(d);
            fs::create_dir_all(d).expect("create temp dir");
        }
        let prev_home = std::env::var("HOME").ok();
        // SAFETY: HOME_LOCK is held for the lifetime of this value.
        unsafe { std::env::set_var("HOME", &home) };
        Self {
            path,
            home,
            prev_home,
            _lock: lock,
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.path.join(name);
        fs::write(&p, bytes).expect("write temp file");
        p
    }
}

/// `$HOME` is restored here, before the `_lock` field drops.
impl Drop for Dir {
    fn drop(&mut self) {
        chmod(&self.path, 0o700);
        let _ = fs::remove_dir_all(&self.path);
        let _ = fs::remove_dir_all(&self.home);
        // SAFETY: HOME_LOCK is still held; `_lock` drops after this body.
        match &self.prev_home {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

fn unique_temp(label: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("mdpro_d32s_{label}_{}_{n}", std::process::id()))
}

pub(crate) fn chmod(p: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(p, fs::Permissions::from_mode(mode));
}

/// The canonical form FSEvents reports (`/private/var/…`).
pub(crate) fn canon(p: &Path) -> PathBuf {
    fs::canonicalize(p).expect("canonicalize")
}

pub(crate) fn ev(kind: EventKind, p: &Path) -> Event {
    Event::new(kind).add_path(p.to_path_buf())
}

/// The snapshot hash of `bytes`, taken from a real file holding them. A
/// plain temp file, not a `Dir`: callers already hold one, and it watches
/// nothing.
pub(crate) fn hash_of(bytes: &[u8]) -> Option<u64> {
    let f = unique_temp("hash").with_extension("md");
    fs::write(&f, bytes).expect("write temp file");
    let hash = snapshot(&f).hash;
    let _ = fs::remove_file(&f);
    assert!(hash.is_some(), "precondition: a small readable file hashes");
    hash
}

/// `save_file_with` with an explicit encoding and line ending.
pub(crate) async fn save_as(
    p: &Path,
    content: &str,
    encoding: Option<&str>,
    line_ending: Option<&str>,
    baselines: &BaselineStore,
) -> Result<SaveResult, FileError> {
    save_file_with(
        "d1".into(),
        content.into(),
        Some(p.to_string_lossy().to_string()),
        encoding.map(str::to_string),
        line_ending.map(str::to_string),
        None,
        baselines,
    )
    .await
}

/// `save_file_with` with the default (UTF-8, LF) options.
pub(crate) async fn save(
    p: &Path,
    content: &str,
    baselines: &BaselineStore,
) -> Result<SaveResult, FileError> {
    save_as(p, content, None, None, baselines).await
}
