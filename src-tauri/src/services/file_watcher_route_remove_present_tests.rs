//! D152: a `Remove` whose first path still exists when it is handled is a
//! replaced file, routed like a `Create` on a present path (ADR-0072): the
//! self-write gate, the D32 unchanged drop, the D116 debounce keyed
//! (path, `modified`), and on emit `modified` with the baseline refreshed.
//! A `Remove` whose path is gone stays `deleted` and is not checked. An
//! external editor's atomic save delivers `Create`, `Remove` and a
//! single-path rename for one path within milliseconds; before D152 the
//! `Remove` took its own `deleted` debounce slot (D116) and emitted
//! "deleted" for a file that exists. Real store, real temp files, synthetic
//! events through the real route.
use super::super::baseline::fixture::{ev, fresh, modified, route, TempDir};
use super::super::baseline::UnchangedCheck;
use super::super::kinds_fixture::{WriteMark, T};
use super::super::{snapshot, BaselineStore, WatchOutcome};
use super::process_event_checked;
use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::EventKind;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use WatchOutcome::{EmittedDeleted, EmittedModified, IgnoredUnchanged, SelfWrite};

const CREATE_FILE: EventKind = EventKind::Create(CreateKind::File);
const REMOVE_FILE: EventKind = EventKind::Remove(RemoveKind::File);
const RENAME_ANY: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
const REMOVE_KINDS: [RemoveKind; 4] = [
    RemoveKind::Any,
    RemoveKind::File,
    RemoveKind::Folder,
    RemoveKind::Other,
];

/// `name` holding `bytes`, registered in a fresh store and unchanged.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = d.file(name, bytes);
    let store = BaselineStore::default();
    store.register(&p);
    assert!(
        store.is_unchanged(&p),
        "precondition: registered, unchanged"
    );
    (store, p)
}

/// An external editor's atomic save: write a sibling temp, rename it over.
fn replace_with(target: &Path, bytes: &[u8]) {
    let tmp = target.with_extension("md.tmp");
    fs::write(&tmp, bytes).expect("write temp");
    fs::rename(&tmp, target).expect("rename temp over target");
}

/// a: the regression. One atomic save, its three events each handled while
/// the path exists with the new bytes: exactly one `modified`, no
/// `deleted`. RED before D152: the `Remove` emitted `deleted`.
#[test]
fn rm_a_atomic_save_burst_emits_one_modified_and_no_deleted() {
    let d = TempDir::new("rm-a");
    let (store, p) = registered(&d, "a.md", b"old");
    let map = fresh();
    replace_with(&p, b"the external editor's new bytes");
    let outcomes: Vec<WatchOutcome> = [CREATE_FILE, REMOVE_FILE, RENAME_ANY]
        .into_iter()
        .map(|kind| route(kind, &[&p], &map, &store).1)
        .collect();
    let emitted_modified = outcomes.iter().filter(|o| **o == EmittedModified).count();
    assert_eq!(emitted_modified, 1, "{outcomes:?}");
    assert!(!outcomes.contains(&EmittedDeleted), "{outcomes:?}");
    assert_eq!(
        store.get(&p),
        Some(snapshot(&p)),
        "baseline at the new bytes"
    );
}

/// b: a `Remove` on a present path whose bytes and stat equal the baseline
/// is dropped as unchanged, for every remove kind, and records no debounce
/// entry. RED before D152: `EmittedDeleted`.
#[test]
fn rm_b_present_unchanged_remove_is_ignored_unchanged() {
    let d = TempDir::new("rm-b");
    for (i, rk) in REMOVE_KINDS.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("b{i}.md"), b"same bytes");
        let map = fresh();
        let (em, outcome, check) =
            process_event_checked(&ev(EventKind::Remove(rk), &[&p]), &map, &store, T);
        assert_eq!(
            (em.is_none(), outcome, check),
            (true, IgnoredUnchanged, UnchangedCheck::Unchanged),
            "{rk:?}"
        );
        assert!(map.lock().unwrap().is_empty(), "{rk:?}: map touched");
    }
}

/// c: a `Remove` on a present path inside our own save's mark is
/// `SelfWrite`, not checked, and leaves the debounce map alone. RED before
/// D152: `EmittedDeleted`.
#[test]
fn rm_c_present_remove_inside_the_self_write_mark_is_self_write() {
    let d = TempDir::new("rm-c");
    let (store, p) = registered(&d, "c.md", b"old");
    replace_with(&p, b"our own save's bytes");
    let map = fresh();
    let _mark = WriteMark::new(&p);
    let (em, outcome, check) = process_event_checked(&ev(REMOVE_FILE, &[&p]), &map, &store, T);
    assert_eq!(
        (em.is_none(), outcome, check),
        (true, SelfWrite, UnchangedCheck::NotChecked)
    );
    assert!(map.lock().unwrap().is_empty(), "self-write must not insert");
}

/// d (pin): a `Remove` whose path is gone stays `deleted`, not checked, and
/// records its `deleted` entry, for every remove kind.
#[test]
fn rm_d_remove_on_a_gone_path_is_still_deleted_and_not_checked() {
    let d = TempDir::new("rm-d");
    for (i, rk) in REMOVE_KINDS.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("d{i}.md"), b"old");
        fs::remove_file(&p).expect("delete");
        let map = fresh();
        let (em, outcome, check) =
            process_event_checked(&ev(EventKind::Remove(rk), &[&p]), &map, &store, T);
        let expected = json!({"path": p.to_string_lossy(), "changeType": "deleted", "newPath": null, "timestamp": T});
        assert_eq!(serde_json::to_value(&em).unwrap(), expected, "{rk:?}");
        assert_eq!(
            (outcome, check),
            (EmittedDeleted, UnchangedCheck::NotChecked),
            "{rk:?}"
        );
        let keys: Vec<&'static str> = map.lock().unwrap().keys().map(|(_, k)| *k).collect();
        assert_eq!(keys, vec!["deleted"], "{rk:?}");
    }
}

/// e: a `Remove` on a present path with other bytes emits `modified` (no
/// `newPath`), records the `modified` entry and advances the baseline to
/// the disk, for every remove kind. RED before D152: `EmittedDeleted`.
#[test]
fn rm_e_present_changed_remove_emits_modified_and_refreshes_the_baseline() {
    let d = TempDir::new("rm-e");
    for (i, rk) in REMOVE_KINDS.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("e{i}.md"), b"old");
        replace_with(&p, b"other bytes, a different length");
        let map = fresh();
        assert_eq!(
            route(EventKind::Remove(rk), &[&p], &map, &store),
            (modified(&p), EmittedModified),
            "{rk:?}"
        );
        assert_eq!(store.get(&p), Some(snapshot(&p)), "{rk:?}: advanced");
        let keys: Vec<&'static str> = map.lock().unwrap().keys().map(|(_, k)| *k).collect();
        assert_eq!(keys, vec!["modified"], "{rk:?}");
        let again = route(EventKind::Remove(rk), &[&p], &map, &store);
        assert_eq!(again, (Value::Null, IgnoredUnchanged), "{rk:?}: refreshed");
    }
}
