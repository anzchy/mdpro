//! D106-WI-1: two raw spellings of one file (here through a directory
//! symlink) share one canonical entry, and removing one spelling must not
//! drop the entry the other still holds. The ticket rule keeps holding per
//! spelling: an old remove through A cannot take B's claim, and an old
//! register through A cannot revive A after A's own remove.
use super::super::fixture::{alias_pair, TempDir};
use super::super::UnchangedCheck;
use super::super::{baseline_key, next_ticket, snapshot, BaselineStore, StoreOutcome};
use crate::services::file_watcher::FileWatcher;
use std::fs;
use std::path::PathBuf;

/// `(d, A, B)`: `A = d/real/a.md` and `B = d/alias/a.md`, one file reached
/// through a directory symlink. Asserts both spellings share one key.
fn two_spellings(label: &str) -> (TempDir, PathBuf, PathBuf) {
    let (d, real, alias) = alias_pair(label);
    let a = real.join("a.md");
    let b = alias.join("a.md");
    fs::write(&a, b"aaaa").expect("write a.md");
    assert_ne!(a, b, "precondition: two raw spellings");
    assert_eq!(baseline_key(&a), baseline_key(&b), "precondition: one key");
    assert!(snapshot(&a).hash.is_some(), "precondition: the file hashes");
    (d, a, b)
}

/// a: register A and B, remove A; B keeps its baseline and an unchanged
/// check through B answers `Unchanged`. Red before D106: the remove of A
/// dropped the shared entry.
#[test]
fn d106_a_removing_one_spelling_keeps_the_others_baseline() {
    let (_d, a, b) = two_spellings("d106a");
    let store = BaselineStore::default();
    store.register(&a);
    store.register(&b);
    assert_eq!(store.len(), 1, "precondition: one shared entry");
    store.remove(&a);
    assert_eq!(store.get(&b), Some(snapshot(&b)), "B keeps its baseline");
    assert_eq!(store.len(), 1, "the shared entry is still there");
    assert_eq!(store.is_unchanged_why(&b), UnchangedCheck::Unchanged);
}

/// b: after A, removing B as well drops the entry; both spellings answer
/// `NoEntry`.
#[test]
fn d106_b_removing_every_spelling_drops_the_entry() {
    let (_d, a, b) = two_spellings("d106b");
    let store = BaselineStore::default();
    store.register(&a);
    store.register(&b);
    store.remove(&a);
    assert_eq!(store.len(), 1, "B still holds the entry");
    store.remove(&b);
    assert_eq!(store.len(), 0, "no spelling holds it any more");
    assert_eq!(store.is_unchanged_why(&a), UnchangedCheck::NoEntry);
    assert_eq!(store.is_unchanged_why(&b), UnchangedCheck::NoEntry);
}

/// c1: a remove through A whose ticket is older than B's register still
/// lands for A, but it takes only A's claim, never B's.
#[test]
fn d106_c1_old_remove_through_a_does_not_take_bs_claim() {
    let (_d, a, b) = two_spellings("d106c1");
    let store = BaselineStore::default();
    let t1 = next_ticket();
    let t2 = next_ticket();
    let t3 = next_ticket();
    assert_eq!(
        store.register_at(&a, t1),
        StoreOutcome::Stored(snapshot(&a))
    );
    assert_eq!(
        store.register_at(&b, t3),
        StoreOutcome::Stored(snapshot(&b))
    );
    assert_eq!(store.remove_at(&a, t2), StoreOutcome::Removed);
    assert_eq!(store.get(&b), Some(snapshot(&b)), "B's claim survives");
    assert_eq!(store.is_unchanged_why(&b), UnchangedCheck::Unchanged);
    assert_eq!(store.latest_of(&a), Some(t2), "A's tombstone");
    assert_eq!(store.latest_of(&b), Some(t3));
}

/// c2: a register through A whose ticket is older than A's own remove is
/// skipped even while B holds the entry, so A is not revived: removing B
/// afterwards leaves no entry.
#[test]
fn d106_c2_old_register_through_a_does_not_revive_a() {
    let (_d, a, b) = two_spellings("d106c2");
    let store = BaselineStore::default();
    let t1 = next_ticket();
    let t2 = next_ticket();
    let t3 = next_ticket();
    let t4 = next_ticket();
    assert_eq!(
        store.register_at(&b, t2),
        StoreOutcome::Stored(snapshot(&b))
    );
    assert_eq!(store.remove_at(&a, t3), StoreOutcome::Removed);
    assert_eq!(store.get(&b), Some(snapshot(&b)), "A held no claim to take");
    assert_eq!(store.register_at(&a, t1), StoreOutcome::StaleSkipped);
    assert_eq!(store.latest_of(&a), Some(t3), "A's tombstone stands");
    assert_eq!(store.remove_at(&b, t4), StoreOutcome::Removed);
    assert_eq!(store.len(), 0, "A holds no claim, so the entry is gone");
    assert_eq!(store.is_unchanged_why(&a), UnchangedCheck::NoEntry);
}

/// d: one spelling behaves as before: register, remove, `NoEntry`.
#[test]
fn d106_d_single_spelling_register_then_remove_leaves_no_entry() {
    let (_d, a, _b) = two_spellings("d106d");
    let store = BaselineStore::default();
    store.register(&a);
    assert_eq!(store.get(&a), Some(snapshot(&a)));
    store.remove(&a);
    assert_eq!(store.len(), 0);
    assert_eq!(store.is_unchanged_why(&a), UnchangedCheck::NoEntry);
}

/// e: the same through the watcher: watch A, watch B, unwatch A, and B
/// still has its baseline.
#[test]
fn d106_e_unwatching_one_spelling_keeps_the_others_baseline() {
    let (_d, a, b) = two_spellings("d106e");
    let fw = FileWatcher::for_tests();
    fw.watch(&a);
    fw.watch(&b);
    fw.unwatch(&a);
    assert_eq!(
        fw.baseline_of(&b),
        Some(snapshot(&b)),
        "B keeps its baseline"
    );
    fw.unwatch(&b);
    assert_eq!(fw.baseline_of(&b), None, "and goes with B's unwatch");
}

/// L5 stays a leaf: the claims module runs under the guard, so its
/// production code takes no lock and does no I/O (it is outside B18′'s list).
#[test]
fn d106_f_claims_module_takes_no_lock_and_does_no_io() {
    const SRC: &str = include_str!("file_watcher_baseline_claims.rs");
    let production = SRC.split("\n#[cfg(test)]").next().unwrap_or(SRC);
    let code: Vec<&str> = production
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect();
    assert!(
        code.iter().any(|l| l.contains("fn release(")),
        "non-vacuity: the scan sees the module's code"
    );
    let banned = [
        ".lock(",
        "locked(",
        "fs::",
        "File::",
        "metadata(",
        "canonicalize(",
        "baseline_key(",
        "snapshot(",
        "read(",
        "stat_of(",
    ];
    for line in &code {
        for token in banned {
            assert!(!line.contains(token), "claims does {token}: {line}");
        }
    }
}
