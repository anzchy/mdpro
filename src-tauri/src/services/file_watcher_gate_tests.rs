//! Gate-state tests for `services::file_watcher` (D32 WI-2: o1, o7-o13).
//!
//! Wired from `file_watcher.rs` with `#[cfg(test)] #[path = ...] mod gate_tests;`.
//! Covers `WatchOutcome::as_str` and the stateful gates inside
//! `process_event`: the shared debounce map and the global self-write set.
//! Uses the real `is_self_write` / `is_debounced` with unique temp paths; no
//! clock seam, so expiry is exercised by pre-seeding the map.

use super::baseline::BaselineStore;
use super::kinds_fixture::{all_event_kinds, unique_path, WriteMark, T};
use super::{process_event, WatchOutcome};
use notify::event::{DataChange, MetadataKind, ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

type Map = Mutex<HashMap<(PathBuf, &'static str), Instant>>;

const CONTENT: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));
const REMOVE_FILE: EventKind = EventKind::Remove(RemoveKind::File);
const RENAME_BOTH: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::Both));

fn fresh() -> Map {
    Mutex::new(HashMap::new())
}

// `&PathBuf` so it composes with the `Vec<PathBuf>` / `Option<&PathBuf>` the cases hold.
#[allow(clippy::ptr_arg)]
fn seeded(p: &PathBuf, at: Instant) -> Map {
    Mutex::new(HashMap::from([((p.clone(), "modified"), at)]))
}

fn run(kind: EventKind, paths: &[&PathBuf], map: &Map) -> (Value, WatchOutcome) {
    let event = paths
        .iter()
        .fold(Event::new(kind), |ev, p| ev.add_path((*p).clone()));
    let (emitted, outcome) = process_event(&event, map, &BaselineStore::default(), T);
    (serde_json::to_value(&emitted).unwrap(), outcome)
}

/// `p`'s `modified` entry.
#[allow(clippy::ptr_arg)]
fn entry(map: &Map, p: &PathBuf) -> Option<Instant> {
    entry_of(map, p, "modified")
}

fn entry_of(map: &Map, p: &Path, kind: &'static str) -> Option<Instant> {
    map.lock().unwrap().get(&(p.to_path_buf(), kind)).copied()
}

fn ago(ms: u64) -> Instant {
    Instant::now()
        .checked_sub(Duration::from_millis(ms))
        .expect("monotonic clock is older than the offset")
}

#[test]
fn o1_as_str_is_exact_injective_and_all_is_complete() {
    fn tripwire(o: WatchOutcome) -> &'static str {
        match o {
            WatchOutcome::EmittedModified => "emitted_modified",
            WatchOutcome::EmittedDeleted => "emitted_deleted",
            WatchOutcome::EmittedRenamed => "emitted_renamed",
            WatchOutcome::Debounced => "debounced",
            WatchOutcome::SelfWrite => "self_write",
            WatchOutcome::IgnoredKind => "ignored_kind",
            WatchOutcome::IgnoredNoPath => "ignored_no_path",
            WatchOutcome::IgnoredRenameSinglePath => "ignored_rename_single_path",
            WatchOutcome::IgnoredUnchanged => "ignored_unchanged",
        }
    }
    assert_eq!(WatchOutcome::ALL.len(), 9);
    let strings: HashSet<&str> = WatchOutcome::ALL.iter().map(|o| o.as_str()).collect();
    assert_eq!(strings.len(), 9, "as_str must be injective: {strings:?}");
    for o in WatchOutcome::ALL {
        assert_eq!(o.as_str(), tripwire(o), "{o:?}");
    }
    let expected: HashSet<&str> = [
        "emitted_modified",
        "emitted_deleted",
        "emitted_renamed",
        "debounced",
        "self_write",
        "ignored_kind",
        "ignored_no_path",
        "ignored_rename_single_path",
        "ignored_unchanged",
    ]
    .into_iter()
    .collect();
    assert_eq!(strings, expected);
}

#[test]
fn o7_debounce_within_window_does_not_refresh_the_entry() {
    let p = unique_path("o7");
    let map = fresh();
    assert_eq!(run(CONTENT, &[&p], &map).1, WatchOutcome::EmittedModified);
    let first = entry(&map, &p).expect("emission records the path");
    let metadata = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended));
    assert_eq!(
        run(metadata, &[&p], &map),
        (Value::Null, WatchOutcome::Debounced)
    );
    assert_eq!(
        entry(&map, &p),
        Some(first),
        "debounced hit must not refresh"
    );
}

#[test]
fn o8_debounce_expiry_boundary() {
    let p = unique_path("o8");
    let seed_a = ago(600);
    let map_a = seeded(&p, seed_a);
    assert_eq!(run(CONTENT, &[&p], &map_a).1, WatchOutcome::EmittedModified);
    assert!(
        entry(&map_a, &p).unwrap() > seed_a,
        "expired entry is refreshed"
    );

    let seed_b = ago(400);
    let map_b = seeded(&p, seed_b);
    assert_eq!(
        run(CONTENT, &[&p], &map_b),
        (Value::Null, WatchOutcome::Debounced)
    );
    assert_eq!(entry(&map_b, &p), Some(seed_b), "live entry is untouched");
}

/// D116: the debounce is keyed by (first path, change type). A different
/// kind on the same path passes; the same kind inside the interval is still
/// debounced.
#[test]
fn o9_debounce_is_per_first_path_and_per_kind() {
    let (p, q, r) = (unique_path("o9"), unique_path("o9"), unique_path("o9"));
    let map = fresh();
    assert_eq!(run(CONTENT, &[&p], &map).1, WatchOutcome::EmittedModified);
    assert_eq!(
        run(REMOVE_FILE, &[&p], &map).1,
        WatchOutcome::EmittedDeleted
    );
    assert_eq!(
        run(REMOVE_FILE, &[&p], &map),
        (Value::Null, WatchOutcome::Debounced)
    );
    assert_eq!(run(CONTENT, &[&q], &map).1, WatchOutcome::EmittedModified);
    assert_eq!(
        run(RENAME_BOTH, &[&q, &r], &map).1,
        WatchOutcome::EmittedRenamed
    );
    assert_eq!(
        run(CONTENT, &[&q], &map),
        (Value::Null, WatchOutcome::Debounced)
    );
    assert_eq!(run(CONTENT, &[&r], &map).1, WatchOutcome::EmittedModified);
    let keys: HashSet<(PathBuf, &str)> = map.lock().unwrap().keys().cloned().collect();
    let expected = HashSet::from([
        (p.clone(), "modified"),
        (p, "deleted"),
        (q.clone(), "modified"),
        (q, "renamed"),
        (r, "modified"),
    ]);
    assert_eq!(keys, expected);
}

/// D116: an emitted Remove records only its `deleted` entry, so a following
/// modify on the same path emits and leaves that entry alone.
#[test]
fn o9b_emitted_remove_does_not_debounce_a_following_modify() {
    let p = unique_path("o9b");
    let map = fresh();
    let expected = json!({"path": p.to_string_lossy(), "changeType": "deleted", "newPath": null, "timestamp": T});
    assert_eq!(
        run(REMOVE_FILE, &[&p], &map),
        (expected, WatchOutcome::EmittedDeleted)
    );
    let after_remove = entry_of(&map, &p, "deleted").expect("emitted Remove records its kind");
    assert_eq!(run(CONTENT, &[&p], &map).1, WatchOutcome::EmittedModified);
    assert_eq!(entry_of(&map, &p, "deleted"), Some(after_remove));
}

#[test]
fn o10_ignored_outcomes_never_touch_the_map() {
    use WatchOutcome::{IgnoredKind, IgnoredNoPath, IgnoredRenameSinglePath};
    let mut ignored_inputs = 0;
    for kind in all_event_kinds() {
        for n in 0..=2 {
            let ps: Vec<PathBuf> = (0..n).map(|_| unique_path("o10")).collect();
            let refs: Vec<&PathBuf> = ps.iter().collect();
            let map = fresh();
            let (_, outcome) = run(kind, &refs, &map);
            if !matches!(
                outcome,
                IgnoredKind | IgnoredNoPath | IgnoredRenameSinglePath
            ) {
                continue;
            }
            ignored_inputs += 1;
            let label = format!("{kind:?} with {n} paths -> {outcome:?}");
            assert!(map.lock().unwrap().is_empty(), "{label}: map was touched");
            let follow = ps.first().cloned().unwrap_or_else(|| unique_path("o10"));
            assert_eq!(
                run(CONTENT, &[&follow], &map).1,
                WatchOutcome::EmittedModified,
                "{label}: follow-up modify was swallowed"
            );
        }
    }
    assert!(ignored_inputs > 0, "the domain must contain ignored inputs");
}

#[test]
fn o11_self_write_suppresses_modify_without_consuming_debounce() {
    let p = unique_path("o11");
    let map = fresh();
    let mark = WriteMark::new(&p);
    assert_eq!(
        run(CONTENT, &[&p], &map),
        (Value::Null, WatchOutcome::SelfWrite)
    );
    assert!(
        !map.lock().unwrap().keys().any(|(k, _)| k == &p),
        "self-write must not insert"
    );
    drop(mark);
    assert_eq!(run(CONTENT, &[&p], &map).1, WatchOutcome::EmittedModified);
}

#[test]
fn o12_self_write_dominates_a_live_debounce_entry() {
    let p = unique_path("o12");
    let seed = Instant::now();
    let map = seeded(&p, seed);
    let _mark = WriteMark::new(&p);
    assert_eq!(
        run(CONTENT, &[&p], &map),
        (Value::Null, WatchOutcome::SelfWrite)
    );
    assert_eq!(entry(&map, &p), Some(seed));
}

#[test]
fn o13_remove_and_rename_are_not_self_write_gated() {
    let p = unique_path("o13");
    let q = unique_path("o13");
    let _mark = WriteMark::new(&p);

    let (json, outcome) = run(REMOVE_FILE, &[&p], &fresh());
    assert_eq!(outcome, WatchOutcome::EmittedDeleted);
    assert_eq!(json["path"], json!(p.to_string_lossy()));

    assert_eq!(
        run(RENAME_BOTH, &[&p, &q], &fresh()).1,
        WatchOutcome::EmittedRenamed
    );

    let rename_any = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
    assert_eq!(
        run(rename_any, &[&p], &fresh()),
        (Value::Null, WatchOutcome::IgnoredRenameSinglePath)
    );
}
