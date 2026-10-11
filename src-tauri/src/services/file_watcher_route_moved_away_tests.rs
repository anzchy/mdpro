//! D107 (ADR-0078): a single-path `Modify(Name(_))` on a watched path that
//! no longer exists when the event is handled (the file was moved away) is
//! routed as `deleted`, like a `Remove`: never self-write-gated, never
//! unchanged-checked (`NotChecked`), debounced under (path, `deleted`), and
//! the baseline entry is left alone (ADR-0068 decision 4: an emitted
//! `deleted` is not one of the four advances). The same event on a path that
//! still exists stays a replaced file (ADR-0072 decision 1), a `Create` on a
//! missing path stays `IgnoredKind`, and two-path renames stay `renamed`.
//! Real store, real temp files, synthetic events through the route.
use super::super::baseline::fixture::{ev, fresh, modified, route, Map, TempDir};
use super::super::baseline::UnchangedCheck;
use super::super::kinds_fixture::{WriteMark, T};
use super::super::{snapshot, BaselineStore, WatchOutcome};
use super::process_event_checked;
use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use WatchOutcome::{
    Debounced, EmittedDeleted, EmittedModified, EmittedRenamed, IgnoredKind, SelfWrite,
};

const RENAME_ANY: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
const RENAME_MODES: [RenameMode; 5] = [
    RenameMode::Any,
    RenameMode::To,
    RenameMode::From,
    RenameMode::Both,
    RenameMode::Other,
];
const CREATE_KINDS: [CreateKind; 4] = [
    CreateKind::Any,
    CreateKind::File,
    CreateKind::Folder,
    CreateKind::Other,
];

/// `name` holding `bytes`, registered in a fresh store. The path is
/// canonical, so `get` still finds the entry once the file is gone.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = fs::canonicalize(d.file(name, bytes)).expect("canonical");
    let store = BaselineStore::default();
    store.register(&p);
    assert!(store.is_unchanged(&p), "precondition: registered");
    (store, p)
}

/// Move `p` into a sibling directory, as `mv` or Finder would.
fn move_away(d: &TempDir, p: &Path, name: &str) -> PathBuf {
    let elsewhere = d.path().join("elsewhere");
    fs::create_dir_all(&elsewhere).expect("mkdir elsewhere");
    let to = elsewhere.join(name);
    fs::rename(p, &to).expect("move away");
    assert!(!p.exists(), "precondition: the watched path is gone");
    to
}

/// The exact `file:changed` payload for a `deleted` emission on `p`.
fn deleted(p: &Path) -> Value {
    json!({"path": p.to_string_lossy(), "changeType": "deleted", "newPath": null, "timestamp": T})
}

/// Route through `process_event_checked`, keeping the unchanged check.
fn checked(
    kind: EventKind,
    p: &Path,
    map: &Map,
    store: &BaselineStore,
) -> (Value, WatchOutcome, UnchangedCheck) {
    let (emitted, outcome, check) = process_event_checked(&ev(kind, &[p]), map, store, T);
    (serde_json::to_value(&emitted).unwrap(), outcome, check)
}

/// A: moved away, then a single-path rename event for the old path, in
/// every rename mode: `deleted`, not checked, a `deleted` debounce entry,
/// the baseline entry left as it was. RED before D107:
/// `IgnoredRenameSinglePath`.
#[test]
fn ma_a_moved_away_file_is_reported_as_deleted() {
    let d = TempDir::new("ma-a");
    for (i, mode) in RENAME_MODES.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("a{i}.md"), b"bytes");
        let before = store.get(&p);
        move_away(&d, &p, &format!("a{i}.md"));
        let map = fresh();
        let kind = EventKind::Modify(ModifyKind::Name(mode));
        assert_eq!(
            checked(kind, &p, &map, &store),
            (deleted(&p), EmittedDeleted, UnchangedCheck::NotChecked),
            "{mode:?}"
        );
        let keys: Vec<_> = map.lock().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec![(p.clone(), "deleted")], "{mode:?}: debounce");
        assert_eq!(store.get(&p), before, "{mode:?}: baseline untouched");
    }
}

/// B: a safe save. The target is renamed to a backup (its Name event is
/// handled while the path is gone: `deleted`), then a temp with other bytes
/// is renamed onto the target and its Name event arrives inside 500 ms:
/// `modified`, not `Debounced` (D116), and the baseline advances to it.
#[test]
fn ma_b_safe_save_reports_deleted_then_modified() {
    let d = TempDir::new("ma-b");
    let (store, p) = registered(&d, "b.md", b"old bytes");
    let map = fresh();
    fs::rename(&p, p.with_extension("md.bak")).expect("rename to backup");
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    let tmp = p.with_extension("md.tmp");
    fs::write(&tmp, b"the safe-saved new bytes").expect("write temp");
    fs::rename(&tmp, &p).expect("rename temp onto target");
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    assert_eq!(
        store.get(&p),
        Some(snapshot(&p)),
        "advanced to the new file"
    );
}

/// C (pin, ADR-0072 decision 1): the same event on a path that exists is a
/// replaced file and goes through the content check.
#[test]
fn ma_c_name_event_on_an_existing_path_is_still_checked() {
    let d = TempDir::new("ma-c");
    let (store, p) = registered(&d, "c.md", b"same");
    assert_eq!(
        checked(RENAME_ANY, &p, &fresh(), &store),
        (
            Value::Null,
            WatchOutcome::IgnoredUnchanged,
            UnchangedCheck::Unchanged
        )
    );
    fs::write(&p, b"changed and longer").expect("rewrite");
    assert_eq!(
        route(RENAME_ANY, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
}

/// D (pin): a `Create` on a missing path is still `IgnoredKind`, and never
/// touches the debounce map.
#[test]
fn ma_d_create_on_a_missing_path_is_still_ignored_kind() {
    let d = TempDir::new("ma-d");
    let (store, p) = registered(&d, "d.md", b"bytes");
    move_away(&d, &p, "d.md");
    for kind in CREATE_KINDS.map(EventKind::Create) {
        let map = fresh();
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (Value::Null, IgnoredKind),
            "{kind:?}"
        );
        assert!(map.lock().unwrap().is_empty(), "{kind:?}: debounce");
    }
}

/// E (pin): a two-path rename is unchanged: `renamed` with the destination,
/// whether or not the source still exists.
#[test]
fn ma_e_two_path_rename_still_emits_renamed() {
    let d = TempDir::new("ma-e");
    let (store, p) = registered(&d, "from.md", b"bytes");
    let q = move_away(&d, &p, "to.md");
    let both = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
    let expected = json!({
        "path": p.to_string_lossy(),
        "changeType": "renamed",
        "newPath": q.to_string_lossy(),
        "timestamp": T,
    });
    assert_eq!(
        route(both, &[&p, &q], &fresh(), &store),
        (expected, EmittedRenamed)
    );
}

/// F (pin): two moved-away events for one path inside the interval: the
/// second is `Debounced` (same path, same kind).
#[test]
fn ma_f_second_moved_away_event_inside_the_interval_is_debounced() {
    let d = TempDir::new("ma-f");
    let (store, p) = registered(&d, "f.md", b"bytes");
    move_away(&d, &p, "f.md");
    let map = fresh();
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (Value::Null, Debounced)
    );
}

/// G (pin): our own save (mark held) on an existing path is `SelfWrite`, as
/// before. The self-write gate covers `modified` only, so a moved-away path
/// under a mark is `deleted`, the same as a `Remove` (o13).
#[test]
fn ma_g_self_write_gates_only_the_existing_path() {
    let d = TempDir::new("ma-g");
    let (store, p) = registered(&d, "g.md", b"bytes");
    fs::write(&p, b"our own save, other bytes").expect("save");
    let map = fresh();
    let mark = WriteMark::new(&p);
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (Value::Null, SelfWrite)
    );
    assert!(map.lock().unwrap().is_empty(), "self-write: no entry");
    move_away(&d, &p, "g.md");
    assert_eq!(
        route(RENAME_ANY, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    drop(mark);
}
