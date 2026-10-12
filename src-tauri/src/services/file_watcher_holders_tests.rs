//! D173-WI-1: the two-layer holder model (plan r2 §2, §3). Holds are keyed
//! by (window label, raw spelling) and carry a generation; the backend watch
//! and the baseline belong to the canonical group and go only when the
//! group has no consumer. Real notify watcher (`for_tests`), real temp files;
//! routing uses hand-built events through the real `process_event`.
//!
//! Every case runs under `TempHome`: `watch` / `unwatch` log through the real
//! logger, which writes to `$HOME/.mdpro/mdpro.log`.
use super::super::baseline::fixture::{alias_pair, append, TempDir};
use super::super::{FileWatcher, WatchOutcome};
use super::ReleaseOutcome::{BackendReleased, KeptRaw, Stale, UnclaimedRaw};
use super::fixture::{
    acquire, assert_nothing_left, group_count, group_of, holds, home, route, s, W1, W2,
};

/// a (the registered D173 regression): windows A and B hold one file; A
/// closes. B's watch and baseline remain, and an external write routes
/// `EmittedModified`. Red before D173: `close_document` unwatched the path
/// for everyone.
#[test]
fn d173_wi1_a_other_window_close_keeps_watch_baseline_and_routes_modified() {
    let _home = home("a");
    let d = TempDir::new("d173a");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    let ga = acquire(&fw, W1, &p);
    let gb = acquire(&fw, W2, &p);
    assert_eq!(fw.release_hold(W1, &p, ga), KeptRaw, "A's close keeps B's hold");
    assert_eq!(holds(&fw), vec![(W2.to_string(), p.clone(), gb)], "only B holds");
    assert_eq!(fw.watched(), vec![s(&p)], "B's watch remains");
    assert!(fw.baseline_of(&p).is_some(), "B's baseline remains");
    append(&p, b" two");
    assert_eq!(route(&fw, &p), WatchOutcome::EmittedModified, "B hears the write");
}

/// b (plan a, row 1): the first holder registers once and is recorded with
/// a nonzero generation; its group has one consumer and one notify spelling.
#[test]
fn d173_wi1_b_first_hold_registers_once() {
    let _home = home("b");
    let d = TempDir::new("d173b");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    let g = acquire(&fw, W1, &p);
    assert!(g > 0, "gen 0 is never issued");
    assert_eq!(holds(&fw), vec![(W1.to_string(), p.clone(), g)]);
    assert_eq!(
        group_of(&fw, &p),
        Some((vec![(p.clone(), 1)], vec![p.clone()])),
        "one consumer, one notify spelling"
    );
    assert_eq!(fw.watched(), vec![s(&p)]);
    assert!(fw.baseline_of(&p).is_some());
}

/// c (close racing reopen): W1 holds g1 then reacquires g2 before g1's
/// release arrives. The g1 release is `Stale` and changes nothing; the g2
/// release tears the group down.
#[test]
fn d173_wi1_c_stale_gen_release_is_noop() {
    let _home = home("c");
    let d = TempDir::new("d173c");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    let g1 = acquire(&fw, W1, &p);
    let g2 = acquire(&fw, W1, &p);
    assert!(g2 > g1, "the reopen's gen is newer: {g1} then {g2}");
    assert_eq!(fw.release_hold(W1, &p, g1), Stale, "the close's old gen");
    assert_eq!(holds(&fw), vec![(W1.to_string(), p.clone(), g2)], "the reopen holds");
    assert_eq!(fw.watched(), vec![s(&p)], "the watch stays");
    assert!(fw.baseline_of(&p).is_some(), "the baseline stays");
    assert_eq!(fw.release_hold(W1, &p, g2), BackendReleased);
    assert_nothing_left(&fw, &p, "after g2");
}

/// d (row 2): a duplicate acquisition by the same window replaces the gen
/// without adding a consumer, so the newest gen's release is the last one.
#[test]
fn d173_wi1_d_duplicate_hold_old_gen_cannot_release() {
    let _home = home("d");
    let d = TempDir::new("d173d");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    let g1 = acquire(&fw, W1, &p);
    let g2 = acquire(&fw, W1, &p);
    assert_ne!(g1, g2, "a duplicate gets a new gen");
    assert_eq!(
        group_of(&fw, &p).map(|(c, _)| c),
        Some(vec![(p.clone(), 1)]),
        "a duplicate is not a second consumer"
    );
    assert_eq!(fw.release_hold(W1, &p, g1), Stale);
    assert_eq!(fw.release_hold(W1, &p, g1), Stale, "and stays stale");
    assert_eq!(fw.release_hold(W1, &p, g2), BackendReleased);
    assert_nothing_left(&fw, &p, "after the duplicate");
}

/// e (rows 7, 7b): two windows hold; the first release keeps everything,
/// the last one unwatches and drops the baseline.
#[test]
fn d173_wi1_e_last_release_unwatches_and_drops_baseline() {
    let _home = home("e");
    let d = TempDir::new("d173e");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    let g1 = acquire(&fw, W1, &p);
    let g2 = acquire(&fw, W2, &p);
    assert_eq!(group_of(&fw, &p).map(|(c, _)| c), Some(vec![(p.clone(), 2)]));
    assert_eq!(fw.release_hold(W2, &p, g2), KeptRaw);
    assert_eq!(fw.watched(), vec![s(&p)]);
    assert_eq!(fw.release_hold(W1, &p, g1), BackendReleased);
    assert_nothing_left(&fw, &p, "last release");
    append(&p, b" two");
    assert_eq!(route(&fw, &p), WatchOutcome::EmittedModified, "no entry: fail open");
}

/// f (row 8): destroying W1 drops W1's holds only. P, held by W2 too,
/// keeps its watch and baseline; Q, held only by W1, loses both.
#[test]
fn d173_wi1_f_release_window_drops_only_its_holds() {
    let _home = home("f");
    let d = TempDir::new("d173f");
    let p = d.file("p.md", b"p");
    let q = d.file("q.md", b"q");
    let fw = FileWatcher::for_tests();
    acquire(&fw, W1, &p);
    acquire(&fw, W1, &q);
    let gp2 = acquire(&fw, W2, &p);
    fw.release_window(W1);
    assert_eq!(holds(&fw), vec![(W2.to_string(), p.clone(), gp2)]);
    assert_eq!(fw.watched(), vec![s(&p)], "only P stays watched");
    assert!(fw.baseline_of(&p).is_some(), "P keeps its baseline");
    assert_eq!(fw.baseline_of(&q), None, "Q's baseline went");
}

/// g (rows 6, 9): after `Destroyed`, the window cannot acquire, and the
/// refused acquisition registers nothing. Another window still can.
#[test]
fn d173_wi1_g_acquire_after_destroyed_refused_registers_nothing() {
    let _home = home("g");
    let d = TempDir::new("d173g");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    fw.release_window(W1);
    assert_eq!(fw.reserve_hold(W1, &p), None, "a destroyed window is fenced");
    assert_eq!(holds(&fw), vec![]);
    assert_eq!(fw.watched(), Vec::<String>::new(), "nothing registered");
    let g = acquire(&fw, W2, &p);
    assert_eq!(holds(&fw), vec![(W2.to_string(), p.clone(), g)], "W2 is not fenced");
}

/// h (row 9): the window is destroyed between its reservation and its
/// confirm; the register in between is torn down on confirm. With another
/// holder (h2) the group survives.
#[test]
fn d173_wi1_h_register_racing_destroy_torn_down_on_confirm() {
    let _home = home("h");
    let d = TempDir::new("d173h");
    let p = d.file("a.md", b"one");
    let fw = FileWatcher::for_tests();
    let r = fw.reserve_hold(W1, &p).expect("reserved before Destroyed");
    fw.watch(&p);
    fw.release_window(W1);
    fw.confirm_hold(&r);
    assert_nothing_left(&fw, &p, "orphan register");

    let fw = FileWatcher::for_tests();
    let g2 = acquire(&fw, W2, &p);
    let r = fw.reserve_hold(W1, &p).expect("reserved before Destroyed");
    fw.watch(&p);
    fw.release_window(W1);
    fw.confirm_hold(&r);
    assert_eq!(holds(&fw), vec![(W2.to_string(), p.clone(), g2)], "h2: W2 keeps P");
    assert_eq!(fw.watched(), vec![s(&p)], "h2: the watch stays");
    assert!(fw.baseline_of(&p).is_some(), "h2: the baseline stays");
}

/// i (rows 4, 7): two spellings of one file in two windows form one group.
/// Releasing the alias drops its watch-list entry only; the canonical
/// spelling keeps the watch and baseline, and the group still remembers
/// both notify spellings for its teardown.
#[cfg(unix)]
#[test]
fn d173_wi1_i_additional_spelling_release_unclaims_without_notify() {
    let _home = home("i");
    let (_d, real, alias) = alias_pair("d173i");
    let b = real.join("a.md");
    let a = alias.join("a.md");
    std::fs::write(&b, b"one").expect("write");
    let fw = FileWatcher::for_tests();
    let ga = acquire(&fw, W1, &a);
    let gb = acquire(&fw, W2, &b);
    assert_eq!(group_count(&fw), 1, "one canonical group");
    let mut both = vec![(a.clone(), 1), (b.clone(), 1)];
    both.sort();
    assert_eq!(group_of(&fw, &a).map(|(c, _)| c), Some(both));
    assert_eq!(fw.release_hold(W1, &a, ga), UnclaimedRaw);
    assert_eq!(holds(&fw), vec![(W2.to_string(), b.clone(), gb)]);
    assert_eq!(fw.watched(), vec![s(&b)], "the alias left the watch list");
    assert!(fw.baseline_of(&b).is_some(), "the canonical baseline stays");
    let (consumers, spellings) = group_of(&fw, &b).expect("the group lives");
    assert_eq!(consumers, vec![(b.clone(), 1)]);
    assert_eq!(spellings, vec![a.clone(), b.clone()], "kept for the teardown");
    append(&b, b" two");
    assert_eq!(route(&fw, &b), WatchOutcome::EmittedModified);
}

/// j: a Save As whose write failed releases its reservation; nothing was
/// registered and nothing is left.
#[test]
fn d173_wi1_j_save_as_failure_releases_reservation() {
    let _home = home("j");
    let d = TempDir::new("d173j");
    let p = d.path().join("picked.md");
    let fw = FileWatcher::for_tests();
    let r = fw.reserve_hold(W1, &p).expect("reserved");
    assert_eq!(holds(&fw).len(), 1, "the reservation is a hold");
    assert_eq!(fw.release_hold(W1, &p, r.gen), BackendReleased);
    assert_nothing_left(&fw, &p, "failed Save As");
    let g = acquire(&fw, W2, &d.file("picked.md", b"x"));
    assert!(g > r.gen, "gens keep rising");
}
