//! D173-WI-1: `release_watch_hold` validates what JS sends (rule 60: never
//! trust frontend input) and releases only the calling window's hold. The
//! label is Tauri's, so a window cannot release another window's hold.
use super::release_watch_hold_with;
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::file_watcher::holders::ReleaseOutcome;
use crate::services::file_watcher::FileWatcher;
use std::fs;
use std::path::Path;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn acquire(fw: &FileWatcher, label: &str, p: &Path) -> u64 {
    let r = fw.reserve_hold(label, p).expect("may acquire");
    fw.watch(p);
    fw.confirm_hold(&r);
    r.gen
}

/// v1: every malformed request is an `Err`, and the hold is untouched.
#[test]
fn d173_wi1_v1_invalid_release_requests_are_refused() {
    let home = TempHome::new("d173_wi1_v1");
    let p = home.path().join("a.md");
    fs::write(&p, "a").unwrap();
    let fw = FileWatcher::for_tests();
    let g = acquire(&fw, W1, &p);
    let parent_dir = format!("{}/../{}", s(home.path()), "a.md");
    let wrong_ext = s(&home.path().join("a.exe"));
    let own = s(&p);
    for (path, gen, tag) in [
        ("", g, "empty path"),
        ("a.md", g, "relative path"),
        (parent_dir.as_str(), g, "parent-dir component"),
        (wrong_ext.as_str(), g, "not a document extension"),
        (own.as_str(), 0, "gen 0 is never issued"),
    ] {
        let got = release_watch_hold_with(W1, path, gen, &fw);
        assert!(got.is_err(), "{tag}: {got:?}");
    }
    assert_eq!(fw.holds_for_tests(), vec![(W1.to_string(), p.clone(), g)], "untouched");
    assert_eq!(fw.watched(), vec![s(&p)]);
}

/// v2: a valid release of the caller's own hold releases it.
#[test]
fn d173_wi1_v2_own_hold_is_released() {
    let home = TempHome::new("d173_wi1_v2");
    let p = home.path().join("a.md");
    fs::write(&p, "a").unwrap();
    let fw = FileWatcher::for_tests();
    let g = acquire(&fw, W1, &p);
    assert_eq!(
        release_watch_hold_with(W1, &s(&p), g, &fw),
        Ok(ReleaseOutcome::BackendReleased)
    );
    assert_eq!(fw.holds_for_tests(), vec![]);
    assert_eq!(fw.watched(), Vec::<String>::new());
}

/// v3: another window's label cannot release this window's hold.
#[test]
fn d173_wi1_v3_other_windows_hold_is_not_released() {
    let home = TempHome::new("d173_wi1_v3");
    let p = home.path().join("a.md");
    fs::write(&p, "a").unwrap();
    let fw = FileWatcher::for_tests();
    let g = acquire(&fw, W1, &p);
    assert_eq!(
        release_watch_hold_with(W2, &s(&p), g, &fw),
        Ok(ReleaseOutcome::NotHeld)
    );
    assert_eq!(fw.holds_for_tests(), vec![(W1.to_string(), p.clone(), g)]);
    assert_eq!(fw.watched(), vec![s(&p)]);
}
