//! Characterization tests for `services::file_watcher::process_event`
//! (D32 WI-2: o2-o6, o14).
//!
//! Wired from `file_watcher.rs` with `#[cfg(test)] #[path = ...] mod tests;`.
//! These pin the routing exactly as it was before the extraction; the gate
//! state laws (debounce, self-write) live in `file_watcher_gate_tests.rs`.

use super::baseline::BaselineStore;
use super::kinds_fixture::{
    all_event_kinds, code_lines, fn_slice, is_bare_binding_arm, unique_path, T,
};
use super::{process_event, WatchOutcome};
use notify::event::{
    AccessKind, AccessMode, CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind,
    RenameMode,
};
use notify::{Event, EventKind};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

type Map = Mutex<HashMap<(PathBuf, &'static str), Instant>>;

const RENAME_MODES: [RenameMode; 5] = [
    RenameMode::Any,
    RenameMode::To,
    RenameMode::From,
    RenameMode::Both,
    RenameMode::Other,
];

fn fresh() -> Map {
    Mutex::new(HashMap::new())
}

// `&PathBuf` so it composes with the `Vec<PathBuf>` / `Option<&PathBuf>` the cases hold.
#[allow(clippy::ptr_arg)]
fn s(p: &PathBuf) -> String {
    p.to_string_lossy().to_string()
}

fn paths(label: &str, n: usize) -> Vec<PathBuf> {
    (0..n).map(|_| unique_path(label)).collect()
}

fn run(kind: EventKind, paths: &[PathBuf], map: &Map) -> (Value, WatchOutcome) {
    let event = paths
        .iter()
        .fold(Event::new(kind), |ev, p| ev.add_path(p.clone()));
    let (emitted, outcome) = process_event(&event, map, &BaselineStore::default(), T);
    (serde_json::to_value(&emitted).unwrap(), outcome)
}

fn emitted(path: &PathBuf, change_type: &str, new_path: Option<&PathBuf>) -> Value {
    json!({"path": s(path), "changeType": change_type, "newPath": new_path.map(s), "timestamp": T})
}

/// Written by hand, not derived from `all_event_kinds()`.
fn table() -> Vec<(EventKind, WatchOutcome)> {
    use AccessKind as A;
    use AccessMode as M;
    use EventKind::{Access, Create, Modify, Remove};
    use ModifyKind::{Data, Metadata, Name};
    use WatchOutcome::{EmittedDeleted, EmittedModified, IgnoredKind, IgnoredRenameSinglePath};
    vec![
        (EventKind::Any, IgnoredKind),
        (EventKind::Other, IgnoredKind),
        (Access(A::Any), IgnoredKind),
        (Access(A::Read), IgnoredKind),
        (Access(A::Other), IgnoredKind),
        (Access(A::Open(M::Any)), IgnoredKind),
        (Access(A::Open(M::Execute)), IgnoredKind),
        (Access(A::Open(M::Read)), IgnoredKind),
        (Access(A::Open(M::Write)), IgnoredKind),
        (Access(A::Open(M::Other)), IgnoredKind),
        (Access(A::Close(M::Any)), IgnoredKind),
        (Access(A::Close(M::Execute)), IgnoredKind),
        (Access(A::Close(M::Read)), IgnoredKind),
        (Access(A::Close(M::Write)), IgnoredKind),
        (Access(A::Close(M::Other)), IgnoredKind),
        (Create(CreateKind::Any), IgnoredKind),
        (Create(CreateKind::File), IgnoredKind),
        (Create(CreateKind::Folder), IgnoredKind),
        (Create(CreateKind::Other), IgnoredKind),
        (Modify(ModifyKind::Any), EmittedModified),
        (Modify(ModifyKind::Other), EmittedModified),
        (Modify(Data(DataChange::Any)), EmittedModified),
        (Modify(Data(DataChange::Size)), EmittedModified),
        (Modify(Data(DataChange::Content)), EmittedModified),
        (Modify(Data(DataChange::Other)), EmittedModified),
        // Routed with an empty baseline store, so every row is unchanged by
        // D32; the three-kind unchanged filter is pinned by route-law R11.
        (Modify(Metadata(MetadataKind::Any)), EmittedModified),
        (Modify(Metadata(MetadataKind::AccessTime)), EmittedModified),
        (Modify(Metadata(MetadataKind::WriteTime)), EmittedModified),
        (Modify(Metadata(MetadataKind::Permissions)), EmittedModified),
        (Modify(Metadata(MetadataKind::Ownership)), EmittedModified),
        (Modify(Metadata(MetadataKind::Extended)), EmittedModified),
        (Modify(Metadata(MetadataKind::Other)), EmittedModified),
        (Modify(Name(RenameMode::Any)), IgnoredRenameSinglePath),
        (Modify(Name(RenameMode::To)), IgnoredRenameSinglePath),
        (Modify(Name(RenameMode::From)), IgnoredRenameSinglePath),
        (Modify(Name(RenameMode::Both)), IgnoredRenameSinglePath),
        (Modify(Name(RenameMode::Other)), IgnoredRenameSinglePath),
        (Remove(RemoveKind::Any), EmittedDeleted),
        (Remove(RemoveKind::File), EmittedDeleted),
        (Remove(RemoveKind::Folder), EmittedDeleted),
        (Remove(RemoveKind::Other), EmittedDeleted),
    ]
}

#[test]
fn o2_characterizes_all_41_kinds_with_one_path() {
    let rows = table();
    assert_eq!(rows.len(), 41);
    let table_kinds: HashSet<EventKind> = rows.iter().map(|(k, _)| *k).collect();
    let fixture_kinds: HashSet<EventKind> = all_event_kinds().into_iter().collect();
    assert_eq!(
        table_kinds, fixture_kinds,
        "table must cover the fixture domain"
    );

    for (kind, expected) in rows {
        let p = unique_path("o2");
        let (json, outcome) = run(kind, std::slice::from_ref(&p), &fresh());
        let expected_json = match expected {
            WatchOutcome::EmittedModified => emitted(&p, "modified", None),
            WatchOutcome::EmittedDeleted => emitted(&p, "deleted", None),
            _ => Value::Null,
        };
        assert_eq!(json, expected_json, "emitted for {kind:?}");
        assert_eq!(outcome, expected, "outcome for {kind:?}");
    }
}

#[test]
fn o3_rename_with_two_or_more_paths_emits_renamed_for_every_mode() {
    for mode in RENAME_MODES {
        for n in [2, 3] {
            let ps = paths("o3", n);
            let map = fresh();
            let (json, outcome) = run(EventKind::Modify(ModifyKind::Name(mode)), &ps, &map);
            let label = format!("{mode:?} with {n} paths");
            assert_eq!(json, emitted(&ps[0], "renamed", Some(&ps[1])), "{label}");
            assert_eq!(outcome, WatchOutcome::EmittedRenamed, "{label}");
            let map = map.lock().unwrap();
            assert!(
                map.contains_key(&(ps[0].clone(), "renamed")),
                "{label}: source is debounce key"
            );
            assert!(
                !map.keys().any(|(k, _)| k == &ps[1]),
                "{label}: destination is not"
            );
        }
    }
}

#[test]
fn o4_path_count_boundaries() {
    use WatchOutcome::{IgnoredKind, IgnoredNoPath};
    let zero_path_rows = [
        (
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            IgnoredNoPath,
        ),
        (
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)),
            IgnoredNoPath,
        ),
        (EventKind::Remove(RemoveKind::File), IgnoredNoPath),
        (
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            IgnoredNoPath,
        ),
        (
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            IgnoredNoPath,
        ),
        (EventKind::Access(AccessKind::Read), IgnoredKind),
        (EventKind::Create(CreateKind::File), IgnoredKind),
        (EventKind::Any, IgnoredKind),
    ];
    for (kind, expected) in zero_path_rows {
        assert_eq!(
            run(kind, &[], &fresh()),
            (Value::Null, expected),
            "{kind:?} with 0 paths"
        );
    }
    let one = paths("o4", 1);
    assert_eq!(
        run(
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            &one,
            &fresh()
        ),
        (Value::Null, WatchOutcome::IgnoredRenameSinglePath)
    );
}

#[test]
fn o5_emission_agrees_with_outcome_over_all_kinds_and_path_counts() {
    for kind in all_event_kinds() {
        for n in 0..=2 {
            let ps = paths("o5", n);
            let event = ps
                .iter()
                .fold(Event::new(kind), |ev, p| ev.add_path(p.clone()));
            let (em, outcome) = process_event(&event, &fresh(), &BaselineStore::default(), T);
            let label = format!("{kind:?} with {n} paths -> {outcome:?}");
            let change_type = match outcome {
                WatchOutcome::EmittedModified => Some("modified"),
                WatchOutcome::EmittedDeleted => Some("deleted"),
                WatchOutcome::EmittedRenamed => Some("renamed"),
                _ => None,
            };
            assert_eq!(em.is_some(), change_type.is_some(), "{label}");
            if let Some(em) = em {
                assert_eq!(Some(em.change_type.as_str()), change_type, "{label}");
                assert_eq!(em.path, s(&ps[0]), "{label}");
                assert_eq!(em.timestamp, T, "{label}");
                let expected_new = (outcome == WatchOutcome::EmittedRenamed).then(|| s(&ps[1]));
                assert_eq!(em.new_path, expected_new, "{label}");
            }
        }
    }
}

#[test]
fn o6_extra_path_is_irrelevant_for_non_name_kinds() {
    let kinds = all_event_kinds()
        .into_iter()
        .filter(|k| !matches!(k, EventKind::Modify(ModifyKind::Name(_))));
    for kind in kinds {
        let p = unique_path("o6");
        let q = unique_path("o6");
        let a = run(kind, std::slice::from_ref(&p), &fresh());
        let b = run(kind, &[p.clone(), q], &fresh());
        assert_eq!(a, b, "{kind:?}: a second path changed the result");
    }
}

#[test]
fn o14_process_event_has_no_wildcard_or_bare_binding_arm() {
    let slice = fn_slice(include_str!("file_watcher_route.rs"), "fn process_event");
    assert!(!slice.trim().is_empty(), "process_event slice is empty");
    let offending: Vec<&str> = code_lines(slice)
        .filter(|l| is_bare_binding_arm(l))
        .collect();
    assert!(offending.is_empty(), "catch-all arms: {offending:?}");
    for explicit in [
        "EventKind::Any",
        "EventKind::Access(",
        "EventKind::Create(",
        "EventKind::Other",
    ] {
        assert!(
            slice.contains(explicit),
            "process_event must name `{explicit}`"
        );
    }
}
