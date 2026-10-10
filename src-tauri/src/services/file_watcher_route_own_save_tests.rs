//! D101: mdpro's own ⌘S is an atomic replace too (`atomic_write`: temp +
//! rename), and notify never marks its own events on macOS, so the save's
//! single-path rename (or create) event looks exactly like an external
//! replace (D68). It must never prompt: inside the save mark it is
//! `SelfWrite`; after the mark, `refresh_after_save` has stored the written
//! bytes, so it is `IgnoredUnchanged`. macOS only, for the save fixture's
//! `Dir` (it isolates `$HOME`, where `save_file_with` logs).
use super::super::baseline::fixture::{fresh, route};
use super::super::kinds_fixture::WriteMark;
use super::super::{snapshot, BaselineStore, WatchOutcome};
use crate::commands::file_save_fixture::{canon, save, Dir};
use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::Value;
use std::fs;

use WatchOutcome::{IgnoredUnchanged, SelfWrite};

/// The two shapes FSEvents gives the save's rename onto the watched path.
const REPLACED: [EventKind; 2] = [
    EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
    EventKind::Create(CreateKind::File),
];

/// OS1: after `save_file_with` returns (mark cleared, baseline refreshed to
/// the written bytes), the save's own replaced-file event is dropped as
/// unchanged: no emit, no debounce entry, baseline untouched. RED before
/// D68/D101 routing: `IgnoredRenameSinglePath` / `IgnoredKind`.
#[tokio::test]
async fn os1_event_after_a_completed_save_is_ignored_unchanged() {
    let d = Dir::new("os1");
    let p = d.file("doc.md", b"alpha\n");
    let store = BaselineStore::default();
    store.register(&p);

    save(&p, "beta beta\n", &store).await.expect("save");
    let after_save = store.get(&p);
    assert_eq!(after_save, Some(snapshot(&p)), "precondition: refreshed");

    let c = canon(&p);
    for kind in REPLACED {
        let map = fresh();
        assert_eq!(
            route(kind, &[&c], &map, &store),
            (Value::Null, IgnoredUnchanged),
            "{kind:?}"
        );
        assert!(map.lock().unwrap().is_empty(), "{kind:?}: debounce entry");
        assert_eq!(store.get(&p), after_save, "{kind:?}: baseline moved");
    }
}

/// OS2: the save's steps one at a time, as `save_file_with` orders them:
/// mark, rename a temp onto the path, refresh, unmark. Before the refresh
/// the baseline still holds the old bytes, so only the mark keeps the event
/// from emitting (`SelfWrite`); after the refresh it is still `SelfWrite`
/// while marked; once unmarked it is `IgnoredUnchanged`. Never a prompt.
#[test]
fn os2_event_inside_the_save_mark_is_self_write_then_unchanged_after() {
    let d = Dir::new("os2");
    let p = d.file("doc.md", b"alpha\n");
    let store = BaselineStore::default();
    store.register(&p);
    let c = canon(&p);
    let written: &[u8] = b"beta beta\n";
    let map = fresh();

    let mark = WriteMark::new(&c);
    let tmp = d.path().join(".doc.md.os2.tmp");
    fs::write(&tmp, written).expect("write temp");
    fs::rename(&tmp, &c).expect("rename temp over the file");
    for kind in REPLACED {
        assert_eq!(
            route(kind, &[&c], &map, &store),
            (Value::Null, SelfWrite),
            "{kind:?}: before the refresh"
        );
    }
    store.refresh_after_save(&c, written);
    for kind in REPLACED {
        assert_eq!(
            route(kind, &[&c], &map, &store),
            (Value::Null, SelfWrite),
            "{kind:?}: after the refresh, still marked"
        );
    }
    drop(mark);
    for kind in REPLACED {
        assert_eq!(
            route(kind, &[&c], &map, &store),
            (Value::Null, IgnoredUnchanged),
            "{kind:?}: after the mark"
        );
    }
    assert!(map.lock().unwrap().is_empty(), "no debounce entry");
}
