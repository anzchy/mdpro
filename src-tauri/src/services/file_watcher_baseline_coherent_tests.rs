//! D32 WI-4b K5 and D86 WI-1 k6/k7/k8/k11: `is_unchanged` and `snapshot`
//! decide from one coherent read (ADR-0068 decision 3). The test seam runs a
//! hook after the read and before the second fstat; a write landing there
//! must fail the read open.
use super::fixture::{mtime, rewrite_keep_stat, set_mtime, TempDir};
#[cfg(target_os = "macos")]
use super::race_fixture::{ctime_ns, set_xattr};
use super::race_fixture::{rename_over_keep_stat, stat_pair};
use super::seam::with_read_hook;
use super::{snapshot, BaselineStore, Entry};
use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A registered, unchanged `"hello world"` file in a shareable store.
fn setup(label: &str) -> (TempDir, Arc<BaselineStore>, PathBuf) {
    let d = TempDir::new(label);
    let p = d.file("a.md", b"hello world");
    let store = Arc::new(BaselineStore::default());
    store.register(&p);
    assert!(
        store.is_unchanged(&p),
        "precondition: unchanged before the hook"
    );
    (d, store, p)
}

struct Probe {
    ran: Arc<AtomicBool>,
    lock_free: Arc<AtomicBool>,
}

impl Probe {
    fn new() -> Self {
        Self {
            ran: Arc::new(AtomicBool::new(false)),
            lock_free: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Wrap `write` so the hook records that it ran and whether the store's
    /// mutex could be taken at that moment (it must be: no I/O under L5).
    fn hook(
        &self,
        store: &Arc<BaselineStore>,
        write: impl FnOnce() + 'static,
    ) -> impl FnOnce() + 'static {
        let (ran, free, store) = (
            Arc::clone(&self.ran),
            Arc::clone(&self.lock_free),
            Arc::clone(store),
        );
        move || {
            free.store(store.inner.try_lock().is_ok(), Ordering::SeqCst);
            write();
            ran.store(true, Ordering::SeqCst);
        }
    }

    fn assert_ran_outside_the_lock(&self) {
        assert!(self.ran.load(Ordering::SeqCst), "the hook never ran");
        assert!(
            self.lock_free.load(Ordering::SeqCst),
            "the hook ran under the store lock"
        );
    }
}

/// K5 (a): same-size different bytes with mtime moved forward, written after
/// the hash read: the second stat differs, so the file is not unchanged.
#[test]
fn k5_write_between_hash_and_second_stat_is_not_unchanged() {
    let (_d, store, p) = setup("k5a");
    let probe = Probe::new();
    let target = p.clone();
    let hook = probe.hook(&store, move || {
        let t = mtime(&target);
        std::fs::write(&target, b"HELLO WORLD").expect("rewrite");
        set_mtime(&target, t + Duration::from_secs(5));
    });
    assert!(
        !store.is_unchanged_with(&p, hook),
        "a mid-read write must emit"
    );
    probe.assert_ran_outside_the_lock();
    assert!(!store.is_unchanged(&p), "and it stays changed");
}

/// K5 (b): identical bytes rewritten with a later mtime: the hash still
/// matches, but the second stat does not, so the read fails open.
#[test]
fn k5_identical_bytes_with_a_bumped_mtime_is_not_unchanged() {
    let (_d, store, p) = setup("k5b");
    let probe = Probe::new();
    let target = p.clone();
    let hook = probe.hook(&store, move || {
        let t = mtime(&target);
        std::fs::write(&target, b"hello world").expect("rewrite");
        set_mtime(&target, t + Duration::from_secs(5));
    });
    assert!(!store.is_unchanged_with(&p, hook), "stat-after differs");
    probe.assert_ran_outside_the_lock();
}

/// K5 (c, control): a no-op hook leaves an unchanged file unchanged, and the
/// hook did run, so (a) and (b) are not passing for another reason.
#[test]
fn k5_noop_hook_is_unchanged() {
    let (_d, store, p) = setup("k5c");
    let probe = Probe::new();
    let hook = probe.hook(&store, || {});
    assert!(store.is_unchanged_with(&p, hook), "no write, no change");
    probe.assert_ran_outside_the_lock();
}

// ---- D86 WI-1: a single-handle coherent read (matrix k6, k7, k8, k11) ----

/// k6: same-length bytes rewritten during the read, mtime restored, so the
/// path stat equals the baseline. Only the fd's ctime can see it: fail open.
/// macOS only: the precondition needs ctime to move between two quick
/// writes, which ext4's coarse timestamps (Linux, WSL) do not guarantee.
#[cfg(target_os = "macos")]
#[test]
fn k6_same_length_rewrite_restoring_mtime_during_read_fails_open() {
    let (_d, store, p) = setup("k6");
    let probe = Probe::new();
    let ctimes = Rc::new(Cell::new((0, 0)));
    let (target, seen) = (p.clone(), Rc::clone(&ctimes));
    let hook = probe.hook(&store, move || {
        let before = ctime_ns(&target);
        rewrite_keep_stat(&target, b"HELLO WORLD");
        seen.set((before, ctime_ns(&target)));
    });
    let unchanged = store.is_unchanged_with(&p, hook);
    probe.assert_ran_outside_the_lock();
    let (before, after) = ctimes.get();
    assert_ne!(before, after, "precondition: ctime moved (ns ctime)");
    assert_eq!(
        stat_pair(&p),
        store.get(&p).and_then(|e| e.stat),
        "precondition: the path stat still equals the stored one"
    );
    assert!(!unchanged, "a same-length rewrite during the read must emit");
    assert!(!store.is_unchanged(&p), "and it stays changed");
}

/// k7: a same-length sibling with the original mtime is renamed over the
/// path during the read. The path stat equals the baseline: fail open.
#[test]
fn k7_rename_over_after_open_fails_open() {
    let (_d, store, p) = setup("k7");
    let probe = Probe::new();
    let moved = Rc::new(Cell::new(None));
    let (target, seen) = (p.clone(), Rc::clone(&moved));
    let hook = probe.hook(&store, move || {
        seen.set(Some(rename_over_keep_stat(&target, b"HELLO WORLD").old_ctime_moved));
    });
    let unchanged = store.is_unchanged_with(&p, hook);
    probe.assert_ran_outside_the_lock();
    assert_eq!(
        stat_pair(&p),
        store.get(&p).and_then(|e| e.stat),
        "precondition: the path stat still equals the stored one"
    );
    assert!(
        !unchanged,
        "a rename-over during the read must emit (old_ctime_moved = {:?})",
        moved.get()
    );
}

/// k8: an xattr-only write moves ctime and nothing stored. It stays
/// unchanged and every filtered kind is dropped (the D32 guard on macOS).
#[cfg(target_os = "macos")]
#[test]
fn k8_xattr_write_only_still_ignored_unchanged() {
    use super::super::WatchOutcome::IgnoredUnchanged;
    use super::fixture::{fresh, route, FILTERED};
    let (_d, store, p) = setup("k8");
    let (c0, b0, s0) = (ctime_ns(&p), std::fs::read(&p).unwrap(), stat_pair(&p));
    set_xattr(&p, "com.apple.mdpro.test", b"1");
    assert_eq!(std::fs::read(&p).unwrap(), b0, "precondition: bytes unchanged");
    assert_eq!(stat_pair(&p), s0, "precondition: (mtime, size) unchanged");
    assert_ne!(ctime_ns(&p), c0, "precondition: ctime moved");
    assert!(store.is_unchanged(&p), "an xattr write is not a change");
    for kind in FILTERED {
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (serde_json::Value::Null, IgnoredUnchanged),
            "{kind:?}"
        );
    }
    assert_eq!(store.get(&p), Some(snapshot(&p)), "entry neither advanced nor degraded");
}

/// k11: a register whose read is torn by a same-length, stat-keeping rewrite
/// stores the stat and no hash, so the next filtered event emits. macOS only:
/// like k6, it needs ctime to move between two quick writes.
#[cfg(target_os = "macos")]
#[test]
fn k11_torn_register_stores_stat_and_no_hash() {
    use super::super::WatchOutcome::EmittedModified;
    use super::fixture::{fresh, modified, route, CONTENT};
    let d = TempDir::new("k11");
    let p = d.file("a.md", b"hello world");
    let store = BaselineStore::default();
    let ran = Rc::new(Cell::new(false));
    let (target, flag) = (p.clone(), Rc::clone(&ran));
    with_read_hook(
        move || {
            rewrite_keep_stat(&target, b"HELLO WORLD");
            flag.set(true);
        },
        || store.register(&p),
    );
    assert!(ran.get(), "the hook ran inside register's read");
    assert_eq!(
        store.get(&p),
        Some(Entry {
            stat: stat_pair(&p),
            hash: None
        })
    );
    assert_eq!(
        route(CONTENT, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
}
