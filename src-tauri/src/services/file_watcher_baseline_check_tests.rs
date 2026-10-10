//! D112-WI-2: `is_unchanged_why` names why the unchanged-file check failed
//! open, and `is_unchanged` is exactly `why == Unchanged`. One case per
//! variant the check can produce, on real files; the torn and gen cases use
//! the read hook, which fires inside the one read, outside the lock.
use super::super::fixture::{append, chmod_000_unreadable, rewrite_keep_stat, set_mtime, sparse};
use super::super::fixture::{mtime, TempDir};
use super::super::seam::{read_once_calls, with_read_hook};
use super::super::{next_ticket, snapshot, BaselineStore, Entry, HASH_CAP_BYTES};
use super::UnchangedCheck::{self, *};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// A canonical temp dir, so a deleted file's key is the key it was
/// registered under (a missing path cannot be canonicalised).
fn canon_dir(label: &str) -> (TempDir, PathBuf) {
    let d = TempDir::new(label);
    let dir = fs::canonicalize(d.path()).expect("canonicalize temp dir");
    (d, dir)
}

/// A store with `dir/<name>` (`"aaaa"`) registered and still unchanged.
fn registered(dir: &Path, name: &str) -> (Arc<BaselineStore>, PathBuf) {
    let p = dir.join(name);
    fs::write(&p, b"aaaa").expect("write p.md");
    let store = Arc::new(BaselineStore::default());
    store.register(&p);
    assert_eq!(
        store.get(&p).and_then(|e| e.hash),
        snapshot(&p).hash,
        "precondition: registered with a hash"
    );
    (store, p)
}

/// The reason is `want`, and the boolean agrees with it.
fn assert_why(store: &BaselineStore, p: &Path, want: UnchangedCheck) {
    assert_eq!(store.is_unchanged_why(p), want, "{p:?}");
    assert_eq!(store.is_unchanged(p), want == Unchanged, "{p:?}: bool");
}

/// The reason with `hook` run inside the read.
fn why_with_hook(store: &BaselineStore, p: &Path, hook: impl FnOnce() + 'static) -> UnchangedCheck {
    with_read_hook(hook, || store.is_unchanged_why(p))
}

#[test]
fn c1_as_str_is_unique_snake_case_over_all() {
    let names: Vec<&str> = UnchangedCheck::ALL.iter().map(|c| c.as_str()).collect();
    let unique: HashSet<&str> = names.iter().copied().collect();
    assert_eq!(unique.len(), UnchangedCheck::ALL.len(), "{names:?}");
    for n in &names {
        assert!(
            !n.is_empty() && n.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
            "{n}"
        );
    }
    assert_eq!(
        names,
        [
            "not_checked",
            "unchanged",
            "no_entry",
            "no_baseline",
            "read_failed",
            "unstable",
            "over_cap",
            "stat_differs",
            "hash_differs",
            "gen_moved",
        ]
    );
}

#[test]
fn c2_an_untouched_file_is_unchanged() {
    let (_d, dir) = canon_dir("c2");
    let (store, p) = registered(&dir, "p1.md");
    assert_why(&store, &p, Unchanged);
}

#[test]
fn c3_an_unregistered_path_has_no_entry() {
    let (_d, dir) = canon_dir("c3");
    let p = dir.join("never.md");
    fs::write(&p, b"aaaa").expect("write");
    assert_why(&BaselineStore::default(), &p, NoEntry);
}

/// A slot can exist without a stat or a hash: a missing file registers both
/// as `None`, a directory or an over-cap file a stat only.
#[test]
fn c4_a_slot_without_stat_or_hash_has_no_baseline() {
    let (_d, dir) = canon_dir("c4");
    let store = BaselineStore::default();
    let missing = dir.join("missing.md");
    store.register(&missing);
    assert_eq!(
        store.get(&missing),
        Some(Entry {
            stat: None,
            hash: None
        })
    );
    assert_why(&store, &missing, NoBaseline);

    let sub = dir.join("sub.md");
    fs::create_dir(&sub).expect("mkdir");
    store.register(&sub);
    assert!(store
        .get(&sub)
        .is_some_and(|e| e.stat.is_some() && e.hash.is_none()));
    assert_why(&store, &sub, NoBaseline);

    let big = dir.join("big.md");
    sparse(&big, HASH_CAP_BYTES + 1);
    store.register(&big);
    assert!(store
        .get(&big)
        .is_some_and(|e| e.stat.is_some() && e.hash.is_none()));
    assert_why(&store, &big, NoBaseline);
}

/// An io error from the open (unreadable or deleted) or the read (the path is
/// now a directory) is `read_failed`.
#[cfg(unix)]
#[test]
fn c5_an_open_or_read_error_is_read_failed() {
    let (_d, dir) = canon_dir("c5");
    let (store, p) = registered(&dir, "p2.md");
    chmod_000_unreadable(&p);
    assert_why(&store, &p, ReadFailed);

    let (store, p) = registered(&dir, "p3.md");
    fs::remove_file(&p).expect("rm");
    assert_why(&store, &p, ReadFailed);

    let (store, p) = registered(&dir, "p4.md");
    fs::remove_file(&p).expect("rm");
    fs::create_dir(&p).expect("mkdir over the name");
    assert_why(&store, &p, ReadFailed);
}

/// A write landing inside the read tears it.
#[test]
fn c6_a_torn_read_is_unstable() {
    let (_d, dir) = canon_dir("c6");
    let (store, p) = registered(&dir, "p5.md");
    let (target, t) = (p.clone(), mtime(&p));
    let why = why_with_hook(&store, &p, move || {
        set_mtime(&target, t + Duration::from_secs(5));
    });
    assert_eq!(why, Unstable);

    let (store, p) = registered(&dir, "p6.md");
    let (target, t) = (p.clone(), mtime(&p));
    let unchanged = with_read_hook(
        move || set_mtime(&target, t + Duration::from_secs(5)),
        || store.is_unchanged(&p),
    );
    assert!(!unchanged, "the bool fails open on the same tear");
}

/// A file that grew past the cap (stable read) is `over_cap`.
#[test]
fn c7_a_file_past_the_cap_is_over_cap() {
    let (_d, dir) = canon_dir("c7");
    let (store, p) = registered(&dir, "p7.md");
    sparse(&p, HASH_CAP_BYTES + 1);
    assert_why(&store, &p, OverCap);
}

#[test]
fn c8_a_stable_read_with_another_stat_is_stat_differs() {
    let (_d, dir) = canon_dir("c8");
    let (store, p) = registered(&dir, "p8.md");
    append(&p, b"more");
    assert_why(&store, &p, StatDiffers);
}

#[test]
fn c9_same_stat_other_bytes_is_hash_differs() {
    let (_d, dir) = canon_dir("c9");
    let (store, p) = registered(&dir, "p9.md");
    rewrite_keep_stat(&p, b"bbbb");
    assert_why(&store, &p, HashDiffers);
}

/// D109: a seeded register or a remove inside the read moves the generation.
#[test]
fn c10_a_register_or_remove_inside_the_read_is_gen_moved() {
    let (_d, dir) = canon_dir("c10");
    for remove in [false, true] {
        let (store, p) = registered(&dir, "p10.md");
        let (s2, p2) = (Arc::clone(&store), p.clone());
        let seed = snapshot(&p);
        let why = why_with_hook(&store, &p, move || {
            if remove {
                s2.remove_at(&p2, next_ticket());
            } else {
                s2.register_seeded(&p2, seed, next_ticket());
            }
        });
        assert_eq!(why, GenMoved, "remove={remove}");

        let (store, p) = registered(&dir, "p11.md");
        let (s2, p2) = (Arc::clone(&store), p.clone());
        let unchanged = with_read_hook(
            move || {
                s2.remove_at(&p2, next_ticket());
            },
            || store.is_unchanged(&p),
        );
        assert!(!unchanged, "the bool fails open too");
    }
}

/// One `read_once*` call per check that reaches the read, none before it.
#[test]
fn c11_one_read_per_check() {
    let (_d, dir) = canon_dir("c11");
    let (store, p) = registered(&dir, "p12.md");
    let before = read_once_calls();
    assert_eq!(store.is_unchanged_why(&p), Unchanged);
    assert_eq!(read_once_calls() - before, 1, "unchanged: one read");
    append(&p, b"x");
    let before = read_once_calls();
    assert_eq!(store.is_unchanged_why(&p), StatDiffers);
    assert_eq!(read_once_calls() - before, 1, "changed: one read");
    let before = read_once_calls();
    assert_eq!(store.is_unchanged_why(&dir.join("none.md")), NoEntry);
    assert_eq!(read_once_calls() - before, 0, "no entry: no read");
}
