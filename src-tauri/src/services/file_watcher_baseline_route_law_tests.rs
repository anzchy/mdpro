//! D32 WI-4/4b routing laws (matrix R11-R15): filter locality (S6), the advance
//! law (S5), a stale baseline after debounce (S5), no lost change (S4), and
//! the first-path rule. Real store, real temp files, synthetic events.
use super::super::kinds_fixture::{all_event_kinds, WriteMark};
use super::super::WatchOutcome;
use super::fixture::{
    append, fresh, modified, rewrite_keep_stat, route, seed, TempDir, CHMOD_CHOWN, CONTENT,
    EXTENDED, FILTERED, META_ANY,
};
use super::{snapshot, BaselineStore};
use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::EventKind;
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use WatchOutcome::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum State {
    Unchanged,
    ChangedSameStat,
    ChangedAppend,
    Unregistered,
}

/// A fresh registered (or not) file in the given on-disk state.
fn prepared(d: &TempDir, name: &str, state: State) -> (BaselineStore, PathBuf) {
    let p = d.file(name, b"hello world");
    let store = BaselineStore::default();
    if state != State::Unregistered {
        store.register(&p);
    }
    match state {
        State::ChangedSameStat => rewrite_keep_stat(&p, b"hello WORLD"),
        State::ChangedAppend => append(&p, b"!"),
        State::Unchanged | State::Unregistered => {}
    }
    (store, p)
}

/// R11 (law 1): a populated store changes the route only for the filtered
/// kinds (Metadata(Any), Extended, Content; ADR-0080 adds Permissions and
/// Ownership) and the replaced-file
/// kinds (any `Create`, a single-path `Name`; ADR-0072; any `Remove` on a
/// present path, D152) on an unchanged registered file with at least one
/// path, and then only to a drop.
#[test]
fn r11_filter_locality_over_every_kind_path_count_and_store_state() {
    use State::*;
    let d = TempDir::new("r11");
    let mut cells = 0;
    let mut differing = HashSet::new();
    for kind in all_event_kinds() {
        for n in 0..=2usize {
            for state in [Unchanged, ChangedSameStat, ChangedAppend, Unregistered] {
                cells += 1;
                let (store, p) = prepared(&d, &format!("c{cells}.md"), state);
                let q = d.path().join(format!("q{cells}.md"));
                let paths: Vec<&Path> = [p.as_path(), q.as_path()][..n].to_vec();
                let got = route(kind, &paths, &fresh(), &store);
                let reference = route(kind, &paths, &fresh(), &BaselineStore::default());
                if got != reference {
                    let tag = format!("{kind:?} x {n} x {state:?}");
                    assert_eq!(got, (Value::Null, IgnoredUnchanged), "{tag}");
                    assert_eq!(reference, (modified(&p), EmittedModified), "{tag}");
                    differing.insert((kind, n, state));
                }
            }
        }
    }
    assert_eq!(cells, 41 * 3 * 4);
    let creates_and_removes = all_event_kinds()
        .into_iter()
        .filter(|k| matches!(k, EventKind::Create(_) | EventKind::Remove(_)));
    let renames = all_event_kinds()
        .into_iter()
        .filter(|k| matches!(k, EventKind::Modify(ModifyKind::Name(_))));
    let expected: HashSet<_> = FILTERED
        .into_iter()
        .chain(CHMOD_CHOWN)
        .chain(creates_and_removes)
        .flat_map(|k| [(k, 1, Unchanged), (k, 2, Unchanged)])
        .chain(renames.map(|k| (k, 1, Unchanged)))
        .collect();
    assert_eq!(expected.len(), 6 + 4 + 8 + 8 + 5);
    assert_eq!(differing, expected);
}

#[derive(Clone, Copy)]
enum Paths {
    Zero,
    One,
    Two,
    /// One path, moved away before the event (ADR-0078: `deleted`).
    OneGone,
}

/// R12 (law 2): only an emitted `modified` advances the entry.
#[test]
// D157: an allow, not a type alias, so this recorded spec's lines stay unchanged.
#[allow(clippy::type_complexity)]
fn r12_ignored_event_does_not_advance_baseline() {
    let rows: [(&str, EventKind, Paths, bool, Option<u64>, WatchOutcome); 11] = [
        (
            "create",
            EventKind::Create(CreateKind::File),
            Paths::OneGone,
            false,
            None,
            IgnoredKind,
        ),
        ("no path", CONTENT, Paths::Zero, false, None, IgnoredNoPath),
        (
            "rename 1",
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            Paths::OneGone,
            false,
            None,
            EmittedDeleted,
        ),
        (
            "self-write data",
            CONTENT,
            Paths::One,
            true,
            None,
            SelfWrite,
        ),
        (
            "self-write ext",
            EXTENDED,
            Paths::One,
            true,
            None,
            SelfWrite,
        ),
        (
            "debounced data",
            CONTENT,
            Paths::One,
            false,
            Some(400),
            Debounced,
        ),
        (
            "debounced ext",
            EXTENDED,
            Paths::One,
            false,
            Some(400),
            Debounced,
        ),
        (
            "debounced any",
            META_ANY,
            Paths::One,
            false,
            Some(400),
            Debounced,
        ),
        (
            "remove",
            EventKind::Remove(RemoveKind::File),
            Paths::OneGone,
            false,
            None,
            EmittedDeleted,
        ),
        (
            "rename 2",
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            Paths::Two,
            false,
            None,
            EmittedRenamed,
        ),
        ("control", CONTENT, Paths::One, false, None, EmittedModified),
    ];
    let d = TempDir::new("r12");
    let mut targets = HashSet::new();
    for (i, (label, kind, paths, mark, live_ms, target)) in rows.into_iter().enumerate() {
        let (store, raw) = prepared(&d, &format!("r{i}.md"), State::ChangedAppend);
        // Canonical, so `get` still finds the entry once the file is gone.
        let p = std::fs::canonicalize(&raw).unwrap();
        let q = d.path().join(format!("q{i}.md"));
        let pre = store.get(&p);
        let map = fresh();
        if let Some(ms) = live_ms {
            seed(&map, &p, ms);
        }
        let _mark = mark.then(|| WriteMark::new(&p));
        let all = [p.as_path(), q.as_path()];
        let ps: &[&Path] = match paths {
            Paths::Zero => &[],
            Paths::One => &all[..1],
            Paths::Two => &all,
            Paths::OneGone => {
                std::fs::rename(&p, d.path().join(format!("gone{i}.md"))).unwrap();
                &all[..1]
            }
        };
        let (_, outcome) = route(kind, ps, &map, &store);
        assert_eq!(outcome, target, "{label}: row reached its target outcome");
        if target == EmittedModified {
            assert_eq!(store.get(&p), Some(snapshot(&p)), "{label}: advanced");
            assert_ne!(store.get(&p), pre, "{label}: the advance is visible");
        } else {
            assert_eq!(store.get(&p), pre, "{label}: must not advance");
        }
        targets.insert(target);
    }
    let expected: HashSet<WatchOutcome> = WatchOutcome::ALL
        .into_iter()
        .filter(|o| !matches!(o, IgnoredUnchanged))
        .collect();
    assert_eq!(targets, expected);
}

/// R13: a debounced write leaves the stale entry, so the next Extended emits.
#[test]
fn r13_debounced_data_does_not_advance_baseline() {
    let d = TempDir::new("r13");
    let (store, p) = prepared(&d, "a.md", State::Unchanged);
    let v1 = store.get(&p);
    let map = fresh();
    seed(&map, &p, 400);
    std::fs::write(&p, b"v2-longer-than-before").unwrap();
    assert_eq!(route(CONTENT, &[&p], &map, &store).1, Debounced);
    assert_eq!(store.get(&p), v1, "debounced must not advance");
    seed(&map, &p, 600);
    assert_eq!(
        route(EXTENDED, &[&p], &map, &store),
        (modified(&p), EmittedModified)
    );
    assert_eq!(store.get(&p), Some(snapshot(&p)));
}

/// R14 (law 3): a real change reaches the frontend at least once, over seed
/// state x every ordered pair of filtered kinds x change shape. "Live for
/// both events" is today's debounce behaviour and is excluded on purpose.
#[test]
fn r14_data_then_metadata_emits_at_least_once() {
    let d = TempDir::new("r14");
    let mut cells = 0;
    for seed_state in ["fresh", "expired", "live-then-expired"] {
        let orders = FILTERED.into_iter().flat_map(|a| {
            FILTERED
                .into_iter()
                .filter(move |b| *b != a)
                .map(move |b| [a, b])
        });
        for order in orders {
            for shape in [State::ChangedAppend, State::ChangedSameStat] {
                cells += 1;
                let (store, p) = prepared(&d, &format!("c{cells}.md"), shape);
                let map = fresh();
                match seed_state {
                    "expired" => seed(&map, &p, 600),
                    "live-then-expired" => seed(&map, &p, 400),
                    _ => {}
                }
                let first = route(order[0], &[&p], &map, &store).1;
                if seed_state == "live-then-expired" {
                    seed(&map, &p, 600);
                }
                let second = route(order[1], &[&p], &map, &store).1;
                let seq = [first, second];
                let tag = format!("{seed_state} x {order:?} x {shape:?}: {seq:?}");
                assert!(seq.contains(&EmittedModified), "{tag}");
                if seed_state == "fresh" && order[0] == CONTENT && shape == State::ChangedAppend {
                    // The emit advances the baseline (ADR-0068 decision 4), and the
                    // drop runs before the debounce (decision 1).
                    assert_eq!(seq, [EmittedModified, IgnoredUnchanged], "anchor {tag}");
                }
            }
        }
    }
    assert_eq!(cells, 3 * 6 * 2);
}

/// R15: the drop decision uses `paths[0]` only.
#[test]
fn r15_extra_path_is_irrelevant_to_the_drop() {
    let d = TempDir::new("r15");
    let p = d.file("p.md", b"abc");
    let q = d.file("q.md", b"abc");
    let store = BaselineStore::default();
    store.register(&p);
    store.register(&q);
    append(&q, b"!");
    for paths in [vec![p.as_path()], vec![p.as_path(), q.as_path()]] {
        assert_eq!(
            route(EXTENDED, &paths, &fresh(), &store),
            (Value::Null, IgnoredUnchanged),
            "{paths:?}"
        );
    }
    assert_eq!(
        route(EXTENDED, &[&q, &p], &fresh(), &store),
        (modified(&q), EmittedModified)
    );
}
