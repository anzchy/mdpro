//! D116-WI-2 (drive-by from the b42 audit of D106): when a spelling's claim
//! is released or moves to another key while another spelling keeps the
//! entry, the kept entry's generation is bumped. A `refresh_if_present`
//! that copied the slot out before that change must then fail its
//! generation check instead of storing its snapshot into the surviving
//! entry. The read hook fires inside the refresh's snapshot, after its
//! copy-out and outside the lock, as in the g3 legs.
use super::super::fixture::{alias_pair, h, TempDir};
use super::super::seam::with_read_hook;
use super::super::{baseline_key, BaselineStore};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// `(d, real, A, B)`: `A = d/real/a.md` and `B = d/alias/a.md` holding
/// `"aaaa"`, both registered (one shared entry), then the file rewritten to
/// `"bbbb"` on disk so a refresh would change the entry.
fn shared_then_rewritten(label: &str) -> (TempDir, Arc<BaselineStore>, PathBuf, PathBuf) {
    let (d, real, alias) = alias_pair(label);
    let a = real.join("a.md");
    let b = alias.join("a.md");
    fs::write(&a, b"aaaa").expect("write a.md");
    assert_eq!(baseline_key(&a), baseline_key(&b), "precondition: one key");
    let store = Arc::new(BaselineStore::default());
    store.register(&a);
    store.register(&b);
    assert_eq!(store.len(), 1, "precondition: one shared entry");
    fs::write(&a, b"bbbb").expect("rewrite bbbb");
    (d, store, a, b)
}

fn assert_refresh_did_not_land(store: &BaselineStore, keeper: &Path) {
    let kept = store.get(keeper).expect("the keeper still holds the entry");
    assert_eq!(
        kept.hash,
        h(b"aaaa"),
        "the in-flight refresh must not store into the surviving entry"
    );
}

/// a: the refresh (through B) copies out, then A is removed while B keeps
/// the entry; the refresh must not land. Red before WI-2: it stored `bbbb`.
#[test]
fn sg_a_refresh_does_not_land_after_another_spelling_is_released() {
    let (_d, store, a, b) = shared_then_rewritten("sg_a");
    let (s2, a2) = (Arc::clone(&store), a.clone());
    with_read_hook(move || s2.remove(&a2), || store.refresh_if_present(&b));
    assert_eq!(store.len(), 1, "B still holds the entry");
    assert_refresh_did_not_land(&store, &b);
}

/// b: the refresh (through A) copies out, then B's claim moves to another
/// key (its directory symlink now points elsewhere and B re-registers)
/// while A keeps the old entry; the refresh must not land there.
#[test]
fn sg_b_refresh_does_not_land_after_another_spelling_moves_away() {
    let (d, store, a, b) = shared_then_rewritten("sg_b");
    let real2 = d.path().join("real2");
    fs::create_dir(&real2).expect("create real2");
    fs::write(real2.join("a.md"), b"zzzz").expect("write real2/a.md");
    let alias = d.path().join("alias");
    let (s2, b2) = (Arc::clone(&store), b.clone());
    let hook = move || {
        fs::remove_file(&alias).expect("unlink alias");
        std::os::unix::fs::symlink(&real2, &alias).expect("alias -> real2");
        s2.register(&b2);
    };
    with_read_hook(hook, || store.refresh_if_present(&a));
    assert_ne!(baseline_key(&a), baseline_key(&b), "B's claim moved");
    assert_eq!(store.len(), 2, "A keeps the old entry, B has a new one");
    assert_refresh_did_not_land(&store, &a);
}
