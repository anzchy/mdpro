//! D109: `is_unchanged` is generation-checked like a refresh. A register or
//! remove that lands on the path while the comparison read runs moves the
//! slot's generation, so the event fails open instead of being dropped
//! against the entry copied out before the read. The read hook fires inside
//! that read, outside the lock, and changes only the store, never the disk.
use super::super::fixture::{h, TempDir};
use super::super::seam::with_read_hook;
use super::super::{next_ticket, snapshot, BaselineStore, Entry};
use std::path::Path;
use std::sync::Arc;

/// A store whose `"aaaa"` file is registered and still `"aaaa"` on disk.
fn registered(d: &TempDir) -> (Arc<BaselineStore>, std::path::PathBuf) {
    let p = d.file("p.md", b"aaaa");
    let store = Arc::new(BaselineStore::default());
    store.register(&p);
    assert!(store.is_unchanged(&p), "precondition: unchanged with no hook");
    (store, p)
}

fn check_with_hook(store: &Arc<BaselineStore>, p: &Path, hook: impl FnOnce() + 'static) -> bool {
    with_read_hook(hook, || store.is_unchanged(p))
}

/// The audit's interleave: a second open seeds `"bbbb"` while the event's
/// read sees the restored `"aaaa"` bytes with the old stat.
#[test]
fn d109_a_seeded_register_during_the_read_fails_open() {
    let d = TempDir::new("d109a");
    let (store, p) = registered(&d);
    let seed = Entry {
        stat: snapshot(&p).stat,
        hash: h(b"bbbb"),
    };
    let (s2, p2) = (Arc::clone(&store), p.clone());
    let unchanged = check_with_hook(&store, &p, move || {
        s2.register_seeded(&p2, seed, next_ticket());
    });
    assert!(!unchanged, "a newer seed inside the read must fail open");
    assert_eq!(store.get(&p), Some(seed), "the newer seed is kept");
}

/// A remove inside the read leaves no entry to compare against.
#[test]
fn d109_b_remove_during_the_read_fails_open() {
    let d = TempDir::new("d109b");
    let (store, p) = registered(&d);
    let (s2, p2) = (Arc::clone(&store), p.clone());
    let unchanged = check_with_hook(&store, &p, move || {
        s2.remove_at(&p2, next_ticket());
    });
    assert!(!unchanged, "a remove inside the read must fail open");
    assert_eq!(store.get(&p), None);
}

/// Control: a hook that leaves the store alone keeps the drop.
#[test]
fn d109_c_untouched_slot_still_reads_unchanged() {
    let d = TempDir::new("d109c");
    let (store, p) = registered(&d);
    assert!(check_with_hook(&store, &p, || {}), "no store change, still unchanged");
}
