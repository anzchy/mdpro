//! D246 follow-up H-1 (audit b167, ADR-0111): an emission of one change type
//! clears the other types' debounce entries for its path, so a change of
//! state restarts the 500 ms window. Before, (path, kind) entries were
//! independent (D116): a `modified` at t0, then an `rm` (`deleted`), then a
//! recreate inside t0 + 500 ms was `Debounced` under the stale
//! (path, `modified`) entry, and the user was left on the deleted prompt over
//! a file that exists. A repeat of the same state is still absorbed.
//! Real store, real temp files, synthetic events through the route.
use super::super::baseline::fixture::{fresh, modified, route, TempDir};
use super::super::kinds_fixture::T;
use super::super::{BaselineStore, WatchOutcome};
use notify::event::{CreateKind, DataChange, ModifyKind, RemoveKind};
use notify::EventKind;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use WatchOutcome::{Debounced, EmittedDeleted, EmittedModified};

const CONTENT: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));
const REMOVE_FILE: EventKind = EventKind::Remove(RemoveKind::File);
const CREATE_FILE: EventKind = EventKind::Create(CreateKind::File);

/// `name` holding `bytes`, registered in a fresh store, canonical path.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = fs::canonicalize(d.file(name, bytes)).expect("canonical");
    let store = BaselineStore::default();
    store.register(&p);
    (store, p)
}

fn deleted(p: &Path) -> Value {
    json!({"path": p.to_string_lossy(), "changeType": "deleted", "newPath": null, "timestamp": T})
}

/// A: modified, then rm, then a recreate with other bytes, all inside the
/// interval: the recreate reports `modified`. RED before: `Debounced`.
#[test]
fn sc_a_modified_rm_recreate_inside_the_interval_ends_modified() {
    let d = TempDir::new("sc-a");
    let (store, p) = registered(&d, "a.md", b"first");
    let map = fresh();
    fs::write(&p, b"an external edit").expect("edit");
    assert_eq!(
        route(CONTENT, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    fs::remove_file(&p).expect("rm");
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (deleted(&p), EmittedDeleted)
    );
    fs::write(&p, b"recreated with other bytes").expect("recreate");
    assert_eq!(
        route(CREATE_FILE, &[&p], &map, &store),
        (modified(&p), EmittedModified),
        "the recreate is the last word"
    );
}

/// B: after a `deleted` emission the map holds only (p, `deleted`) for p;
/// another path's entry is untouched. RED before: both of p's keys remain.
#[test]
fn sc_b_an_emission_clears_only_its_own_paths_other_kinds() {
    let d = TempDir::new("sc-b");
    let (store, p) = registered(&d, "b.md", b"one");
    let (store_q, q) = registered(&d, "q.md", b"two");
    let map = fresh();
    fs::write(&p, b"edited p").expect("edit p");
    fs::write(&q, b"edited q").expect("edit q");
    assert_eq!(route(CONTENT, &[&p], &map, &store).1, EmittedModified);
    assert_eq!(route(CONTENT, &[&q], &map, &store_q).1, EmittedModified);
    fs::remove_file(&p).expect("rm p");
    assert_eq!(route(REMOVE_FILE, &[&p], &map, &store).1, EmittedDeleted);
    let mut keys: Vec<_> = map.lock().unwrap().keys().cloned().collect();
    keys.sort();
    let mut want = vec![(p.clone(), "deleted"), (q.clone(), "modified")];
    want.sort();
    assert_eq!(keys, want);
}

/// C (pin): a repeat of the same state is still absorbed, and a debounced
/// event clears nothing: Remove, Remove → the second is `Debounced` and
/// (p, `deleted`) is the only key.
#[test]
fn sc_c_the_same_state_repeated_is_still_debounced() {
    let d = TempDir::new("sc-c");
    let (store, p) = registered(&d, "c.md", b"x");
    let map = fresh();
    fs::remove_file(&p).expect("rm");
    assert_eq!(route(REMOVE_FILE, &[&p], &map, &store).1, EmittedDeleted);
    assert_eq!(
        route(REMOVE_FILE, &[&p], &map, &store),
        (Value::Null, Debounced)
    );
    let keys: Vec<_> = map.lock().unwrap().keys().cloned().collect();
    assert_eq!(keys, vec![(p.clone(), "deleted")]);
}

/// D (pin, D246): the rm batch's trailing modify on the gone path is still
/// absorbed by the delete's entry.
#[test]
fn sc_d_the_rm_batch_trailing_modify_is_still_debounced() {
    let d = TempDir::new("sc-d");
    let (store, p) = registered(&d, "d.md", b"x");
    let map = fresh();
    fs::write(&p, b"edited").expect("edit");
    assert_eq!(route(CONTENT, &[&p], &map, &store).1, EmittedModified);
    fs::remove_file(&p).expect("rm");
    assert_eq!(route(REMOVE_FILE, &[&p], &map, &store).1, EmittedDeleted);
    assert_eq!(
        route(CONTENT, &[&p], &map, &store),
        (Value::Null, Debounced)
    );
}
