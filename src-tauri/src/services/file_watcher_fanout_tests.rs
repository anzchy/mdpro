//! D185-WI-2 (plan §2-§4, delegator rulings 2026-10-14): one routed event
//! becomes one `file:changed` per recipient. Recipients are every HELD
//! spelling of the event's canonical group plus the event's own path,
//! de-duplicated by exact string, all with the one timestamp and change type.
//!
//! Real files, a real `FileWatcher::for_tests_noticed()`, the real holds
//! (`reserve_hold` → `watch` → `confirm_hold`) and the production
//! `handle_event` (route, log, emit). The only double is the watcher's
//! `NoticeSink`, the Tauri boundary. macOS only, for the save fixture's `Dir`
//! (it isolates `$HOME`, where the watcher logs). Mounted here: rename,
//! remove and release (file_watcher_fanout_lifecycle_tests.rs), the
//! `file.watch.fanout` line (file_watcher_fanout_log_tests.rs) and the live
//! FSEvents case (file_watcher_fanout_live_tests.rs).
//!
//! Spellings: the temp dir is `/var/…`, so `raw` (`D/real/doc.md`), `alias`
//! (`D/alias/doc.md`, through a directory symlink) and `canonical`
//! (`/private/var/…/real/doc.md`, what FSEvents reports) are three strings
//! of one file.
use super::super::baseline::fixture::{append, ev, CONTENT};
use super::super::save_notice::{NoticeSink, SaveNotice, SaveOrigin};
use super::super::test_support::NoticeRecorder;
use super::super::{handle_event, mark_write_end, mark_write_start};
use super::super::{FileChangedEvent, FileWatcher};
use super::EventSink;
use crate::commands::file_save_fixture::{canon, save, Dir};
use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::{Event, EventKind};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";
const W3: &str = "mdpro-w3";
const EXTERNAL: &[u8] = b"an external edit\n";

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Three spellings of one written file.
struct Spellings {
    raw: PathBuf,
    alias: PathBuf,
    canonical: PathBuf,
}

fn spellings(d: &Dir) -> Spellings {
    let real = d.path().join("real");
    std::fs::create_dir(&real).expect("create real dir");
    std::os::unix::fs::symlink(&real, d.path().join("alias")).expect("symlink alias -> real");
    let raw = real.join("doc.md");
    std::fs::write(&raw, b"alpha\n").expect("write");
    let f = Spellings {
        alias: d.path().join("alias").join("doc.md"),
        canonical: canon(&raw),
        raw,
    };
    let distinct: std::collections::BTreeSet<_> = [&f.raw, &f.alias, &f.canonical]
        .iter()
        .map(|p| s(p))
        .collect();
    assert_eq!(distinct.len(), 3, "precondition: three strings, one file");
    f
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

/// The callback's sink over `fw`'s holders, emitting into `notices`.
fn sink_over(fw: &FileWatcher, notices: Arc<dyn NoticeSink>) -> EventSink {
    EventSink {
        notices,
        holders: fw.holders.leaf(),
    }
}

/// Run `event` through the production `handle_event` (fresh debounce map)
/// and return every `file:changed` the watcher emitted for it.
fn deliver(fw: &FileWatcher, event: Event) -> Vec<FileChangedEvent> {
    let rec = Arc::new(NoticeRecorder::default());
    let sink = sink_over(fw, Arc::clone(&rec) as _);
    handle_event(&sink, event, &Arc::default(), fw.baselines());
    assert!(rec.sent().is_empty(), "the watcher never sends an origin");
    rec.sent_plain()
}

fn paths(sent: &[FileChangedEvent]) -> Vec<String> {
    let mut out: Vec<String> = sent.iter().map(|e| e.path.clone()).collect();
    out.sort();
    out
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

/// Every copy carries one timestamp, `change_type` and `new_path`.
fn assert_copies(sent: &[FileChangedEvent], change_type: &str, new_path: Option<&str>) {
    assert!(!sent.is_empty(), "non-vacuity: something was emitted");
    for e in sent {
        assert_eq!(e.timestamp, sent[0].timestamp, "one timestamp: {sent:?}");
        assert_eq!(e.change_type, change_type, "{sent:?}");
        assert_eq!(e.new_path.as_deref(), new_path, "{sent:?}");
    }
}

/// An external append to the file, as FSEvents reports it (real path).
fn external_modify(f: &Spellings) -> Event {
    append(&f.canonical, EXTERNAL);
    ev(CONTENT, &[&f.canonical])
}

#[test]
fn d185_wi2_a_two_spellings_two_windows_both_get_an_external_modify() {
    let d = Dir::new("d185_wi2_a");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W2, &f.alias);

    let sent = deliver(&fw, external_modify(&f));
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "each held spelling gets one copy"
    );
    assert_copies(&sent, "modified", None);
}

#[test]
fn d185_wi2_b_only_alias_held_alias_and_event_path_get_it() {
    let d = Dir::new("d185_wi2_b");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.alias);

    let sent = deliver(&fw, external_modify(&f));
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "the alias, and the event's own path as today"
    );
    assert_copies(&sent, "modified", None);
}

#[test]
fn d185_wi2_c_case_only_alias_on_a_case_insensitive_volume() {
    let d = Dir::new("d185_wi2_c");
    let lower = d.path().join("note.md");
    std::fs::write(&lower, b"one\n").expect("write");
    let upper = d.path().join("NOTE.md");
    // A case-sensitive temp volume makes these two files and two groups,
    // which is correct and not this case: nothing to pin there.
    if !upper.exists() {
        return;
    }
    let canonical = canon(&lower);
    assert_eq!(canon(&upper), canonical, "precondition: case folds");
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &upper);
    acquire(&fw, W2, &lower);

    append(&canonical, EXTERNAL);
    let sent = deliver(&fw, ev(CONTENT, &[&canonical]));
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&lower), s(&upper), s(&canonical)]),
        "each case spelling and the real path, once each"
    );
    assert_copies(&sent, "modified", None);
}

#[test]
fn d185_wi2_d_two_tabs_in_one_window_both_get_it() {
    let d = Dir::new("d185_wi2_d");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W1, &f.alias);

    let sent = deliver(&fw, external_modify(&f));
    assert_eq!(paths(&sent), sorted(vec![s(&f.canonical), s(&f.alias)]));
    assert_copies(&sent, "modified", None);
}

#[test]
fn d185_wi2_e_event_path_also_held_is_emitted_once() {
    let d = Dir::new("d185_wi2_e");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W2, &f.canonical);
    acquire(&fw, W1, &f.alias);

    let sent = deliver(&fw, external_modify(&f));
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "one copy per distinct string: the real path is held twice and is the event path"
    );
}

/// Guard: an own save emits nothing from the watcher, alias held or not;
/// the save notice (with origin) still tells every held spelling.
#[tokio::test]
async fn d185_wi2_g_own_save_emits_no_watcher_file_changed() {
    let d = Dir::new("d185_wi2_g");
    let f = spellings(&d);
    let (fw, notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W2, &f.alias);

    mark_write_start(&f.canonical);
    append(&f.canonical, b"ours\n");
    let self_write = deliver(&fw, ev(CONTENT, &[&f.canonical]));
    mark_write_end(&f.canonical);
    assert!(
        self_write.is_empty(),
        "SelfWrite: no copy for anyone: {self_write:?}"
    );

    let saved = save(&f.canonical, "beta\n", fw.baselines())
        .await
        .expect("the save succeeds");
    let replaced = [
        EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
        EventKind::Create(CreateKind::File),
        CONTENT,
    ];
    for kind in replaced {
        let sent = deliver(&fw, ev(kind, &[&f.canonical]));
        assert!(
            sent.is_empty(),
            "{kind:?}: IgnoredUnchanged, no copy: {sent:?}"
        );
    }

    let origin = SaveOrigin::new(W1, "doc-a");
    fw.notice_saved(&origin, &saved.path, &f.canonical, None);
    let told: Vec<SaveNotice> = notices.sent();
    let mut told_paths: Vec<String> = told.iter().map(|n| n.event.path.clone()).collect();
    told_paths.sort();
    assert_eq!(told_paths, sorted(vec![s(&f.canonical), s(&f.alias)]));
    assert!(told.iter().all(|n| n.origin == origin), "{told:?}");
}

#[path = "file_watcher_fanout_lifecycle_tests.rs"]
mod lifecycle_tests;

#[path = "file_watcher_fanout_log_tests.rs"]
mod log_tests;

#[path = "file_watcher_fanout_live_tests.rs"]
mod live_tests;
