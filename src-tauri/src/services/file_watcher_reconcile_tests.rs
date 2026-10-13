//! D173-WI-4 (plan r2 §5; ADR-0086 decision 6; Codex review BLOCK 1): a
//! register into a live group overwrites the shared baseline, so an unrouted
//! external write before it is absorbed (its event routes `IgnoredUnchanged`).
//! The acquisition compares the prior hash with the stored one; on a
//! difference or an unknown hash every held spelling gets one plain
//! `file:changed` `modified` with NO `origin`. Real files, a real
//! `for_tests_noticed()` watcher and the commands' acquisition (`reserve_hold`
//! → `watch_seeded` / `watch` → `confirm_hold`); the sink is the only double.
//! macOS only, for the save fixture's `Dir` and the `/var` alias.
use super::super::baseline::fixture::{h, shift_mtime};
use super::super::seed::{read_for_open, Entry, SeedCheck};
use super::super::test_support::NoticeRecorder;
use super::super::{FileWatcher, WatchOutcome};
use crate::commands::file_save_fixture::{canon, ev, Dir, CONTENT};
use std::fs;
use std::path::Path;

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// What `open_file` does; returns the seed check its reply would carry.
fn open(fw: &FileWatcher, label: &str, p: &Path) -> SeedCheck {
    let (_, seed) = read_for_open(p).expect("the open reads the file");
    open_with(fw, label, p, seed)
}

/// `open`, storing `seed` (e.g. an over-cap read's seed, which has no hash).
fn open_with(fw: &FileWatcher, label: &str, p: &Path, seed: Entry) -> SeedCheck {
    let r = fw
        .reserve_hold(label, p)
        .unwrap_or_else(|| panic!("{label} may acquire {p:?}"));
    let check = fw.watch_seeded(p, seed);
    assert!(fw.confirm_hold(&r), "{label}: the hold on {p:?} is current");
    check
}

/// The reconcile notices' paths, sorted.
fn plain_paths(rec: &NoticeRecorder) -> Vec<String> {
    let mut out: Vec<String> = rec.sent_plain().into_iter().map(|e| e.path).collect();
    out.sort();
    out
}

/// Every reconcile notice is a plain `modified`, none carrying an origin.
fn assert_plain_modified(rec: &NoticeRecorder, tag: &str) {
    for e in rec.sent_plain() {
        assert_eq!(e.change_type, "modified", "{tag}: {e:?}");
        assert_eq!(e.new_path, None, "{tag}: {e:?}");
        let wire = serde_json::to_value(&e).expect("serialise");
        assert!(wire.get("origin").is_none(), "{tag}: no origin: {wire}");
    }
    assert!(
        rec.sent().is_empty(),
        "{tag}: a reconcile notice carries no origin, so it never goes out as a save notice: {:?}",
        rec.sent()
    );
}

/// `d173_wi4_a` (the registered regression, BLOCK 1): A holds P seeded with
/// S1. An external write lands and its event has not routed. B opens P,
/// reads S2 and registers, replacing the baseline with S2. The delayed event
/// now routes `IgnoredUnchanged`, so only the reconcile notice tells A.
#[test]
fn d173_wi4_a_second_open_after_unrouted_write_notifies_existing() {
    let d = Dir::new("d173_wi4_a");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    assert_eq!(fw.baseline_of(&p).and_then(|e| e.hash), h(b"alpha\n"));
    assert!(
        rec.sent_plain().is_empty(),
        "precondition: the first holder is not told"
    );

    fs::write(&p, b"external beta write\n").expect("the external write");
    open(&fw, W2, &p);
    assert_eq!(
        fw.baseline_of(&p).and_then(|e| e.hash),
        h(b"external beta write\n"),
        "precondition: B's register replaced the shared baseline with S2"
    );

    assert_eq!(
        plain_paths(&rec),
        vec![s(&p)],
        "B's register replaced a baseline whose hash differs, so P's held spelling gets one reconcile notice"
    );
    assert_plain_modified(&rec, "a");
    assert_eq!(
        fw.route_for_tests(&ev(CONTENT, &canon(&p))).1,
        WatchOutcome::IgnoredUnchanged,
        "the delayed event is absorbed by the new baseline: the notice is the only delivery"
    );
}

/// `d173_wi4_b`: the same hash, so no reconcile notice, even when only the
/// mtime moved (hash, not stat: the same bytes have nothing to reload).
#[test]
fn d173_wi4_b_no_divergence_no_notice() {
    let d = Dir::new("d173_wi4_b");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    open(&fw, W2, &p);
    assert!(
        rec.sent_plain().is_empty(),
        "same bytes: {:?}",
        rec.sent_plain()
    );

    shift_mtime(&p, 7);
    open(&fw, W1, &p);
    assert!(
        rec.sent_plain().is_empty(),
        "an mtime-only change is not a divergence: {:?}",
        rec.sent_plain()
    );
    assert!(rec.sent().is_empty());
}

/// `d173_wi4_c` (fail-open): an unknown hash on either side counts as
/// diverged (ADR-0068: unknown never compares equal). The prior entry has no
/// hash (an over-cap open's seed), or the stored one has none.
#[test]
fn d173_wi4_c_prior_without_hash_notifies() {
    let d = Dir::new("d173_wi4_c");
    let p = d.file("doc.md", b"alpha\n");
    let (_, real) = read_for_open(&p).expect("read");
    let unknown = Entry {
        stat: real.stat,
        hash: None,
    };

    let (fw, rec) = FileWatcher::for_tests_noticed();
    open_with(&fw, W1, &p, unknown);
    assert!(
        rec.sent_plain().is_empty(),
        "precondition: the first holder is not told"
    );
    open(&fw, W2, &p);
    assert_eq!(
        plain_paths(&rec),
        vec![s(&p)],
        "prior entry without a hash: unknown is diverged"
    );
    assert_plain_modified(&rec, "c prior unknown");

    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    open_with(&fw, W2, &p, unknown);
    assert_eq!(
        plain_paths(&rec),
        vec![s(&p)],
        "stored entry without a hash: unknown is diverged"
    );
    assert_plain_modified(&rec, "c stored unknown");
}

/// `d173_wi4_c2` (fail-open): P is deleted unrouted; a snapshot register
/// (`watch`, as recovery runs) stores no hash, which is a divergence.
#[test]
fn d173_wi4_c2_missing_file_snapshot_notifies() {
    let d = Dir::new("d173_wi4_c2");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    fs::remove_file(&p).expect("the external delete");

    let r = fw.reserve_hold(W2, &p).expect("W2 may acquire");
    fw.watch(&p);
    assert!(fw.confirm_hold(&r));
    assert_eq!(
        fw.baseline_of(&p).and_then(|e| e.hash),
        None,
        "precondition: the snapshot of a missing file has no hash"
    );
    assert_eq!(
        plain_paths(&rec),
        vec![s(&p)],
        "missing file: unknown is diverged"
    );
    assert_plain_modified(&rec, "c2");
}

/// `d173_wi4_e`: a duplicate hold (row 2) reconciles too: the window's
/// other tabs on P were never told of the write.
#[test]
fn d173_wi4_e_duplicate_same_window_reconciles() {
    let d = Dir::new("d173_wi4_e");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    fs::write(&p, b"external beta write\n").expect("the external write");
    open(&fw, W1, &p);
    assert_eq!(
        plain_paths(&rec),
        vec![s(&p)],
        "a duplicate hold reconciles"
    );
    assert_plain_modified(&rec, "e");
}

/// `d173_wi4_f`: a first holder (no prior baseline) never reconciles, on a
/// fresh file or after the group was fully released.
#[test]
fn d173_wi4_f_first_holder_never_reconciles() {
    let d = Dir::new("d173_wi4_f");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    assert!(
        rec.sent_plain().is_empty(),
        "fresh first holder: {:?}",
        rec.sent_plain()
    );

    let gen = fw
        .holds_for_tests()
        .first()
        .map(|h| h.2)
        .expect("W1's hold");
    fw.release_hold(W1, &p, gen);
    assert_eq!(
        fw.baseline_of(&p),
        None,
        "precondition: the group's baseline went"
    );
    fs::write(&p, b"external beta write\n").expect("the external write");
    open(&fw, W2, &p);
    assert!(
        rec.sent_plain().is_empty(),
        "a first holder after a full release has no prior entry: {:?}",
        rec.sent_plain()
    );

    // The non-vacuity half: the same flow with W1 still holding does notify.
    fs::write(&p, b"external gamma write, longer\n").expect("the second write");
    open(&fw, W1, &p);
    assert_eq!(plain_paths(&rec), vec![s(&p)], "a live group reconciles");
}

/// `d173_wi4_g`: an additional spelling (row 4) notifies every held
/// spelling, each once: A holds the `/var/…` alias, B opens the canonical
/// `/private/var/…` spelling after an unrouted write.
#[test]
fn d173_wi4_g_additional_spelling_notifies_every_spelling() {
    let d = Dir::new("d173_wi4_g");
    let p = d.file("doc.md", b"alpha\n");
    let c = canon(&p);
    assert_ne!(s(&p), s(&c), "precondition: the temp dir is an alias");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    open(&fw, W2, &p);
    fs::write(&p, b"external beta write\n").expect("the external write");
    open(&fw, W2, &c);

    let mut want = vec![s(&p), s(&c)];
    want.sort();
    assert_eq!(
        plain_paths(&rec),
        want,
        "one reconcile notice per distinct held spelling, the shared raw one not twice"
    );
    assert_plain_modified(&rec, "g");
}

/// `d173_wi4_h`: the reconcile leaves the D111 seed check alone. B's open
/// still reports what its own read found (`Unchanged`: the disk is S2), and
/// a write after B's read still reports `Changed`.
#[test]
fn d173_wi4_h_seed_check_unchanged_by_reconcile() {
    let d = Dir::new("d173_wi4_h");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, W1, &p);
    fs::write(&p, b"external beta write\n").expect("the external write");
    assert_eq!(
        open(&fw, W2, &p),
        SeedCheck::Unchanged,
        "B's seed is the disk"
    );

    let (_, stale) = read_for_open(&p).expect("read");
    fs::write(&p, b"a third write after the read\n").expect("the late write");
    assert_eq!(
        open_with(&fw, W1, &p, stale),
        SeedCheck::Changed,
        "D111 as before"
    );
    assert_eq!(
        rec.sent_plain().len(),
        1,
        "only B's register replaced a diverged baseline (W1's stale seed is S2's bytes): {:?}",
        rec.sent_plain()
    );
}
