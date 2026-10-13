//! D190-WI-2 (ADR-0093) companion fix 2: notify 6 maps Windows'
//! FILE_ACTION_MODIFIED to `Modify(Any)`, which ADR-0068 decision 1 left
//! out of the unchanged-file drop. On Windows it is eligible, behind the same
//! baseline check, so the write events around our own save do not prompt;
//! on every other host the kind set is bit-identical. Real store, real temp
//! files, synthetic events; the Windows routing runs through `with_windows`.
use super::super::baseline::fixture::{append, fresh, modified, route, TempDir};
use super::super::baseline::is_filtered_kind_on;
use super::super::baseline::seam::with_windows;
use super::super::kinds_fixture::{all_event_kinds, WriteMark};
use super::super::{BaselineStore, WatchOutcome};
use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::EventKind;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use WatchOutcome::{EmittedModified, IgnoredUnchanged};

const MODIFY_ANY: EventKind = EventKind::Modify(ModifyKind::Any);

/// The five kinds ADR-0068 decision 1 and ADR-0080 name.
fn unix_kinds() -> [EventKind; 5] {
    use EventKind::Modify as M;
    use ModifyKind::{Data, Metadata};
    [
        M(Metadata(MetadataKind::Extended)),
        M(Metadata(MetadataKind::Any)),
        M(Metadata(MetadataKind::Ownership)),
        M(Metadata(MetadataKind::Permissions)),
        M(Data(DataChange::Content)),
    ]
}

fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = d.file(name, bytes);
    let store = BaselineStore::default();
    store.register(&p);
    (store, fs::canonicalize(&p).expect("canonicalize"))
}

/// `save_file_with`'s order: mark, temp + rename, refresh, unmark.
fn own_save(c: &Path, written: &[u8], store: &BaselineStore) {
    let mark = WriteMark::new(c);
    let tmp = c.with_file_name(format!(".m.{}.tmp", std::process::id()));
    let mut f = fs::File::create(&tmp).expect("temp");
    f.write_all(written).expect("write temp");
    drop(f);
    fs::rename(&tmp, c).expect("rename over");
    store.refresh_after_save(c, written);
    drop(mark);
}

/// M1 (S4, exhaustive over every notify kind): off Windows the set is
/// exactly ADR-0080's five; on Windows it is those five plus `Modify(Any)`.
#[test]
fn m1_windows_adds_exactly_modify_any_to_the_kind_set() {
    let unix = unix_kinds();
    for kind in all_event_kinds() {
        let base = unix.contains(&kind);
        assert_eq!(
            is_filtered_kind_on(&kind, false),
            base,
            "other host {kind:?}"
        );
        assert_eq!(
            is_filtered_kind_on(&kind, true),
            base || kind == MODIFY_ANY,
            "Windows {kind:?}"
        );
    }
}

/// M2: on Windows, a `Modify(Any)` after our own save is dropped by the
/// unchanged check: no emit, no debounce entry.
#[test]
fn m2_windows_modify_any_after_our_save_is_ignored_unchanged() {
    with_windows(|| {
        let d = TempDir::new("m2");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        let map = fresh();
        assert_eq!(
            route(MODIFY_ANY, &[&c], &map, &store),
            (Value::Null, IgnoredUnchanged)
        );
        assert!(map.lock().unwrap().is_empty(), "debounce entry");
    });
}

/// M3 (control): on Windows, a real external write reported as `Modify(Any)`
/// still emits after the check.
#[test]
fn m3_windows_modify_any_for_a_real_write_still_emits() {
    with_windows(|| {
        let d = TempDir::new("m3");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        append(&c, b"tail\n");
        assert_eq!(
            route(MODIFY_ANY, &[&c], &fresh(), &store),
            (modified(&c), EmittedModified)
        );
    });
}

/// M4 (control, other hosts bit-identical): off Windows, `Modify(Any)` is
/// never checked, so it emits even on an unchanged file.
#[test]
fn m4_other_hosts_still_emit_modify_any_unchecked() {
    let d = TempDir::new("m4");
    let (store, c) = registered(&d, "doc.md", b"alpha\n");
    own_save(&c, b"alpha beta\n", &store);
    assert_eq!(
        route(MODIFY_ANY, &[&c], &fresh(), &store),
        (modified(&c), EmittedModified)
    );
}

/// M5 (control): on Windows, `Modify(Any)` on a file that is gone fails
/// open and emits, as on every host today.
#[test]
fn m5_windows_modify_any_on_a_missing_file_still_emits() {
    with_windows(|| {
        let d = TempDir::new("m5");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        fs::remove_file(&c).expect("delete");
        assert_eq!(
            route(MODIFY_ANY, &[&c], &fresh(), &store).1,
            EmittedModified
        );
    });
}
