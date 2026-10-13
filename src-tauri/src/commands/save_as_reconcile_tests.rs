//! D173-WI-4, the Save As false prompt (found while implementing commit 3):
//! a Save As onto a path another window holds is an acquisition, so its
//! `confirm_hold` runs the second-holder reconcile. The Save As register
//! stores the written bytes, which differ from the holder's baseline, so the
//! reconcile sends an origin-less `file:changed`. With no `origin`, the
//! saving window's own document records it after capture replay and prompts
//! for its own write. The save notice (with `origin`) already tells the
//! other holders, so the Save As must send NO plain notice.
//!
//! Driven through `save_as_held_with`, the dialog's steps after the pick
//! (save_as_watch.rs), with a real `FileWatcher::for_tests_noticed()`, real
//! files and the real save; the sink is the only double. macOS only, for the
//! save fixture's `Dir`.
use super::save_as_held_with;
use crate::commands::file_save_fixture::Dir;
use crate::services::file_watcher::seed::read_for_open;
use crate::services::file_watcher::FileWatcher;
use std::fs;
use std::path::Path;

const A: &str = "mdpro-wa";
const B: &str = "mdpro-wb";

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// What `open_file` does for window `label`: reserve, `watch_seeded` with
/// its own read's entry, confirm.
fn open(fw: &FileWatcher, label: &str, p: &Path) {
    let (_, entry) = read_for_open(p).expect("the open reads the file");
    let r = fw
        .reserve_hold(label, p)
        .unwrap_or_else(|| panic!("{label} may acquire {p:?}"));
    fw.watch_seeded(p, entry);
    assert!(fw.confirm_hold(&r), "{label}: the hold on {p:?} is current");
}

/// `d173_wi4_sa`: B holds P with baseline S1; A's Save As writes new bytes
/// onto P. B is told by the origin-carrying save notice, and nothing goes
/// out without an origin.
#[tokio::test]
async fn d173_wi4_sa_save_as_onto_held_path_sends_no_plain_notice() {
    let d = Dir::new("d173_wi4_sa");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, B, &p);
    assert!(
        fw.baseline_of(&p).is_some(),
        "precondition: B's baseline S1"
    );
    assert!(rec.sent_plain().is_empty(), "precondition: no notice yet");

    let saved = save_as_held_with(
        A,
        "doc-a".into(),
        "the Save As bytes, different from S1\n".into(),
        s(&p),
        None,
        None,
        None,
        &fw,
    )
    .await;
    assert!(
        matches!(saved, Ok(Some(_))),
        "precondition: the Save As wrote: {saved:?}"
    );

    let notices = rec.sent();
    assert!(
        notices.iter().any(|n| n.event.path == s(&p)
            && n.origin.window_label == A
            && n.origin.document_id == "doc-a"),
        "the origin-carrying save notice still reaches P's held spelling: {notices:?}"
    );
    assert!(
        rec.sent_plain().is_empty(),
        "a Save As sends no origin-less reconcile notice (it would prompt the saver for its own write): {:?}",
        rec.sent_plain()
    );
}

/// `d173_wi4_sa_guard`: an open by A of P held by B, after an unrouted
/// external write, still reconciles: one plain notice for P.
#[test]
fn d173_wi4_sa_guard_open_after_unrouted_write_still_reconciles() {
    let d = Dir::new("d173_wi4_sa_guard");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    open(&fw, B, &p);
    fs::write(&p, b"external beta write\n").expect("the external write");
    open(&fw, A, &p);

    let plain: Vec<String> = rec.sent_plain().into_iter().map(|e| e.path).collect();
    assert_eq!(plain, vec![s(&p)], "the open reconciles");
    assert!(
        rec.sent().is_empty(),
        "no origin-carrying notice: {:?}",
        rec.sent()
    );
}
