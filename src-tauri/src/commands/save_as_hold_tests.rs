//! D173 audit fixes M1 and M2 (folded into commit 2): a Save As must never
//! cost the window a hold it already had, and a Save As from a fenced window
//! must leave nothing watched. Driven through `save_as_held_with`, the
//! dialog's steps after the pick (save_as_watch.rs), with a real
//! `FileWatcher::for_tests()`, real files and the real save. macOS only, for
//! the save fixture's `Dir`.
//! - M1: window W holds P (tab T open on P) and runs a Save As onto P that
//!   fails. Today the `Err` arm releases with the NEW gen the duplicate
//!   reservation issued, which drops T's hold; at count 0 the watch and the
//!   baseline are torn down and T misses external edits.
//! - M2: `reserve_hold` returns `None` for a fenced (destroyed) window, but
//!   the watching save still runs `watch_seeded` and nothing tears it down.
use super::save_as_held_with;
use crate::commands::file_save_fixture::{chmod, ev, Dir, CONTENT};
use crate::services::file_watcher::{FileWatcher, WatchOutcome};
use std::path::Path;

const W: &str = "mdpro-w1";

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// What the open commands do: reserve, the legacy register, confirm.
fn acquire(fw: &FileWatcher, label: &str, p: &Path) -> u64 {
    let r = fw
        .reserve_hold(label, p)
        .unwrap_or_else(|| panic!("{label} may acquire {p:?}"));
    fw.watch(p);
    assert!(fw.confirm_hold(&r), "{label}: the hold on {p:?} is current");
    r.gen
}

async fn save_as(fw: &FileWatcher, label: &str, picked: &Path, content: &str) -> bool {
    save_as_held_with(
        label,
        "doc-t2".into(),
        content.into(),
        s(picked),
        None,
        None,
        None,
        fw,
    )
    .await
    .is_ok()
}

#[tokio::test]
async fn d173_m1_failed_save_as_onto_a_held_path_keeps_the_tabs_hold() {
    let d = Dir::new("d173_m1");
    let p = d.file("doc.md", b"alpha\n");
    let fw = FileWatcher::for_tests();
    let g1 = acquire(&fw, W, &p);
    let baseline = fw.baseline_of(&p);
    assert!(baseline.is_some(), "precondition: T's baseline");

    chmod(d.path(), 0o500);
    let ok = save_as(&fw, W, &p, "the Save As bytes\n").await;
    chmod(d.path(), 0o700);
    assert!(
        !ok,
        "precondition: the Save As write fails in a read-only dir"
    );

    assert_eq!(
        fw.holds_for_tests(),
        vec![(W.to_string(), p.clone(), g1)],
        "W still holds P with T's original gen"
    );
    assert_eq!(fw.watched(), vec![s(&p)], "P is still watched");
    assert_eq!(fw.baseline_of(&p), baseline, "T's baseline is kept");
    std::fs::write(&p, b"an external edit\n").expect("external write");
    assert_eq!(
        fw.route_for_tests(&ev(CONTENT, &p)).1,
        WatchOutcome::EmittedModified,
        "T hears the external write"
    );
}

/// M1's guard: a failed Save As onto a path the window did not hold before
/// still releases its reservation and leaves nothing (D173-WI-1 j).
#[tokio::test]
async fn d173_m1_guard_failed_save_as_onto_an_unheld_path_leaves_nothing() {
    let d = Dir::new("d173_m1g");
    let p = d.path().join("picked.md");
    let fw = FileWatcher::for_tests();

    chmod(d.path(), 0o500);
    let ok = save_as(&fw, W, &p, "bytes\n").await;
    chmod(d.path(), 0o700);
    assert!(!ok, "precondition: the write fails");

    assert_eq!(fw.holds_for_tests(), vec![], "no hold left");
    assert_eq!(fw.watched(), Vec::<String>::new(), "nothing watched");
    assert_eq!(fw.baseline_of(&p), None, "no baseline");
}

#[tokio::test]
async fn d173_m2_save_as_from_a_fenced_window_leaves_no_watch() {
    let d = Dir::new("d173_m2");
    let target = d.path().join("target.md");
    let fw = FileWatcher::for_tests();
    fw.release_window(W);
    assert!(
        fw.reserve_hold(W, &target).is_none(),
        "precondition: W is fenced"
    );

    save_as(&fw, W, &target, "bytes\n").await;

    assert_eq!(fw.holds_for_tests(), vec![], "no hold");
    assert_eq!(
        fw.watched(),
        Vec::<String>::new(),
        "a fenced window's Save As registers no watch"
    );
    assert_eq!(fw.baseline_of(&target), None, "and stores no baseline");
}
