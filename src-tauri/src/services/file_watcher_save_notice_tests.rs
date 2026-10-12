//! D173-WI-2 (plan r2 §4, commit 2; ADR-0086 decision 4): a save tells every
//! other holder of the written file. Real files, a real
//! `FileWatcher::for_tests_noticed()` (real notify watcher, recording sink),
//! the real holders (`reserve_hold` → `watch` → `confirm_hold`) and the real
//! save (`save_file_with`, `save_as_watched_with`). The only double is the
//! notice sink, the Tauri boundary. macOS only, for the save fixture's `Dir`
//! (it isolates `$HOME`, where the save and the watcher log).
//!
//! Spelling identity: a hold is keyed by its raw spelling, the group by the
//! canonical file. The temp dir is a non-canonical spelling on macOS
//! (`/var/…` → `/private/var/…`), so `p` and `canon(p)` are two spellings of
//! one group.
use super::super::test_support::NoticeRecorder;
use super::super::{FileWatcher, WatchOutcome};
use super::SaveOrigin;
use crate::commands::file_save_fixture::{canon, ev, save, Dir};
use crate::commands::save_as_watch::save_as_watched_with;
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::Value;
use std::path::Path;

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";
const W3: &str = "mdpro-w3";

/// The two shapes FSEvents gives a save's rename onto the watched path (D101).
const REPLACED: [EventKind; 2] = [
    EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
    EventKind::Create(CreateKind::File),
];

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn origin(label: &str, doc: &str) -> SaveOrigin {
    SaveOrigin {
        window_label: label.into(),
        document_id: doc.into(),
    }
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

/// The notices' paths, sorted.
fn paths(rec: &NoticeRecorder) -> Vec<String> {
    let mut out: Vec<String> = rec.sent().into_iter().map(|n| n.event.path).collect();
    out.sort();
    out
}

fn ctx(line: &LogEntryPayload) -> &Value {
    line.context
        .as_ref()
        .expect("the notice line has a context")
}

/// `d173_wi2_a` (the registered regression): two windows hold one file; A
/// saves. B is told, by a notice carrying A's origin, and the save's own
/// notify event still routes `IgnoredUnchanged` (D101 unchanged: the notice,
/// not the route, tells the other holders).
#[tokio::test]
async fn d173_wi2_a_save_notifies_the_other_window_and_own_event_stays_unchanged() {
    let d = Dir::new("d173_wi2_a");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &p);
    acquire(&fw, W2, &p);

    let saved = save(&p, "beta beta\n", fw.baselines())
        .await
        .expect("the save succeeds");
    let line = fw.notice_saved(&origin(W1, "doc-a"), &saved.path, &canon(&p), Some("act-a"));

    let sent = rec.sent();
    assert_eq!(
        sent.len(),
        1,
        "one notice for the one held spelling: {sent:?}"
    );
    assert_eq!(sent[0].event.path, s(&p), "at the spelling B holds");
    assert_eq!(sent[0].event.change_type, "modified");
    assert_eq!(sent[0].event.new_path, None);
    assert_eq!(sent[0].origin, origin(W1, "doc-a"), "carrying the saver");

    assert_eq!(line.event, "file.save.notice");
    assert_eq!(line.level, LogLevel::Info);
    assert_eq!(line.status, LogStatus::Success);
    assert_eq!(line.action_id.as_deref(), Some("act-a"));
    assert_eq!(ctx(&line)["spellings"], 1);
    assert_eq!(ctx(&line)["emitted"], 1);
    assert_eq!(ctx(&line)["failed"], 0);

    let c = canon(&p);
    for kind in REPLACED {
        assert_eq!(
            fw.route_for_tests(&ev(kind, &c)).1,
            WatchOutcome::IgnoredUnchanged,
            "{kind:?}: the save's own event still never prompts"
        );
    }
}

/// `d173_wi2_a2`: one notice per distinct held spelling. Two windows on one
/// raw spelling give one; a third window on the canonical alias adds one.
#[tokio::test]
async fn d173_wi2_a2_one_notice_per_distinct_held_spelling() {
    let d = Dir::new("d173_wi2_a2");
    let p = d.file("doc.md", b"alpha\n");
    let c = canon(&p);
    assert_ne!(s(&p), s(&c), "precondition: the temp dir is an alias");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &p);
    acquire(&fw, W2, &p);
    acquire(&fw, W3, &c);

    let saved = save(&p, "beta\n", fw.baselines()).await.expect("save");
    let line = fw.notice_saved(&origin(W1, "doc-a"), &saved.path, &c, None);

    let mut want = vec![s(&p), s(&c)];
    want.sort();
    assert_eq!(
        paths(&rec),
        want,
        "each spelling once, the raw one not twice"
    );
    assert!(
        rec.sent().iter().all(|n| n.origin == origin(W1, "doc-a")),
        "every notice carries the saver"
    );
    assert_eq!(ctx(&line)["spellings"], 2);
    assert_eq!(ctx(&line)["emitted"], 2);
}

/// `d173_wi2_j`: the consumer spellings of a group are every raw spelling
/// any window holds in it, each once, read by the group key.
#[tokio::test]
async fn d173_wi2_j_consumer_spellings_are_the_groups_held_spellings() {
    let d = Dir::new("d173_wi2_j");
    let p = d.file("doc.md", b"alpha\n");
    let other = d.file("other.md", b"other\n");
    let c = canon(&p);
    let (fw, _rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &p);
    acquire(&fw, W2, &p);
    acquire(&fw, W2, &c);
    acquire(&fw, W1, &other);

    let mut got = fw.consumer_spellings(&c);
    got.sort();
    let mut want = vec![s(&p), s(&c)];
    want.sort();
    assert_eq!(got, want, "the group's spellings, not other.md's");
}

/// `d173_wi2_d`: the notice goes to the group of the target the save
/// resolved, never re-canonicalised. The saved spelling is a symlink that is
/// retargeted between the write and the notice: the notice still reaches
/// the written file's holder, and not the holder of the symlink's new target.
#[tokio::test]
async fn d173_wi2_d_uses_written_target_not_returned_path() {
    let d = Dir::new("d173_wi2_d");
    let x = d.file("x.md", b"x\n");
    let y = d.file("y.md", b"y\n");
    let link = d.path().join("link.md");
    std::os::unix::fs::symlink(&x, &link).expect("symlink");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W2, &canon(&x));
    acquire(&fw, W3, &canon(&y));

    let saved = save(&link, "written to x\n", fw.baselines())
        .await
        .expect("save");
    let written_to = canon(&x);
    std::fs::remove_file(&link).expect("unlink");
    std::os::unix::fs::symlink(&y, &link).expect("retarget the symlink to y");

    fw.notice_saved(&origin(W1, "doc-l"), &saved.path, &written_to, None);

    let got = paths(&rec);
    assert!(
        got.contains(&s(&canon(&x))),
        "the written file's holder is told: {got:?}"
    );
    assert!(
        !got.contains(&s(&canon(&y))),
        "the symlink's new target is not: {got:?}"
    );
}

/// `d173_wi2_e`: a failed emit is logged at error level with the path and
/// the spelling count, is not retried, and the save stays a success.
#[tokio::test]
async fn d173_wi2_e_emit_failure_logged_save_ok() {
    let d = Dir::new("d173_wi2_e");
    let p = d.file("doc.md", b"alpha\n");
    let c = canon(&p);
    let (fw, rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W2, &p);
    acquire(&fw, W3, &c);
    rec.refuse();

    let saved = save(&p, "beta\n", fw.baselines()).await;
    let saved = saved.expect("the write itself succeeds");
    let line = fw.notice_saved(&origin(W1, "doc-a"), &saved.path, &c, Some("act-e"));

    assert_eq!(rec.sent().len(), 2, "one attempt per spelling, no retry");
    assert_eq!(line.event, "file.save.notice");
    assert_eq!(line.level, LogLevel::Error);
    assert_eq!(line.status, LogStatus::Fail);
    assert_eq!(line.action_id.as_deref(), Some("act-e"));
    assert_eq!(ctx(&line)["filePath"], s(&p), "the line names the path");
    assert_eq!(ctx(&line)["spellings"], 2, "and the spelling count");
    assert_eq!(ctx(&line)["emitted"], 0);
    assert_eq!(ctx(&line)["failed"], 2);
    assert!(
        line.error
            .as_deref()
            .is_some_and(|e| e.contains("emit refused")),
        "the first emit error is kept: {:?}",
        line.error
    );
    assert!(saved.success, "the save result is still a success");
    assert_eq!(std::fs::read(&p).expect("read back"), b"beta\n");
}

/// `d173_wi2_f` (guard): a failed write never reaches the notice. The save
/// returns `Err` and nothing is handed to the sink; the command-level
/// "notice only after Ok" is pinned by the wiring tripwire w1.
#[tokio::test]
async fn d173_wi2_f_failed_write_emits_nothing() {
    let d = Dir::new("d173_wi2_f");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W2, &p);
    crate::commands::file_save_fixture::chmod(d.path(), 0o500);

    let res = save(&p, "beta\n", fw.baselines()).await;
    crate::commands::file_save_fixture::chmod(d.path(), 0o700);
    assert!(res.is_err(), "the write fails in a read-only dir: {res:?}");
    assert!(rec.sent().is_empty(), "no notice for a failed write");
}

/// `d173_wi2_g`: Save As onto a path another window holds tells it, at
/// every spelling held (here B holds the canonical alias of the picked
/// path), with the saver as origin.
#[tokio::test]
async fn d173_wi2_g_save_as_notice_reaches_target_holders() {
    let d = Dir::new("d173_wi2_g");
    let t = d.file("target.md", b"theirs\n");
    let c = canon(&t);
    let (fw, rec) = FileWatcher::for_tests_noticed();
    acquire(&fw, W2, &c);

    let hold = fw.reserve_hold(W1, &t).expect("W1 may acquire the target");
    let saved = save_as_watched_with(
        "doc-a".into(),
        "mine\n".into(),
        s(&t),
        None,
        None,
        None,
        &fw,
    )
    .await
    .expect("Save As succeeds");
    assert!(fw.confirm_hold(&hold));
    fw.notice_saved(&origin(W1, "doc-a"), &saved.path, &c, None);

    let got = paths(&rec);
    assert!(got.contains(&s(&c)), "B's spelling is told: {got:?}");
    assert!(
        rec.sent().iter().all(|n| n.origin == origin(W1, "doc-a")),
        "with A as origin"
    );
}

/// `d173_wi2_h`: a save of a path nobody holds still notices the spelling
/// the save was given (another window may be opening it: its capture holds
/// the event).
#[tokio::test]
async fn d173_wi2_h_unheld_path_still_notices_given_spelling() {
    let d = Dir::new("d173_wi2_h");
    let p = d.file("doc.md", b"alpha\n");
    let (fw, rec) = FileWatcher::for_tests_noticed();

    let saved = save(&p, "beta\n", fw.baselines()).await.expect("save");
    fw.notice_saved(&origin(W1, "doc-a"), &saved.path, &canon(&p), None);

    assert_eq!(paths(&rec), vec![s(&p)]);
}
