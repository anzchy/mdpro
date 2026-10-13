//! D190-WI-2 (Windows audit W2): on Windows every ⌘S raised "External change
//! detected". `atomic_write` renames a temp over the file; notify 6 maps
//! ReadDirectoryChangesW's answer, filtered to the watched file, to a
//! `Remove(Any)` (FILE_ACTION_REMOVED, the replaced target) and a
//! `Modify(Name(To))` (FILE_ACTION_RENAMED_NEW_NAME). The device run saw the
//! `Remove` inside the save mark (`self_write`) and the rename-to after it,
//! where the unchanged check answered `unstable` and the event emitted.
//!
//! These cases run the route on the macOS host with the read judged by the
//! off-Unix stability proof (`with_portable_proof`), real files, a real
//! store and synthetic notify events; nothing is mocked. The own-save cases
//! say mdpro's own save never emits; the controls say a real external
//! change, a replace that swaps the file during the read, and a delete
//! (ADR-0078) still do.
use super::super::baseline::fixture::{
    append, fresh, modified, mtime, rewrite_keep_stat, route, set_mtime, varied, TempDir, CONTENT,
};
use super::super::baseline::seam::with_portable_proof;
use super::super::kinds_fixture::WriteMark;
use super::super::{BaselineStore, WatchOutcome};
use notify::event::{ModifyKind, RemoveKind, RenameMode};
use notify::EventKind;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use WatchOutcome::{EmittedDeleted, EmittedModified, IgnoredUnchanged, SelfWrite};

/// FILE_ACTION_REMOVED on the replaced target.
const REMOVE: EventKind = EventKind::Remove(RemoveKind::Any);
/// FILE_ACTION_RENAMED_NEW_NAME on the target.
const NAME_TO: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::To));
/// FILE_ACTION_RENAMED_OLD_NAME, seen on the watched path when it is moved away.
const NAME_FROM: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::From));
/// FILE_ACTION_MODIFIED: an in-place write.
const MODIFY_ANY: EventKind = EventKind::Modify(ModifyKind::Any);
/// What notify reports on Windows for one `atomic_write` onto the watched
/// file, in order (docs/test/windows-audit-20261012-claude/run-notes.md, 016).
const WINDOWS_SAVE: [EventKind; 2] = [REMOVE, NAME_TO];

/// `name` holding `bytes` in `d`, registered in a fresh store (under
/// whatever proof the caller runs in); returns the canonical path, the
/// spelling `save_file_with` marks and refreshes.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = d.file(name, bytes);
    let store = BaselineStore::default();
    store.register(&p);
    (store, fs::canonicalize(&p).expect("canonicalize"))
}

/// `atomic_write`'s rename: a fresh same-directory temp holding `bytes`,
/// renamed over `target`.
fn rename_over(target: &Path, bytes: &[u8]) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let name = target.file_name().unwrap().to_string_lossy().to_string();
    let n = N.fetch_add(1, Ordering::Relaxed);
    let tmp = target.with_file_name(format!(".{name}.{}.{n}.tmp", std::process::id()));
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .expect("create temp");
    f.write_all(bytes).expect("write temp");
    f.sync_all().expect("sync temp");
    drop(f);
    fs::rename(&tmp, target).expect("rename temp over the file");
}

/// `save_file_with`'s steps in its order: mark, `atomic_write`,
/// `refresh_after_save`, then `inside` (events the OS delivers while the
/// mark is held), then unmark.
fn own_save_with(c: &Path, written: &[u8], store: &BaselineStore, inside: impl FnOnce()) {
    let mark = WriteMark::new(c);
    rename_over(c, written);
    store.refresh_after_save(c, written);
    inside();
    drop(mark);
}

fn own_save(c: &Path, written: &[u8], store: &BaselineStore) {
    own_save_with(c, written, store, || {});
}

/// The change type of an emitted payload, or `None` for no emit.
fn change_type(v: &Value) -> Option<String> {
    v.get("changeType")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// W1: the Windows sequence for our own save, both events delivered after
/// the save returned (mark cleared, baseline refreshed to the written
/// bytes): neither emits, both are `IgnoredUnchanged`, no debounce entry.
/// RED today: the off-Unix read is never stable, the check answers
/// `unstable` and the `Remove` emits `modified`.
#[test]
fn w1_windows_save_events_after_the_save_are_ignored_unchanged() {
    with_portable_proof(|| {
        let d = TempDir::new("w1");
        let (store, c) = registered(&d, "work1.md", b"alpha\n");
        own_save(&c, b"alpha\nbeta\n", &store);
        let map = fresh();
        for kind in WINDOWS_SAVE {
            assert_eq!(
                route(kind, &[&c], &map, &store),
                (Value::Null, IgnoredUnchanged),
                "{kind:?}"
            );
        }
        assert!(map.lock().unwrap().is_empty(), "debounce entry recorded");
    });
}

/// W2: the interleave the device run logged: the `Remove` inside the mark
/// (`SelfWrite`), the rename-to after it, which must be `IgnoredUnchanged`.
/// RED today on the second leg (`unstable`, `emitted_modified`).
#[test]
fn w2_remove_inside_the_mark_then_rename_to_after_it_never_emits() {
    with_portable_proof(|| {
        let d = TempDir::new("w2");
        let (store, c) = registered(&d, "work1.md", b"alpha\n");
        let map = fresh();
        own_save_with(&c, b"alpha\nbeta\n", &store, || {
            assert_eq!(
                route(REMOVE, &[&c], &map, &store),
                (Value::Null, SelfWrite),
                "Remove inside the mark"
            );
        });
        assert_eq!(
            route(NAME_TO, &[&c], &map, &store),
            (Value::Null, IgnoredUnchanged),
            "Modify(Name(To)) after the mark"
        );
    });
}

/// W3 (S4 over payloads, S5 over successive saves): for each payload,
/// including empty, one byte, CRLF, a UTF-16LE BOM document and 64 KiB of
/// varied bytes, saved one after another onto the same file, the Windows
/// sequence after each save never emits. RED today.
#[test]
fn w3_successive_own_saves_of_any_payload_never_emit() {
    let crlf: &[u8] = b"# t\r\nline\r\n";
    let utf16: Vec<u8> = [0xFF, 0xFE]
        .into_iter()
        .chain("中文 ok\r\n".encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    let payloads: Vec<Vec<u8>> = vec![
        Vec::new(),
        b"x".to_vec(),
        crlf.to_vec(),
        utf16,
        varied(64 * 1024),
    ];
    with_portable_proof(|| {
        let d = TempDir::new("w3");
        let (store, c) = registered(&d, "work16.md", b"start\n");
        for (i, written) in payloads.iter().enumerate() {
            own_save(&c, written, &store);
            let map = fresh();
            for kind in WINDOWS_SAVE {
                let (emitted, outcome) = route(kind, &[&c], &map, &store);
                assert_eq!(emitted, Value::Null, "save {i}, {kind:?}: {outcome:?}");
            }
        }
    });
}

/// W4 (S6, metamorphic): the same own save and the same Windows sequence
/// give the same outcomes under the off-Unix proof as under the Unix one.
/// The Unix leg is green today (the macOS route already drops it); the
/// off-Unix leg is RED today.
#[test]
fn w4_own_save_outcomes_do_not_depend_on_the_platform_proof() {
    let run = || {
        let d = TempDir::new("w4");
        let (store, c) = registered(&d, "doc.md", b"one\n");
        own_save(&c, b"one two\n", &store);
        let map = fresh();
        WINDOWS_SAVE
            .iter()
            .map(|&kind| route(kind, &[&c], &map, &store).1)
            .collect::<Vec<_>>()
    };
    let unix = run();
    assert_eq!(
        unix,
        vec![IgnoredUnchanged, IgnoredUnchanged],
        "precondition: Unix"
    );
    assert_eq!(with_portable_proof(run), unix, "off-Unix proof");
}

/// W5: on Windows the watched spelling can differ from the canonical one the
/// save marks (`C:\…` from the dialog, `\\?\C:\…` from `canonicalize`), so
/// the self-write gate can miss; the unchanged check keys by canonical path
/// and must still drop our save. Here the event path goes through a
/// symlinked directory, the same shape. RED today.
#[test]
fn w5_own_save_reported_under_another_spelling_never_emits() {
    with_portable_proof(|| {
        let d = TempDir::new("w5");
        let real = d.path().join("real");
        let alias = d.path().join("alias");
        fs::create_dir(&real).expect("real dir");
        std::os::unix::fs::symlink(&real, &alias).expect("alias -> real");
        fs::write(real.join("doc.md"), b"alpha\n").expect("write");
        let store = BaselineStore::default();
        let spelled = alias.join("doc.md");
        store.register(&spelled);
        let c = fs::canonicalize(&spelled).expect("canonicalize");
        assert_ne!(c, spelled, "precondition: two spellings");
        let map = fresh();
        own_save_with(&c, b"alpha beta\n", &store, || {
            let (emitted, outcome) = route(REMOVE, &[&spelled], &map, &store);
            assert_eq!(emitted, Value::Null, "inside the mark: {outcome:?}");
        });
        let (emitted, outcome) = route(NAME_TO, &[&spelled], &map, &store);
        assert_eq!(emitted, Value::Null, "after the mark: {outcome:?}");
    });
}

/// C1 (control): after our save, an external editor's atomic save with
/// other bytes still prompts: the `Remove` emits `modified` and the
/// rename-to that follows adds no second prompt.
#[test]
fn c1_external_atomic_replace_with_other_bytes_still_emits() {
    with_portable_proof(|| {
        let d = TempDir::new("c1");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        rename_over(&c, b"someone else\n");
        let map = fresh();
        assert_eq!(
            route(REMOVE, &[&c], &map, &store),
            (modified(&c), EmittedModified)
        );
        assert_eq!(route(NAME_TO, &[&c], &map, &store).0, Value::Null);
    });
}

/// C2 (control): after our save, an in-place external write still prompts:
/// an append (`Modify(Any)`), and a same-length rewrite that restores the
/// mtime reported as a checked kind, which only the hash can tell.
#[test]
fn c2_external_in_place_write_after_the_save_still_emits() {
    with_portable_proof(|| {
        let d = TempDir::new("c2");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        append(&c, b"tail\n");
        assert_eq!(
            route(MODIFY_ANY, &[&c], &fresh(), &store),
            (modified(&c), EmittedModified),
            "append"
        );

        let (store, c) = registered(&d, "same.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        rewrite_keep_stat(&c, b"ALPHA BETA\n");
        assert_eq!(
            route(CONTENT, &[&c], &fresh(), &store),
            (modified(&c), EmittedModified),
            "same-length rewrite, mtime restored"
        );
    });
}

/// C3 (control, ADR-0078): after our save, an external delete or move-away
/// still reports `deleted`.
#[test]
fn c3_external_delete_or_move_away_still_reports_deleted() {
    with_portable_proof(|| {
        let d = TempDir::new("c3");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        fs::remove_file(&c).expect("delete");
        let (emitted, outcome) = route(REMOVE, &[&c], &fresh(), &store);
        assert_eq!(
            (change_type(&emitted), outcome),
            (Some("deleted".into()), EmittedDeleted)
        );

        let (store, c) = registered(&d, "moved.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        fs::rename(&c, d.path().join("elsewhere.md")).expect("move away");
        let (emitted, outcome) = route(NAME_FROM, &[&c], &fresh(), &store);
        assert_eq!(
            (change_type(&emitted), outcome),
            (Some("deleted".into()), EmittedDeleted)
        );
    });
}

/// C4 (control, the read's law): a file swapped in under the path during
/// the check's read is never proven unchanged, even with the same bytes,
/// size and mtime; only the file's identity differs.
#[test]
fn c4_a_file_swapped_in_during_the_read_is_never_unchanged() {
    with_portable_proof(|| {
        let d = TempDir::new("c4");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        let written: &[u8] = b"alpha beta\n";
        own_save(&c, written, &store);
        let target = c.clone();
        let swap = move || {
            let sibling = target.with_file_name("doc.md.swap");
            fs::write(&sibling, written).expect("write sibling");
            set_mtime(&sibling, mtime(&target));
            fs::rename(&sibling, &target).expect("swap in");
        };
        assert!(!store.is_unchanged_with(&c, swap), "swapped during read");
    });
}

/// C5 (control, the read's law): a write landing on the open file during
/// the check's read is never proven unchanged.
#[test]
fn c5_a_write_during_the_read_is_never_unchanged() {
    with_portable_proof(|| {
        let d = TempDir::new("c5");
        let (store, c) = registered(&d, "doc.md", b"alpha\n");
        own_save(&c, b"alpha beta\n", &store);
        let target = c.clone();
        let grow = move || append(&target, b"x");
        assert!(!store.is_unchanged_with(&c, grow), "written during read");
    });
}

/// C6 (control): the seam leaves no state behind: after
/// `with_portable_proof` returns, a Unix read of the saved file is
/// unchanged again, so these cases cannot leak into the macOS suites.
#[test]
fn c6_the_portable_proof_does_not_outlive_its_scope() {
    let d = TempDir::new("c6");
    let (store, c) = registered(&d, "doc.md", b"alpha\n");
    own_save(&c, b"alpha beta\n", &store);
    let _ = with_portable_proof(|| store.is_unchanged(&c));
    assert!(store.is_unchanged(&c), "Unix proof after the scope");
}

/// R1 (macOS): the real `save_file_with`, then the Windows sequence under
/// the off-Unix proof: no emit. RED today.
#[cfg(target_os = "macos")]
#[tokio::test]
async fn r1_real_save_then_windows_sequence_never_emits() {
    use crate::commands::file_save_fixture::{save, Dir};
    let d = Dir::new("d190r1");
    let p = d.file("work1.md", b"alpha\n");
    let store = BaselineStore::default();
    with_portable_proof(|| store.register(&p));
    save(&p, "alpha\nbeta\n", &store).await.expect("save");
    let c = fs::canonicalize(&p).expect("canonicalize");
    with_portable_proof(|| {
        let map = fresh();
        for kind in WINDOWS_SAVE {
            let (emitted, outcome) = route(kind, &[&c], &map, &store);
            assert_eq!(emitted, Value::Null, "{kind:?}: {outcome:?}");
        }
    });
}
