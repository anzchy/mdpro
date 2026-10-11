//! D32 WI-4/4b routing cases (matrix R1-R10, R17-R20): the real `process_event`
//! and `observe_event` with a real `BaselineStore` over real temp files.
//! Events are hand-built `notify::Event`s; FS1/FS2 are the real-FSEvents pair.
use super::super::kinds_fixture::{stat_spy, WriteMark, T};
use super::super::watch_log::stat_snapshot;
use super::super::{observe_event, WatchOutcome};
use super::fixture::{
    ev, fresh, modified, rewrite_keep_stat, route, seed, TempDir, CONTENT, EXTENDED,
};
use super::{snapshot, BaselineStore};
use crate::models::log_entry::{LogLevel, LogStatus};
use notify::event::{MetadataKind, ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::{json, Value};
use std::path::PathBuf;

use WatchOutcome::{EmittedModified, IgnoredUnchanged};

fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = d.file(name, bytes);
    let store = BaselineStore::default();
    store.register(&p);
    assert!(
        store.get(&p).and_then(|e| e.hash).is_some(),
        "precondition: registered with a hash"
    );
    (store, p)
}

/// R1: equal stat and equal hash drop the event without a debounce entry.
#[test]
fn r1_extended_equal_stat_equal_hash_is_ignored() {
    let d = TempDir::new("r1");
    let (store, p) = registered(&d, "a.md", b"abc");
    let before = store.get(&p);
    let map = fresh();
    assert_eq!(
        route(EXTENDED, &[&p], &map, &store),
        (Value::Null, IgnoredUnchanged)
    );
    assert!(
        map.lock().unwrap().is_empty(),
        "drop recorded a debounce entry"
    );
    assert_eq!(store.get(&p), before, "a drop never touches the store");
}

/// R2: after a drop, a real data write on the same map is not swallowed.
/// (WI-4b: Content on unchanged bytes is itself dropped, so the file changes.)
#[test]
fn r2_dropped_event_records_no_debounce_entry() {
    let d = TempDir::new("r2");
    let (store, p) = registered(&d, "a.md", b"abc");
    let map = fresh();
    assert_eq!(route(EXTENDED, &[&p], &map, &store).1, IgnoredUnchanged);
    super::fixture::append(&p, b"!");
    assert_eq!(
        route(CONTENT, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    let keys: Vec<(PathBuf, &str)> = map.lock().unwrap().keys().cloned().collect();
    assert_eq!(keys, vec![(p, "modified")]);
}

/// R3: same stat, different bytes: the hash catches it, and the emit advances.
#[test]
fn r3_extended_equal_stat_changed_hash_emits() {
    let d = TempDir::new("r3");
    let (store, p) = registered(&d, "a.md", b"hello world");
    let before = store.get(&p);
    rewrite_keep_stat(&p, b"hello WORLD");
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
    assert_eq!(store.get(&p), Some(snapshot(&p)), "emit advances the entry");
    assert_ne!(
        store.get(&p),
        before,
        "the advanced entry holds the new bytes"
    );
}

/// R4: R3 through `observe_event` with the real `stat_snapshot`.
#[test]
fn r4_same_size_content_change_with_mtime_restored_emits_through_observe_event() {
    let d = TempDir::new("r4");
    let (store, p) = registered(&d, "a.md", b"hello world");
    rewrite_keep_stat(&p, b"hello WORLD");
    let e = ev(EXTENDED, &[&p]);
    let (emitted, line) = observe_event(&e, &fresh(), &store, T, stat_snapshot);
    assert!(emitted.is_some(), "a same-stat content change must emit");
    assert_eq!(line.status, LogStatus::Success);
    let ctx = line.context.clone().unwrap_or(Value::Null);
    assert_eq!(ctx["outcome"], json!("emitted_modified"));
    assert_eq!(ctx["kind"], json!("modify_metadata"));
    assert_eq!(ctx["detail"], json!("extended"));
    assert_eq!(ctx["changeType"], json!("modified"));
}

fn metadata(m: MetadataKind) -> EventKind {
    EventKind::Modify(ModifyKind::Metadata(m))
}

/// R5: `Metadata(Any)` on an unchanged registered file is filtered (WI-4b).
#[test]
fn r5_metadata_any_equal_stat_is_ignored() {
    let d = TempDir::new("r5");
    let (store, p) = registered(&d, "a.md", b"abc");
    assert!(store.is_unchanged(&p), "precondition: file is unchanged");
    assert_eq!(
        route(metadata(MetadataKind::Any), &[&p], &fresh(), &store),
        (Value::Null, IgnoredUnchanged)
    );
}

/// R5 (rest): the five unfiltered metadata subkinds still emit.
#[test]
fn r5b_other_metadata_subkinds_equal_stat_emit() {
    use MetadataKind::{AccessTime, Other, Ownership, Permissions, WriteTime};
    for m in [AccessTime, WriteTime, Permissions, Ownership, Other] {
        let d = TempDir::new("r5b");
        let (store, p) = registered(&d, "a.md", b"abc");
        assert!(
            store.is_unchanged(&p),
            "precondition: {m:?} file is unchanged"
        );
        assert_eq!(
            route(metadata(m), &[&p], &fresh(), &store),
            (modified(&p), EmittedModified),
            "{m:?}"
        );
    }
}

/// R6: a rename emits exactly as today and leaves the old entry in place.
#[test]
fn r6_rename_event_emits_unchanged() {
    let d = TempDir::new("r6");
    let (store, p) = registered(&d, "a.md", b"abc");
    let q = d.path().join("b.md");
    let before = store.get(&p);
    let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
    let expected = json!({"path": p.to_string_lossy(), "changeType": "renamed",
        "newPath": q.to_string_lossy(), "timestamp": T});
    assert_eq!(
        route(rename, &[&p, &q], &fresh(), &store),
        (expected, WatchOutcome::EmittedRenamed)
    );
    assert_eq!(store.get(&p), before);
    assert_eq!(store.get(&q), None);
    assert_eq!(store.len(), 1);
}

/// R7: self-write is checked before the drop.
#[test]
fn r7_self_write_extended_stays_self_write() {
    let d = TempDir::new("r7");
    let (store, p) = registered(&d, "a.md", b"abc");
    let before = store.get(&p);
    let map = fresh();
    let _mark = WriteMark::new(&p);
    assert_eq!(
        route(EXTENDED, &[&p], &map, &store),
        (Value::Null, WatchOutcome::SelfWrite)
    );
    assert!(map.lock().unwrap().is_empty());
    assert_eq!(store.get(&p), before);
}

/// R8: an emitted `modified` advances the entry, so the next Extended drops.
#[test]
fn r8_emitted_modified_advances_baseline() {
    let d = TempDir::new("r8");
    let (store, p) = registered(&d, "a.md", b"v1");
    let first = store.get(&p);
    std::fs::write(&p, b"v2-longer").unwrap();
    let map = fresh();
    assert_eq!(route(CONTENT, &[&p], &map, &store).1, EmittedModified);
    assert_eq!(store.get(&p), Some(snapshot(&p)));
    assert_ne!(store.get(&p), first);
    seed(&map, &p, 600);
    assert_eq!(
        route(EXTENDED, &[&p], &map, &store),
        (Value::Null, IgnoredUnchanged)
    );
}

/// R9: the post-emit refresh never inserts an entry.
#[test]
fn r9_emitted_modified_does_not_resurrect_an_unregistered_entry() {
    let d = TempDir::new("r9");
    let p = d.file("a.md", b"abc");
    let store = BaselineStore::default();
    assert_eq!(route(CONTENT, &[&p], &fresh(), &store).1, EmittedModified);
    assert_eq!(store.len(), 0);
}

/// R10: the drop logs as `Cancel`, and `stat_of` is still called exactly once.
#[test]
fn r10_observe_event_logs_ignored_unchanged_as_cancel() {
    let d = TempDir::new("r10");
    let (store, p) = registered(&d, "a.md", b"abc");
    let (calls, spy) = stat_spy();
    let (emitted, line) = observe_event(&ev(EXTENDED, &[&p]), &fresh(), &store, T, spy);
    assert!(emitted.is_none());
    assert_eq!(line.status, LogStatus::Cancel);
    assert_eq!(line.level, LogLevel::Info);
    let ctx = line.context.clone().unwrap_or(Value::Null);
    assert_eq!(ctx["outcome"], json!("ignored_unchanged"));
    assert_eq!(ctx["kind"], json!("modify_metadata"));
    assert_eq!(ctx["detail"], json!("extended"));
    assert_eq!(ctx["changeType"], Value::Null);
    assert_eq!(ctx["timestamp"], json!(T));
    assert_eq!(ctx["mtimeMs"], json!(4242));
    assert_eq!(*calls.borrow(), vec![p]);
}

/// R17: no baseline means no drop.
#[test]
fn r17_fail_open_without_baseline_emits() {
    let d = TempDir::new("r17");
    let p = d.file("a.md", b"abc");
    let store = BaselineStore::default();
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
    assert_eq!(store.len(), 0);
}

/// R18: a read error fails open, and the refresh then stores no hash.
#[cfg(unix)]
#[test]
fn r18_fail_open_unreadable_emits() {
    use super::fixture::{chmod, chmod_000_unreadable};
    let d = TempDir::new("r18");
    let (store, p) = registered(&d, "a.md", b"abc");
    chmod_000_unreadable(&p);
    assert_eq!(
        snapshot(&p).stat,
        store.get(&p).unwrap().stat,
        "precondition"
    );
    let got = route(EXTENDED, &[&p], &fresh(), &store);
    let hash_after = store.get(&p).unwrap().hash;
    chmod(&p, 0o644);
    assert_eq!(got, (modified(&p), EmittedModified));
    assert_eq!(hash_after, None, "the post-emit refresh read nothing");
}

/// R19: a missing stat fails open.
#[test]
fn r19_fail_open_missing_stat_emits() {
    let d = TempDir::new("r19");
    let (store, p) = registered(&d, "a.md", b"abc");
    std::fs::remove_file(&p).unwrap();
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
    assert!(!store.is_unchanged(&p));
}

/// R20: an entry registered without a hash fails open, then the refresh fills it.
#[cfg(unix)]
#[test]
fn r20_fail_open_registered_without_hash_emits() {
    use super::fixture::{chmod, chmod_000_unreadable};
    let d = TempDir::new("r20");
    let p = d.file("a.md", b"abc");
    chmod_000_unreadable(&p);
    let store = BaselineStore::default();
    store.register(&p);
    let stored = store.get(&p).unwrap();
    assert_eq!(stored.hash, None, "precondition: registered without a hash");
    chmod(&p, 0o644);
    assert_eq!(
        snapshot(&p).stat,
        stored.stat,
        "precondition: stat unchanged"
    );
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
    assert!(
        store.get(&p).unwrap().hash.is_some(),
        "refreshed with a hash"
    );
}
