//! D112-WI-2: the `file.watch.event` line says why the unchanged-file check
//! did or did not drop the event (`unchangedCheck`), on the very line that
//! emits. Real files and a real store through `observe_event`; the stat spy
//! fixes `mtimeMs` / `size`, so whole lines can be pinned.
use super::baseline::fixture::{append, mtime, rewrite_keep_stat, set_mtime, TempDir, CONTENT};
use super::baseline::{BaselineStore, UnchangedCheck};
use super::kinds_fixture::{stat_spy, WriteMark, T};
use super::seed::kit::with_read_hook;
use super::{observe_event, process_event_checked, WatchOutcome};
use notify::event::{DataChange, ModifyKind};
use notify::{Event, EventKind};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

type Map = Mutex<HashMap<(PathBuf, &'static str), std::time::Instant>>;

fn fresh() -> Map {
    Mutex::new(HashMap::new())
}

/// `doc.md` holding `"aaaa"` in a canonical temp dir, registered.
fn registered(label: &str) -> (TempDir, BaselineStore, PathBuf) {
    let d = TempDir::new(label);
    let p = fs::canonicalize(d.path()).expect("canon").join("doc.md");
    fs::write(&p, b"aaaa").expect("write");
    let store = BaselineStore::default();
    store.register(&p);
    (d, store, p)
}

/// The `file.watch.event` line for `kind` on `p`, as the log writes it.
fn line(kind: EventKind, p: &Path, map: &Map, store: &BaselineStore) -> Value {
    let (_calls, spy) = stat_spy();
    let e = Event::new(kind).add_path(p.to_path_buf());
    let (_em, line) = observe_event(&e, map, store, T, spy);
    serde_json::to_value(&line).expect("line serialises")
}

/// The whole line expected for one data-content event on `p`.
fn expected(p: &Path, status: &str, outcome: &str, change: Option<&str>, check: &str) -> Value {
    json!({"level":"info","event":"file.watch.event","status":status,"actionId":null,
        "context":{"kind":"modify_data","detail":"content","outcome":outcome,
        "unchangedCheck":check,"changeType":change,"path":p.to_string_lossy(),"pathCount":1,
        "info":null,"rescan":false,"ownEvent":false,"mtimeMs":4242,"size":17,
        "timestamp":T},"durationMs":null,"error":null})
}

#[test]
fn oc1_a_dropped_event_logs_unchanged() {
    let (_d, store, p) = registered("oc1");
    let got = line(CONTENT, &p, &fresh(), &store);
    let want = expected(&p, "cancel", "ignored_unchanged", None, "unchanged");
    assert_eq!(got, want);
}

#[test]
fn oc2_a_real_change_logs_what_differed_on_the_emitted_line() {
    let (_d, store, p) = registered("oc2a");
    append(&p, b"more");
    let got = line(CONTENT, &p, &fresh(), &store);
    let want = expected(
        &p,
        "success",
        "emitted_modified",
        Some("modified"),
        "stat_differs",
    );
    assert_eq!(got, want);

    let (_d, store, p) = registered("oc2b");
    rewrite_keep_stat(&p, b"bbbb");
    let got = line(CONTENT, &p, &fresh(), &store);
    let want = expected(
        &p,
        "success",
        "emitted_modified",
        Some("modified"),
        "hash_differs",
    );
    assert_eq!(got, want);
}

/// `Data(Size)` is not a filtered kind: the route never asks the store.
#[test]
fn oc3_an_unchecked_kind_logs_not_checked() {
    let (_d, store, p) = registered("oc3");
    let size = EventKind::Modify(ModifyKind::Data(DataChange::Size));
    let got = line(size, &p, &fresh(), &store);
    assert_eq!(got["context"]["outcome"], json!("emitted_modified"));
    assert_eq!(got["context"]["detail"], json!("size"));
    assert_eq!(got["context"]["unchangedCheck"], json!("not_checked"));
}

/// The coordinator's acceptance case: our own save recorded its bytes, then
/// the event-time read is torn. The line that emits says `unstable`, so a
/// device report can tell it from a real external change. Control first:
/// untorn, the same event is dropped as unchanged.
#[test]
fn oc4_a_torn_read_of_an_own_save_emits_with_unstable() {
    let (_d, store, p) = registered("oc4");
    let written: &[u8] = b"saved by mdpro\n";
    fs::write(&p, written).expect("save");
    store.refresh_after_save(&p, written);
    let control = line(CONTENT, &p, &fresh(), &store);
    assert_eq!(control["context"]["unchangedCheck"], json!("unchanged"));
    assert_eq!(control["context"]["outcome"], json!("ignored_unchanged"));

    let (target, t) = (p.clone(), mtime(&p));
    let tear = move || set_mtime(&target, t + Duration::from_secs(5));
    let got = with_read_hook(tear, || line(CONTENT, &p, &fresh(), &store));
    let want = expected(
        &p,
        "success",
        "emitted_modified",
        Some("modified"),
        "unstable",
    );
    assert_eq!(got, want);
}

/// Self-write returns before the check (`not_checked`); a debounce after a
/// failed check keeps the check's reason.
#[test]
fn oc5_route_reports_the_check_only_where_it_ran() {
    let (_d, store, p) = registered("oc5");
    let e = Event::new(CONTENT).add_path(p.clone());
    let mark = WriteMark::new(&p);
    let (_, o, check) = process_event_checked(&e, &fresh(), &store, T);
    assert_eq!(
        (o, check),
        (WatchOutcome::SelfWrite, UnchangedCheck::NotChecked)
    );
    drop(mark);

    append(&p, b"x");
    let map = fresh();
    let (_, o, check) = process_event_checked(&e, &map, &store, T);
    assert_eq!(
        (o, check),
        (WatchOutcome::EmittedModified, UnchangedCheck::StatDiffers)
    );
    append(&p, b"y");
    let (_, o, check) = process_event_checked(&e, &map, &store, T);
    assert_eq!(
        (o, check),
        (WatchOutcome::Debounced, UnchangedCheck::StatDiffers)
    );
}
