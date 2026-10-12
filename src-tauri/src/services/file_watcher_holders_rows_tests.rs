//! D173-WI-1: the remaining transition-table rows (plan r2 §3): concurrent
//! last releases, registration failure, an alias group's last release,
//! generation order, and releases of what is not held.
use super::super::baseline::fixture::{alias_pair, TempDir};
use super::super::FileWatcher;
use super::ReleaseOutcome::{self, BackendReleased, KeptRaw, NotHeld, UnclaimedRaw};
use super::fixture::{
    acquire, assert_nothing_left, group_of, holds, home, s, W1, W2,
};
use std::sync::{Arc, Barrier};

/// l: the last two holders release at once from two threads; exactly one
/// release tears the group down. A repeated release of a gone hold is
/// `NotHeld`.
#[test]
fn d173_wi1_l_two_same_window_releases_one_teardown() {
    let _home = home("l");
    let d = TempDir::new("d173l");
    let p = d.file("a.md", b"one");
    let fw = Arc::new(FileWatcher::for_tests());
    let g1 = acquire(&fw, W1, &p);
    let g2 = acquire(&fw, W2, &p);
    let barrier = Arc::new(Barrier::new(2));
    let spawn = |label: &'static str, gen: u64| {
        let (fw, barrier, p) = (Arc::clone(&fw), Arc::clone(&barrier), p.clone());
        std::thread::spawn(move || {
            barrier.wait();
            fw.release_hold(label, &p, gen)
        })
    };
    let (t1, t2) = (spawn(W1, g1), spawn(W2, g2));
    let mut outcomes: Vec<ReleaseOutcome> =
        vec![t1.join().expect("t1"), t2.join().expect("t2")];
    outcomes.sort_by_key(|o| format!("{o:?}"));
    assert_eq!(outcomes, vec![BackendReleased, KeptRaw], "one teardown");
    assert_nothing_left(&fw, &p, "after both");
    assert_eq!(fw.release_hold(W1, &p, g1), NotHeld, "a second release of W1");
}

/// m (row 5): a register whose notify call fails (missing file) still
/// keeps the hold and the list entry; a later acquisition retries.
#[test]
fn d173_wi1_m_registration_failure_keeps_hold() {
    let _home = home("m");
    let d = TempDir::new("d173m");
    let p = d.path().join("missing.md");
    let fw = FileWatcher::for_tests();
    let g1 = acquire(&fw, W1, &p);
    assert_eq!(holds(&fw), vec![(W1.to_string(), p.clone(), g1)], "hold kept");
    assert_eq!(fw.watched(), vec![s(&p)], "the list records it, as legacy");
    std::fs::write(&p, b"now").expect("create");
    let g2 = acquire(&fw, W2, &p);
    assert_eq!(group_of(&fw, &p).map(|(c, _)| c), Some(vec![(p.clone(), 2)]));
    assert_eq!(fw.release_hold(W1, &p, g1), KeptRaw);
    assert_eq!(fw.release_hold(W2, &p, g2), BackendReleased);
    assert_nothing_left(&fw, &p, "after the retry");
}

/// n (row 7b with two spellings): the last release of an alias group
/// clears every spelling from the list and drops the baseline.
#[cfg(unix)]
#[test]
fn d173_wi1_n_alias_group_last_release_clears_everything() {
    let _home = home("n");
    let (_d, real, alias) = alias_pair("d173n");
    let b = real.join("a.md");
    let a = alias.join("a.md");
    std::fs::write(&b, b"one").expect("write");
    let fw = FileWatcher::for_tests();
    let ga = acquire(&fw, W1, &a);
    let gb = acquire(&fw, W2, &b);
    assert_eq!(fw.release_hold(W2, &b, gb), UnclaimedRaw, "canonical first");
    assert_eq!(fw.watched(), vec![s(&a)]);
    assert!(fw.baseline_of(&a).is_some(), "the alias keeps the baseline");
    assert_eq!(fw.release_hold(W1, &a, ga), BackendReleased);
    assert_nothing_left(&fw, &a, "alias group");
    assert_eq!(fw.baseline_of(&b), None);
}

/// o: gens are global, nonzero and strictly increasing across windows and
/// paths, so an older gen can always be told from a newer one.
#[test]
fn d173_wi1_o_gens_are_monotonic_and_nonzero() {
    let _home = home("o");
    let d = TempDir::new("d173o");
    let p = d.file("p.md", b"p");
    let q = d.file("q.md", b"q");
    let fw = FileWatcher::for_tests();
    let gens = [
        acquire(&fw, W1, &p),
        acquire(&fw, W2, &q),
        acquire(&fw, W1, &q),
        acquire(&fw, W1, &p),
    ];
    assert!(gens[0] > 0, "{gens:?}");
    assert!(gens.windows(2).all(|w| w[0] < w[1]), "strictly increasing: {gens:?}");
}

/// q: a release for a window or spelling that holds nothing is `NotHeld`
/// and leaves another window's hold alone.
#[test]
fn d173_wi1_q_release_of_unheld_is_not_held() {
    let _home = home("q");
    let d = TempDir::new("d173q");
    let p = d.file("a.md", b"one");
    let other = d.file("b.md", b"two");
    let fw = FileWatcher::for_tests();
    let g = acquire(&fw, W1, &p);
    assert_eq!(fw.release_hold(W2, &p, g), NotHeld, "W2 never held P");
    assert_eq!(fw.release_hold(W1, &other, g), NotHeld, "W1 never held B");
    assert_eq!(holds(&fw), vec![(W1.to_string(), p.clone(), g)]);
    assert_eq!(fw.watched(), vec![s(&p)]);
}
