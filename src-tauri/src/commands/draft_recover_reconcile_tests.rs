//! D173-WI-4 (plan r2 §5): D59 recovery's snapshot register reconciles like
//! an open. Window A holds P seeded with S1; an external write lands and its
//! event has not routed; recovering a draft of P (`watch`, a fresh snapshot
//! S2, through `recover_draft_watched_with` for the fixture's window `W`)
//! replaces the shared baseline, so every held spelling of P gets one plain
//! `file:changed` `modified` with no `origin`.
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::file_watcher::seed::read_for_open;
use crate::services::file_watcher::FileWatcher;
use crate::services::quit_guard::DraftGate;
use std::fs;
use std::path::Path;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft_recover_watch_fixture.rs"]
mod fx;
use draft_test_home::TempHome;
use fx::{recover, s, seed};

const A: &str = "mdpro-a";

/// What `open_file` does for window `label`: reserve, `watch_seeded` with
/// its own read's entry, confirm.
fn open(fw: &FileWatcher, label: &str, p: &Path) {
    let (_, entry) = read_for_open(p).expect("the open reads the file");
    let r = fw.reserve_hold(label, p).expect("may acquire");
    fw.watch_seeded(p, entry);
    assert!(fw.confirm_hold(&r), "{label}: the hold is current");
}

/// `d173_wi4_d`: recovery's snapshot register into A's live group, after an
/// unrouted external write, sends P's held spelling one reconcile notice.
#[test]
fn d173_wi4_d_recovery_snapshot_reconciles() {
    let home = TempHome::new("d173_wi4_d");
    let p = home.path().join("a.md");
    fs::write(&p, "alpha\n").unwrap();
    seed(&home, "d1", Some(&s(&p)));
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, A, &p);
    assert!(
        rec.sent_plain().is_empty(),
        "precondition: the first holder is not told"
    );

    fs::write(&p, "external beta write\n").unwrap();
    let r = recover(&DraftGate::new(), "d1", &fw).expect("recover");
    assert!(r.hold_gen > 0, "precondition: the recovery took a hold");

    let plain: Vec<String> = rec.sent_plain().into_iter().map(|e| e.path).collect();
    assert_eq!(
        plain,
        vec![s(&p)],
        "the recovery's snapshot replaced a diverged baseline: one reconcile notice for P"
    );
    assert!(
        rec.sent_plain()
            .iter()
            .all(|e| e.change_type == "modified" && e.new_path.is_none()),
        "{:?}",
        rec.sent_plain()
    );
    assert!(
        rec.sent().is_empty(),
        "no origin-carrying notice: {:?}",
        rec.sent()
    );
}

/// `d173_wi4_d2`: the same recovery with no write in between finds the same
/// hash and sends nothing.
#[test]
fn d173_wi4_d2_recovery_without_divergence_is_silent() {
    let home = TempHome::new("d173_wi4_d2");
    let p = home.path().join("a.md");
    fs::write(&p, "alpha\n").unwrap();
    seed(&home, "d1", Some(&s(&p)));
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, A, &p);
    recover(&DraftGate::new(), "d1", &fw).expect("recover");
    assert!(rec.sent_plain().is_empty(), "{:?}", rec.sent_plain());
}
