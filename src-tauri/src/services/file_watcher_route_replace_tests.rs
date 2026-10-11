//! D68: an atomic replace of the watched file (write a temp, rename it over
//! the file, as external editors save) reaches the watcher on macOS as a
//! single-path `Modify(Name(_))` or a `Create(_)` whose path still exists.
//! It routes like a content modification: self-write gate, the D32
//! unchanged drop, debounce, then `modified`. A single-path rename whose path
//! is gone (moved away) is `deleted` (D107, ADR-0078), and a `Create` on a
//! missing path is still `IgnoredKind`. Real store, real temp
//! files, synthetic events through `process_event`.
use super::super::baseline::fixture::{fresh, h, modified, mtime, route, seed, set_mtime, TempDir};
use super::super::kinds_fixture::T;
use super::super::{snapshot, BaselineStore, WatchOutcome};
use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use WatchOutcome::{
    Debounced, EmittedDeleted, EmittedModified, EmittedRenamed, IgnoredKind, IgnoredUnchanged,
};

const RENAME_ANY: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
const CREATE_FILE: EventKind = EventKind::Create(CreateKind::File);
/// The two shapes FSEvents gives a file another inode was renamed onto.
const REPLACED: [EventKind; 2] = [RENAME_ANY, CREATE_FILE];
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
/// Inside `DEBOUNCE_INTERVAL` (500 ms).
const LIVE_MS: u64 = 100;
/// How far back an older mtime is set; well past any filesystem granularity.
const OLDER_SECS: u64 = 5;

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

/// An external editor's atomic save: write `bytes` to a sibling temp file,
/// give it `mtime` when asked, and rename it over `target`. Asserts the
/// target now names a new inode.
fn replace_with(target: &Path, bytes: &[u8], mtime: Option<std::time::SystemTime>) {
    let ino_before = fs::metadata(target).expect("target exists").ino();
    let tmp = target.with_extension("md.tmp");
    fs::write(&tmp, bytes).expect("write temp");
    if let Some(t) = mtime {
        set_mtime(&tmp, t);
    }
    fs::rename(&tmp, target).expect("rename temp over target");
    assert!(!tmp.exists(), "precondition: the temp was renamed away");
    assert_ne!(
        fs::metadata(target).expect("target exists").ino(),
        ino_before,
        "precondition: a new inode now has the watched name"
    );
}

/// RP1: different bytes renamed over a registered file: both event shapes
/// emit `modified` (no `newPath`), mark the debounce map, and advance the
/// baseline to the new bytes. RED before D68: `IgnoredRenameSinglePath` /
/// `IgnoredKind`.
#[test]
fn rp1_replace_with_different_bytes_emits_modified_and_advances() {
    let d = TempDir::new("rp1");
    for (i, kind) in REPLACED.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("a{i}.md"), b"old bytes");
        replace_with(&p, b"new bytes from elsewhere", None);
        let map = fresh();
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
        assert!(
            map.lock().unwrap().contains_key(&(p.clone(), "modified")),
            "{kind:?}: debounce"
        );
        let entry = store.get(&p).expect("still registered");
        assert_eq!(entry, snapshot(&p), "{kind:?}: advanced to the disk");
        assert_eq!(entry.hash, h(b"new bytes from elsewhere"), "{kind:?}");
    }
}

/// RP2: every rename mode and every create kind on an existing replaced file
/// routes the same way.
#[test]
fn rp2_every_single_path_rename_mode_and_create_kind_routes_as_modified() {
    let d = TempDir::new("rp2");
    let kinds = RENAME_MODES
        .map(|m| EventKind::Modify(ModifyKind::Name(m)))
        .into_iter()
        .chain(CREATE_KINDS.map(EventKind::Create));
    for (i, kind) in kinds.enumerate() {
        let (store, p) = registered(&d, &format!("m{i}.md"), b"old");
        replace_with(&p, b"new and longer", None);
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
    }
}

/// RP3: identical bytes with the original mtime kept (`cp -p` then `mv`):
/// the D32 drop applies, no emit, no debounce entry, baseline untouched.
#[test]
fn rp3_replace_with_identical_bytes_and_stat_is_ignored_unchanged() {
    let d = TempDir::new("rp3");
    for (i, kind) in REPLACED.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("s{i}.md"), b"same bytes");
        let before = store.get(&p);
        replace_with(&p, b"same bytes", Some(mtime(&p)));
        let map = fresh();
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (Value::Null, IgnoredUnchanged),
            "{kind:?}"
        );
        assert!(map.lock().unwrap().is_empty(), "{kind:?}: debounce");
        assert_eq!(store.get(&p), before, "{kind:?}: baseline moved");
    }
}

/// RP4: identical bytes but a different mtime fail open: the baseline
/// compares the stat as well as the hash, so the event emits.
#[test]
fn rp4_replace_with_identical_bytes_but_new_mtime_emits() {
    let d = TempDir::new("rp4");
    for (i, kind) in REPLACED.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("t{i}.md"), b"same bytes");
        let older = mtime(&p) - Duration::from_secs(OLDER_SECS);
        replace_with(&p, b"same bytes", Some(older));
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
    }
}

/// RP5: the watched file moved away (its path is gone): a single-path
/// rename is `deleted` (D107, ADR-0078; was `IgnoredRenameSinglePath`),
/// with a `deleted` debounce entry and the store entry kept.
#[test]
fn rp5_single_path_rename_of_a_moved_away_file_is_deleted() {
    let d = TempDir::new("rp5");
    for (i, mode) in RENAME_MODES.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("g{i}.md"), b"bytes");
        fs::rename(&p, d.path().join(format!("elsewhere{i}.md"))).expect("move away");
        assert!(!p.exists(), "precondition: path is gone");
        let map = fresh();
        assert_eq!(
            route(
                EventKind::Modify(ModifyKind::Name(mode)),
                &[&p],
                &map,
                &store
            ),
            (
                json!({"path": p.to_string_lossy(), "changeType": "deleted", "newPath": null, "timestamp": T}),
                EmittedDeleted
            ),
            "{mode:?}"
        );
        assert!(
            map.lock().unwrap().contains_key(&(p.clone(), "deleted")),
            "{mode:?}: debounce"
        );
        assert_eq!(store.len(), 1, "{mode:?}: entry kept");
    }
}

/// RP6: a `Create` on a path that does not exist is still `IgnoredKind`.
#[test]
fn rp6_create_on_a_missing_path_is_ignored_kind() {
    let d = TempDir::new("rp6");
    let p = d.path().join("never.md");
    let store = BaselineStore::default();
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

/// RP7: a two-path rename is unchanged: `renamed` with the destination.
#[test]
fn rp7_two_path_rename_still_emits_renamed() {
    let d = TempDir::new("rp7");
    let (store, p) = registered(&d, "from.md", b"bytes");
    let q = d.path().join("to.md");
    fs::rename(&p, &q).expect("rename");
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

/// RP8: an unregistered existing path has no baseline, which fails open:
/// `modified` is emitted and the store still has no entry for it.
#[test]
fn rp8_unregistered_existing_path_emits_modified_and_inserts_nothing() {
    let d = TempDir::new("rp8");
    let p = d.file("loose.md", b"bytes");
    let store = BaselineStore::default();
    for kind in REPLACED {
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
        assert_eq!(store.len(), 0, "{kind:?}: refresh never inserts");
    }
}

/// RP9: debounce is shared with the other kinds: a replaced-file event on a
/// live entry is `Debounced` and does not advance the baseline; a second
/// replaced event right after an emitted one is debounced too.
#[test]
fn rp9_replaced_file_events_share_the_debounce_map() {
    let d = TempDir::new("rp9");
    for (i, kind) in REPLACED.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("d{i}.md"), b"old");
        let before = store.get(&p);
        replace_with(&p, b"new bytes", None);
        let map = fresh();
        seed(&map, &p, LIVE_MS);
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (Value::Null, Debounced),
            "{kind:?}"
        );
        assert_eq!(store.get(&p), before, "{kind:?}: debounced, not advanced");

        let map = fresh();
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (modified(&p), EmittedModified)
        );
        replace_with(&p, b"newer bytes again", None);
        assert_eq!(
            route(kind, &[&p], &map, &store),
            (Value::Null, Debounced),
            "{kind:?}: second event inside the interval"
        );
    }
}
