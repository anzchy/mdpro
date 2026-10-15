//! D246 (ADR-0109): a non-Name `Modify(_)` on a watched path that no longer
//! exists when the event is handled is routed as `deleted`, like a `Remove`
//! on a gone path and a moved-away rename (ADR-0078): never self-write-gated,
//! never unchanged-checked (`NotChecked`), debounced under (path, `deleted`),
//! the baseline entry left alone. On macOS `rm` of an open file is one
//! FSEvents batch, which notify splits into a `Remove` and then a trailing
//! `Modify(Metadata(_))` / `Modify(Data(_))`; before the fix the trailing
//! modify emitted `modified` under its own debounce key (D116), and the
//! frontend's latest-wins slot showed the reload prompt instead of the
//! deleted one. The same events on a path that exists stay `modified`.
//! Real store, real temp files, synthetic events through the route.
use super::super::baseline::fixture::{fresh, modified, route, Map, TempDir};
use super::super::baseline::UnchangedCheck;
use super::super::kinds_fixture::T;
use super::super::{BaselineStore, WatchOutcome};
use super::process_event_checked;
use notify::event::{DataChange, MetadataKind, ModifyKind, RemoveKind};
use notify::EventKind;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use WatchOutcome::{Debounced, EmittedDeleted, EmittedModified};

/// Every non-Name modify kind notify can report.
const MODIFY_KINDS: [ModifyKind; 13] = [
    ModifyKind::Any,
    ModifyKind::Other,
    ModifyKind::Data(DataChange::Any),
    ModifyKind::Data(DataChange::Size),
    ModifyKind::Data(DataChange::Content),
    ModifyKind::Data(DataChange::Other),
    ModifyKind::Metadata(MetadataKind::Any),
    ModifyKind::Metadata(MetadataKind::AccessTime),
    ModifyKind::Metadata(MetadataKind::WriteTime),
    ModifyKind::Metadata(MetadataKind::Permissions),
    ModifyKind::Metadata(MetadataKind::Ownership),
    ModifyKind::Metadata(MetadataKind::Extended),
    ModifyKind::Metadata(MetadataKind::Other),
];

const REMOVE_FILE: EventKind = EventKind::Remove(RemoveKind::File);

/// `name` holding `bytes`, registered in a fresh store. The path is
/// canonical, so `get` still finds the entry once the file is gone.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = fs::canonicalize(d.file(name, bytes)).expect("canonical");
    let store = BaselineStore::default();
    store.register(&p);
    assert!(store.is_unchanged(&p), "precondition: registered");
    (store, p)
}

/// `rm` the file.
fn remove(p: &Path) {
    fs::remove_file(p).expect("rm");
    assert!(!p.exists(), "precondition: the watched path is gone");
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
    let event = notify::Event::new(kind).add_path(p.to_path_buf());
    let (emitted, outcome, check) = process_event_checked(&event, map, store, T);
    (serde_json::to_value(&emitted).unwrap(), outcome, check)
}

/// A: a modify of any non-Name kind, alone, on a removed file: `deleted`,
/// not checked, one `deleted` debounce entry, the baseline left as it was.
/// RED before D246: `modified`.
#[test]
fn mg_a_a_modify_on_a_gone_path_is_reported_as_deleted() {
    let d = TempDir::new("mg-a");
    for (i, mk) in MODIFY_KINDS.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("a{i}.md"), b"bytes");
        let before = store.get(&p);
        remove(&p);
        let map = fresh();
        assert_eq!(
            checked(EventKind::Modify(mk), &p, &map, &store),
            (deleted(&p), EmittedDeleted, UnchangedCheck::NotChecked),
            "{mk:?}"
        );
        let keys: Vec<_> = map.lock().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec![(p.clone(), "deleted")], "{mk:?}: debounce");
        assert_eq!(store.get(&p), before, "{mk:?}: baseline untouched");
    }
}

/// B: the `rm` batch as FSEvents delivers it, `Remove` then a trailing
/// metadata and data modify: exactly one emission, `deleted`; both trailing
/// modifies are `Debounced` under (path, `deleted`). RED before D246: the
/// metadata modify emitted `modified` (device log 30741 → 30742).
#[test]
fn mg_b_rm_then_trailing_modifies_emit_only_deleted() {
    let d = TempDir::new("mg-b");
    let (store, p) = registered(&d, "b.md", b"bytes");
    remove(&p);
    let map = fresh();
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    for mk in [
        ModifyKind::Metadata(MetadataKind::Any),
        ModifyKind::Data(DataChange::Content),
    ] {
        assert_eq!(
            route(EventKind::Modify(mk), &[&p], &map, &store),
            (Value::Null, Debounced),
            "{mk:?}"
        );
    }
    let keys: Vec<_> = map.lock().unwrap().keys().cloned().collect();
    assert_eq!(keys, vec![(p.clone(), "deleted")], "one debounce key");
}

/// C (pin): the same modifies on a path that exists stay `modified` when the
/// bytes changed, and the filtered kinds still drop an unchanged file.
#[test]
fn mg_c_a_modify_on_a_present_path_is_still_modified() {
    let d = TempDir::new("mg-c");
    let (store, p) = registered(&d, "c.md", b"old");
    fs::write(&p, b"new and longer bytes").expect("rewrite");
    assert_eq!(
        route(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &[&p],
            &fresh(),
            &store
        ),
        (modified(&p), EmittedModified)
    );
    assert_eq!(
        checked(
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
            &p,
            &fresh(),
            &store
        ),
        (
            Value::Null,
            WatchOutcome::IgnoredUnchanged,
            UnchangedCheck::Unchanged
        ),
        "the baseline advanced on the emit, so a later metadata flag is unchanged"
    );
}

/// D (pin): delete then recreate. Once the path exists again a modify is a
/// content change, `modified`, not debounced by the earlier `deleted` (D116).
#[test]
fn mg_d_a_recreated_file_reports_modified_after_deleted() {
    let d = TempDir::new("mg-d");
    let (store, p) = registered(&d, "d.md", b"old bytes");
    remove(&p);
    let map = fresh();
    let data = EventKind::Modify(ModifyKind::Data(DataChange::Content));
    assert_eq!(
        route(data, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    fs::write(&p, b"recreated with other bytes").expect("recreate");
    assert_eq!(
        route(data, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
}

/// E (live, macOS, ignored by default like o15): `rm` of a watched file
/// through real FSEvents. Every event goes through the route with one
/// debounce map, as `observe_event` does: at least one `deleted`, and never
/// a `modified`. Whether FSEvents adds the trailing modify is its timing
/// (two runs in three on the device), so this pairs with B rather than
/// standing in for it. Run with `cargo test -- --ignored mg_e`.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "real FSEvents; cargo test -- --ignored mg_e"]
fn mg_e_live_rm_emits_deleted_and_never_modified() {
    use notify::{RecursiveMode, Watcher};
    use std::sync::mpsc;
    use std::time::Duration;

    let d = TempDir::new("mg-e");
    let (store, p) = registered(&d, "e.md", b"bytes on disk");
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |r| {
        let _ = tx.send(r);
    })
    .expect("watcher");
    watcher
        .watch(&p, RecursiveMode::NonRecursive)
        .expect("watch");
    std::thread::sleep(Duration::from_millis(200));
    remove(&p);

    let map = fresh();
    let (mut deleted_count, mut modified_count, mut received) = (0, 0, 0);
    let mut wait = Duration::from_secs(5);
    while let Ok(r) = rx.recv_timeout(wait) {
        wait = Duration::from_millis(800);
        let Ok(event) = r else { continue };
        received += 1;
        match process_event_checked(&event, &map, &store, T).1 {
            EmittedDeleted => deleted_count += 1,
            EmittedModified => modified_count += 1,
            _ => {}
        }
    }
    let _ = watcher.unwatch(&p);
    assert!(received > 0, "FSEvents delivered nothing");
    assert!(deleted_count >= 1, "no deleted among {received} events");
    assert_eq!(modified_count, 0, "a modified among {received} events");
}

/// F (pin, delegator's addition): a non-atomic save, `unlink`, a gap, then a
/// write of the same path with other bytes. A modify handled inside the gap
/// is `deleted` now; the write's own events, handled once the path exists
/// again, still emit `modified`, so the user's last prompt is the reload one.
/// The data modify after it emits nothing: the emit advanced the baseline.
#[test]
fn mg_f_unlink_gap_write_ends_as_modified() {
    let d = TempDir::new("mg-f");
    let (store, p) = registered(&d, "f.md", b"before the save");
    let map = fresh();
    remove(&p);
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    let meta = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any));
    assert_eq!(
        route(meta, &[&p], &map, &store),
        (Value::Null, Debounced),
        "a modify inside the gap"
    );
    fs::write(&p, b"after the save, other bytes").expect("write");
    let create = EventKind::Create(notify::event::CreateKind::File);
    assert_eq!(
        route(create, &[&p], &map, &store),
        (modified(&p), EmittedModified),
        "the write's create, handled once the path exists"
    );
    let (emitted, outcome) = route(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &[&p],
        &map,
        &store,
    );
    assert_eq!(emitted, Value::Null, "its data modify emits nothing more");
    assert_eq!(
        outcome,
        WatchOutcome::IgnoredUnchanged,
        "the emit advanced the baseline to the new bytes"
    );
}

/// G (pin): the same non-atomic save writing back identical bytes. The new
/// file has a new mtime, so its create is not provably unchanged and emits
/// `modified`: the `deleted` prompt does not stay up over a file that exists.
#[test]
fn mg_g_unlink_gap_rewrite_of_the_same_bytes_ends_as_modified() {
    let d = TempDir::new("mg-g");
    let (store, p) = registered(&d, "g.md", b"identical bytes");
    let map = fresh();
    remove(&p);
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    std::thread::sleep(std::time::Duration::from_millis(20));
    fs::write(&p, b"identical bytes").expect("rewrite");
    let create = EventKind::Create(notify::event::CreateKind::File);
    assert_eq!(
        route(create, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
}
