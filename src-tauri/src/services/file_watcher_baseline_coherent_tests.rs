//! D32 WI-4b K5: `is_unchanged` reads coherently: stat, hash, then stat
//! again (ADR-0068 decision 3). The test seam runs a hook between the hash
//! and the second stat; a write landing there must fail the read open.
use super::fixture::{mtime, set_mtime, TempDir};
use super::BaselineStore;
use std::path::PathBuf;
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
