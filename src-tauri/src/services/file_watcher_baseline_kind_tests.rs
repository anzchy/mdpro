//! D32 WI-4b kind cases (matrix K1, K3, K4, K6): which Modify kinds the
//! unchanged-file drop applies to, the residual FSEvents burst, and a real
//! write after it. Real store, real temp files, synthetic events.
use super::super::kinds_fixture::all_event_kinds;
use super::super::WatchOutcome;
use super::fixture::{
    append, fresh, modified, route, TempDir, CONTENT, EXTENDED, FILTERED, META_ANY,
};
use super::{snapshot, BaselineStore};
use notify::event::{CreateKind, DataChange, MetadataKind, ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;

use WatchOutcome::{EmittedModified, IgnoredKind, IgnoredUnchanged};

fn registered(d: &TempDir, name: &str) -> (BaselineStore, PathBuf) {
    let p = d.file(name, b"hello world");
    let store = BaselineStore::default();
    store.register(&p);
    assert!(
        store.get(&p).and_then(|e| e.hash).is_some(),
        "precondition: registered with a hash"
    );
    assert!(store.is_unchanged(&p), "precondition: file is unchanged");
    (store, p)
}

/// K1: each filtered kind on an unchanged registered file is dropped, records
/// no debounce entry, and leaves the baseline bit-identical (frame, S4).
#[test]
fn k1_each_filtered_kind_on_an_unchanged_file_is_dropped() {
    let d = TempDir::new("k1");
    for (i, kind) in FILTERED.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("k{i}.md"));
        let before = store.get(&p);
        let map = fresh();
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (Value::Null, IgnoredUnchanged),
            "{kind:?}"
        );
        assert!(map.lock().unwrap().is_empty(), "{kind:?}: debounce entry");
        assert_eq!(store.get(&p), before, "{kind:?}: baseline moved");
        assert_eq!(store.len(), 1, "{kind:?}");
    }
}

/// The Modify subkinds that route exactly as before WI-4b (closed list).
const UNTOUCHED: [EventKind; 10] = [
    EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)),
    EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime)),
    EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions)),
    EventKind::Modify(ModifyKind::Metadata(MetadataKind::Ownership)),
    EventKind::Modify(ModifyKind::Metadata(MetadataKind::Other)),
    EventKind::Modify(ModifyKind::Data(DataChange::Any)),
    EventKind::Modify(ModifyKind::Data(DataChange::Size)),
    EventKind::Modify(ModifyKind::Data(DataChange::Other)),
    EventKind::Modify(ModifyKind::Any),
    EventKind::Modify(ModifyKind::Other),
];

/// Hand-written bucket for every `ModifyKind` leaf, with no wildcard below
/// `Modify`: a notify upgrade that adds a subkind fails to compile here.
fn bucket(kind: &EventKind) -> Option<&'static str> {
    use DataChange as D;
    use MetadataKind as M;
    let EventKind::Modify(m) = kind else {
        return None;
    };
    Some(match m {
        ModifyKind::Data(D::Content) | ModifyKind::Metadata(M::Any | M::Extended) => "filtered",
        ModifyKind::Data(D::Any | D::Size | D::Other)
        | ModifyKind::Metadata(
            M::AccessTime | M::WriteTime | M::Permissions | M::Ownership | M::Other,
        )
        | ModifyKind::Any
        | ModifyKind::Other => "untouched",
        ModifyKind::Name(
            RenameMode::Any
            | RenameMode::To
            | RenameMode::From
            | RenameMode::Both
            | RenameMode::Other,
        ) => "rename",
    })
}

/// K3 tripwire: UNTOUCHED + FILTERED + the five renames are exactly the
/// Modify leaves notify 6.1.1 defines, with no overlap.
#[test]
fn k3_untouched_list_plus_filtered_covers_every_modify_leaf() {
    let modify: Vec<EventKind> = all_event_kinds()
        .into_iter()
        .filter(|k| bucket(k).is_some())
        .collect();
    assert_eq!(modify.len(), 18, "notify 6.1.1 has 18 Modify leaves");
    let untouched: HashSet<EventKind> = UNTOUCHED.into_iter().collect();
    let filtered: HashSet<EventKind> = FILTERED.into_iter().collect();
    assert_eq!((untouched.len(), filtered.len()), (10, 3), "no duplicates");
    assert!(untouched.is_disjoint(&filtered));
    for k in &modify {
        let expected = match bucket(k) {
            Some("filtered") => (false, true),
            Some("untouched") => (true, false),
            _ => (false, false),
        };
        let got = (untouched.contains(k), filtered.contains(k));
        assert_eq!(got, expected, "{k:?}");
    }
}

/// K3: every untouched Modify subkind on an unchanged registered file emits
/// on a fresh debounce map, and the emit leaves the (equal) entry in place.
#[test]
fn k3_untouched_subkinds_on_an_unchanged_file_emit() {
    let d = TempDir::new("k3");
    for (i, kind) in UNTOUCHED.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("u{i}.md"));
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
        assert_eq!(store.get(&p), Some(snapshot(&p)), "{kind:?}");
    }
}

/// The residual FSEvents burst, in notify's callback order (ADR-0068 context).
const BURST: [EventKind; 4] = [
    EventKind::Create(CreateKind::File),
    META_ANY,
    EXTENDED,
    CONTENT,
];

/// Feed `BURST` for `p` on `map`, returning (outcomes, emitted count).
fn burst(
    p: &std::path::Path,
    map: &super::fixture::Map,
    store: &BaselineStore,
) -> (Vec<WatchOutcome>, usize) {
    let routed: Vec<(Value, WatchOutcome)> =
        BURST.iter().map(|k| route(*k, &[p], map, store)).collect();
    let emitted = routed.iter().filter(|(v, _)| !v.is_null()).count();
    (routed.into_iter().map(|(_, o)| o).collect(), emitted)
}

/// K4: the residual burst on an unchanged registered file emits nothing.
#[test]
fn k4_residual_burst_on_an_unchanged_file_emits_nothing() {
    let d = TempDir::new("k4");
    let (store, p) = registered(&d, "a.md");
    let before = store.get(&p);
    let map = fresh();
    let (outcomes, emitted) = burst(&p, &map, &store);
    assert_eq!(
        outcomes,
        vec![
            IgnoredKind,
            IgnoredUnchanged,
            IgnoredUnchanged,
            IgnoredUnchanged
        ]
    );
    assert_eq!(emitted, 0);
    assert!(
        map.lock().unwrap().is_empty(),
        "debounce map must stay empty"
    );
    assert_eq!(store.get(&p), before, "baseline unchanged");
}

/// K6: a drop never masks a later change: after K4's burst, a real append
/// and its Content event emit, and the baseline advances to the new bytes.
#[test]
fn k6_real_write_after_the_burst_emits_and_advances() {
    let d = TempDir::new("k6");
    let (store, p) = registered(&d, "a.md");
    let first = store.get(&p);
    let map = fresh();
    let (_, emitted) = burst(&p, &map, &store);
    assert_eq!(emitted, 0, "precondition: the burst was dropped");
    append(&p, b" and more");
    assert_eq!(
        route(CONTENT, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    assert_eq!(
        store.get(&p),
        Some(snapshot(&p)),
        "advanced to the new bytes"
    );
    assert_ne!(store.get(&p), first);
}
