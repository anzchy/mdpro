//! Shared test helpers for the D32 baseline suites: real temp files, aliases,
//! stat-preserving rewrites, sparse files, and the store's test-only readers.
//! Every helper asserts its own precondition, so a filesystem that does not
//! behave as assumed fails loudly instead of making a case vacuous.
use super::{baseline_key, snapshot, BaselineStore, Entry};
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A unique directory under `temp_dir()`, removed on drop.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(label: &str) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("mdpro_d32_{label}_{}_{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        Self(dir)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    /// Write `bytes` to `<dir>/<name>` and return the path.
    pub(crate) fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.0.join(name);
        fs::write(&p, bytes).expect("write temp file");
        p
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// `(D, D/real, D/alias)` where `D/alias` is a symlink to the directory `D/real`.
#[cfg(unix)]
pub(crate) fn alias_pair(label: &str) -> (TempDir, PathBuf, PathBuf) {
    let d = TempDir::new(label);
    let real = d.path().join("real");
    let alias = d.path().join("alias");
    fs::create_dir(&real).expect("create real dir");
    std::os::unix::fs::symlink(&real, &alias).expect("symlink alias -> real");
    (d, real, alias)
}

/// The full-precision mtime of `p`.
pub(crate) fn mtime(p: &Path) -> SystemTime {
    fs::metadata(p).and_then(|m| m.modified()).expect("mtime")
}

/// Set `p`'s mtime to `t` and assert the filesystem kept it exactly.
pub(crate) fn set_mtime(p: &Path, t: SystemTime) {
    let f = fs::File::options()
        .write(true)
        .open(p)
        .expect("open for mtime");
    f.set_modified(t).expect("set_modified");
    drop(f);
    assert_eq!(mtime(p), t, "precondition: mtime round-trips exactly");
}

/// Shift `p`'s mtime by `secs` (may be negative).
pub(crate) fn shift_mtime(p: &Path, secs: i64) {
    let t = mtime(p);
    let d = Duration::from_secs(secs.unsigned_abs());
    set_mtime(p, if secs < 0 { t - d } else { t + d });
}

/// Rewrite `p` with same-length `bytes`, restore its mtime, and assert the
/// snapshot stat is the one from before the rewrite.
pub(crate) fn rewrite_keep_stat(p: &Path, bytes: &[u8]) {
    let before = snapshot(p).stat;
    assert_eq!(
        fs::metadata(p).expect("stat").len(),
        bytes.len() as u64,
        "precondition: same length"
    );
    let t = mtime(p);
    fs::write(p, bytes).expect("rewrite");
    set_mtime(p, t);
    assert_eq!(snapshot(p).stat, before, "precondition: stat unchanged");
}

/// Overwrite the single byte at `pos`, keeping the stat (precondition).
pub(crate) fn poke_keep_stat(p: &Path, pos: u64, b: u8) {
    let before = snapshot(p).stat;
    let t = mtime(p);
    let mut f = fs::File::options().write(true).open(p).expect("open");
    f.seek(SeekFrom::Start(pos)).expect("seek");
    f.write_all(&[b]).expect("poke");
    drop(f);
    set_mtime(p, t);
    assert_eq!(snapshot(p).stat, before, "precondition: stat unchanged");
}

#[cfg(unix)]
pub(crate) fn chmod(p: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(mode)).expect("chmod");
}

/// Make `p` unreadable, asserting that a read really fails (a root run
/// would read it anyway and must not pass silently).
#[cfg(unix)]
pub(crate) fn chmod_000_unreadable(p: &Path) {
    chmod(p, 0o000);
    assert!(fs::read(p).is_err(), "precondition: {p:?} is unreadable");
}

/// A sparse file of exactly `len` zero bytes.
pub(crate) fn sparse(p: &Path, len: u64) {
    let f = fs::File::create(p).expect("create sparse");
    f.set_len(len).expect("set_len");
}

/// A sparse file of `len` bytes whose last byte is `b`.
pub(crate) fn sparse_last_byte(p: &Path, len: u64, b: u8) {
    sparse(p, len);
    let mut f = fs::File::options().write(true).open(p).expect("open");
    f.seek(SeekFrom::Start(len - 1)).expect("seek");
    f.write_all(&[b]).expect("write last byte");
}

/// Deterministic varied bytes: no two 4 KiB blocks are equal.
pub(crate) fn varied(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 31 + i / 4096) as u8).collect()
}

/// The snapshot hash of `bytes`, taken from a real file holding them.
pub(crate) fn h(bytes: &[u8]) -> Option<u64> {
    let d = TempDir::new("h");
    let hash = snapshot(&d.file("h.md", bytes)).hash;
    assert!(hash.is_some(), "precondition: a small readable file hashes");
    hash
}

/// Test-only readers. They take the lock through `locked()` like the
/// production helpers do, and read by the current `baseline_key`.
impl BaselineStore {
    pub(crate) fn get(&self, p: &Path) -> Option<Entry> {
        let key = baseline_key(p);
        self.locked().entries.get(&key).copied()
    }

    pub(crate) fn len(&self) -> usize {
        self.locked().entries.len()
    }

    /// Poison the store's mutex by panicking while holding its guard.
    pub(crate) fn poison_for_tests(&self) {
        std::thread::scope(|s| {
            let _ = s
                .spawn(|| {
                    let _guard = self.locked();
                    panic!("poison the baseline lock (expected in B15)");
                })
                .join();
        });
        assert!(self.inner.is_poisoned(), "precondition: lock is poisoned");
    }
}

// ---- D32 WI-4 routing helpers (synthetic notify events, real store) ----

/// Two of the three filtered kinds; each must still pass a real change.
pub(crate) const EXTENDED: notify::EventKind = notify::EventKind::Modify(
    notify::event::ModifyKind::Metadata(notify::event::MetadataKind::Extended),
);
pub(crate) const CONTENT: notify::EventKind = notify::EventKind::Modify(
    notify::event::ModifyKind::Data(notify::event::DataChange::Content),
);
/// The third filtered kind (D32 WI-4b): FSEvents' residual Metadata flag.
pub(crate) const META_ANY: notify::EventKind = notify::EventKind::Modify(
    notify::event::ModifyKind::Metadata(notify::event::MetadataKind::Any),
);
/// Every kind the unchanged-file drop applies to (ADR-0068 decision 1).
pub(crate) const FILTERED: [notify::EventKind; 3] = [META_ANY, EXTENDED, CONTENT];

/// The watcher's debounce map type.
pub(crate) type Map = std::sync::Mutex<std::collections::HashMap<PathBuf, std::time::Instant>>;

pub(crate) fn fresh() -> Map {
    Map::default()
}

/// Set (or overwrite) `p`'s debounce entry to `ms` milliseconds ago.
pub(crate) fn seed(map: &Map, p: &Path, ms: u64) {
    let at = std::time::Instant::now()
        .checked_sub(Duration::from_millis(ms))
        .expect("monotonic clock is older than the offset");
    map.lock().unwrap().insert(p.to_path_buf(), at);
}

pub(crate) fn ev(kind: notify::EventKind, paths: &[&Path]) -> notify::Event {
    paths
        .iter()
        .fold(notify::Event::new(kind), |e, p| e.add_path(p.to_path_buf()))
}

/// Route one synthetic event through the real `process_event`.
pub(crate) fn route(
    kind: notify::EventKind,
    paths: &[&Path],
    map: &Map,
    store: &BaselineStore,
) -> (serde_json::Value, super::super::WatchOutcome) {
    let (emitted, outcome) =
        super::super::process_event(&ev(kind, paths), map, store, super::super::kinds_fixture::T);
    (serde_json::to_value(&emitted).unwrap(), outcome)
}

/// The exact `file:changed` payload for a `modified` emission on `p`.
pub(crate) fn modified(p: &Path) -> serde_json::Value {
    serde_json::json!({
        "path": p.to_string_lossy(),
        "changeType": "modified",
        "newPath": null,
        "timestamp": super::super::kinds_fixture::T,
    })
}

/// Append `bytes` to `p` (a real, size-changing write).
pub(crate) fn append(p: &Path, bytes: &[u8]) {
    let mut f = fs::File::options().append(true).open(p).expect("open");
    f.write_all(bytes).expect("append");
}
