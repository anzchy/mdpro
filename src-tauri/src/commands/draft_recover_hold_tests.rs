//! D173-WI-1: a recovered draft's file is held by the window that recovered
//! it (`caller.window_label`), like an open, so that window's close or
//! destruction releases it and another window's does not.
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::file_watcher::FileWatcher;
use crate::services::quit_guard::DraftGate;
use std::fs;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft_recover_watch_fixture.rs"]
mod fx;
use draft_test_home::TempHome;
use fx::{recover, s, seed};

/// r1: recovering a draft with a path holds it for the caller's window
/// (`W`, the fixture's caller), with a nonzero gen, and that hold's release
/// leaves nothing watched.
#[test]
fn d173_wi1_r1_recover_holds_for_the_callers_window() {
    let home = TempHome::new("d173_wi1_r1");
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    seed(&home, "d1", Some(&s(&p)));
    let fw = FileWatcher::for_tests();
    recover(&DraftGate::new(), "d1", &fw).expect("recover");
    let holds = fw.holds_for_tests();
    assert_eq!(holds.len(), 1, "one hold: {holds:?}");
    let (label, raw, gen) = holds[0].clone();
    assert_eq!((label.as_str(), raw.as_path()), ("W", p.as_path()));
    assert!(gen > 0);
    fw.release_hold("W", &p, gen);
    assert_eq!(fw.watched(), Vec::<String>::new(), "the window's release unwatches");
}

/// r2: a draft without a path takes no hold.
#[test]
fn d173_wi1_r2_recover_without_path_holds_nothing() {
    let home = TempHome::new("d173_wi1_r2");
    seed(&home, "d1", None);
    let fw = FileWatcher::for_tests();
    recover(&DraftGate::new(), "d1", &fw).expect("recover");
    assert_eq!(fw.holds_for_tests(), vec![]);
    assert_eq!(fw.watched(), Vec::<String>::new());
}

/// r3: the recover reply carries the gen of the hold it confirmed, so the
/// frontend can release that hold with it.
#[test]
fn d173_wi1_r3_recover_reply_carries_the_hold_gen() {
    let home = TempHome::new("d173_wi1_r3");
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    seed(&home, "d1", Some(&s(&p)));
    let fw = FileWatcher::for_tests();
    let r = recover(&DraftGate::new(), "d1", &fw).expect("recover");
    assert!(r.hold_gen > 0, "the reply carries a gen: {}", r.hold_gen);
    let holds = fw.holds_for_tests();
    assert_eq!(holds.iter().map(|h| h.2).collect::<Vec<_>>(), vec![r.hold_gen]);
}
