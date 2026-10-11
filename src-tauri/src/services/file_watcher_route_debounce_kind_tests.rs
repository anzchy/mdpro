//! D116: the 500 ms debounce is keyed by (first path, change type), so one
//! kind's entry never swallows another kind's event on the same path. A
//! replace (`modified`, ADR-0072) followed by a `Remove` still reports the
//! deletion; a `deleted` followed by a replacement's `modified` (a safe save,
//! D107) still reports the new file. Same kind on the same path inside the
//! interval stays `Debounced`, and the self-write gate still runs first.
//! Real store, real temp files, synthetic events through `process_event`.
use super::super::baseline::fixture::{append, fresh, modified, route, seed, Map, TempDir};
use super::super::kinds_fixture::{WriteMark, T};
use super::super::{BaselineStore, WatchOutcome};
use notify::event::{DataChange, ModifyKind, RemoveKind, RenameMode};
use notify::EventKind;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use WatchOutcome::{Debounced, EmittedDeleted, EmittedModified, SelfWrite};

const CONTENT: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));
const REMOVE_FILE: EventKind = EventKind::Remove(RemoveKind::File);
/// A single-path rename onto an existing path: a replaced file (ADR-0072).
const RENAME_ANY: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
/// Inside `DEBOUNCE_INTERVAL` (500 ms).
const LIVE_MS: u64 = 100;

/// `name` holding `bytes`, registered in a fresh store.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = d.file(name, bytes);
    let store = BaselineStore::default();
    store.register(&p);
    assert!(store.is_unchanged(&p), "precondition: registered");
    (store, p)
}

/// Write `bytes` to a sibling temp and rename it over `target`.
fn replace_with(target: &Path, bytes: &[u8]) {
    let tmp = target.with_extension("md.tmp");
    fs::write(&tmp, bytes).expect("write temp");
    fs::rename(&tmp, target).expect("rename temp over target");
}

/// The exact `file:changed` payload for a `deleted` emission on `p`.
fn deleted(p: &Path) -> Value {
    json!({"path": p.to_string_lossy(), "changeType": "deleted", "newPath": null, "timestamp": T})
}

fn ms_ago(ms: u64) -> Instant {
    Instant::now()
        .checked_sub(Duration::from_millis(ms))
        .expect("monotonic clock is older than the offset")
}

/// A: a replace emits `modified`; the file is then deleted inside the
/// interval. The `Remove` is reported. RED before D116: `Debounced`.
#[test]
fn dk_a_replace_then_remove_reports_the_deletion() {
    let d = TempDir::new("dk-a");
    let (store, p) = registered(&d, "a.md", b"old");
    let map = fresh();
    replace_with(&p, b"replaced bytes");
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    fs::remove_file(&p).expect("delete");
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
}

/// B: a `deleted` emits; inside the interval the path exists again with
/// other bytes (a safe save renaming the new file into place, or a plain
/// rewrite). The `modified` is reported. RED before D116: `Debounced`.
#[test]
fn dk_b_remove_then_replacement_reports_the_modification() {
    let d = TempDir::new("dk-b");
    for (i, kind) in [RENAME_ANY, CONTENT].into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("b{i}.md"), b"old");
        let map = fresh();
        fs::remove_file(&p).expect("delete");
        assert_eq!(
            route(REMOVE_FILE, &[&p], &map, &store),
            (deleted(&p), EmittedDeleted),
            "{kind:?}"
        );
        fs::write(&p, b"the new file, other bytes").expect("recreate");
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
    }
}

/// C (pin): two `modified` on one path inside the interval: the second is
/// `Debounced`, as before D116.
#[test]
fn dk_c_two_modified_inside_the_interval_still_debounce() {
    let d = TempDir::new("dk-c");
    let (store, p) = registered(&d, "c.md", b"old");
    let map = fresh();
    append(&p, b"one");
    assert_eq!(
        route(CONTENT, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    append(&p, b"two");
    assert_eq!(
        route(CONTENT, &[&p], &map, &store),
        (Value::Null, Debounced)
    );
}

/// D (pin): two `Remove` on one path inside the interval: the second is
/// `Debounced`.
#[test]
fn dk_d_two_removes_inside_the_interval_still_debounce() {
    let d = TempDir::new("dk-d");
    let (store, p) = registered(&d, "d.md", b"old");
    let map = fresh();
    fs::remove_file(&p).expect("delete");
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (Value::Null, Debounced)
    );
}

/// E (pin): an entry on one path never debounces another path, for
/// `modified` and for `deleted`.
#[test]
fn dk_e_different_paths_are_independent() {
    let d = TempDir::new("dk-e");
    let (store, p) = registered(&d, "p.md", b"old");
    let q = d.file("q.md", b"old");
    store.register(&q);
    let map = fresh();
    append(&p, b"p1");
    assert_eq!(route(CONTENT, &[&p], &map, &store).1, EmittedModified);
    append(&q, b"q1");
    assert_eq!(route(CONTENT, &[&q], &map, &store).1, EmittedModified);
    let (r, s) = (d.file("r.md", b"old"), d.file("s.md", b"old"));
    fs::remove_file(&r).expect("delete r");
    assert_eq!(route(REMOVE_FILE, &[&r], &map, &store).1, EmittedDeleted);
    fs::remove_file(&s).expect("delete s");
    assert_eq!(
        route(REMOVE_FILE, &[&s], &map, &store),
        (deleted(&s), EmittedDeleted)
    );
}

/// F (pin, mirrors o12): a save in progress wins over a live debounce entry
/// of either kind, and leaves both entries untouched.
#[test]
fn dk_f_self_write_dominates_a_live_entry_of_either_kind() {
    let d = TempDir::new("dk-f");
    let (store, p) = registered(&d, "f.md", b"old");
    append(&p, b"saved");
    let map: Map = fresh();
    seed(&map, &p, LIVE_MS);
    let deleted_at = ms_ago(LIVE_MS);
    map.lock()
        .unwrap()
        .insert((p.clone(), "deleted"), deleted_at);
    let before = map.lock().unwrap().clone();
    let _mark = WriteMark::new(&p);
    for kind in [CONTENT, RENAME_ANY] {
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (Value::Null, SelfWrite),
            "{kind:?}"
        );
    }
    assert_eq!(
        *map.lock().unwrap(),
        before,
        "self-write must not touch the map"
    );
}
