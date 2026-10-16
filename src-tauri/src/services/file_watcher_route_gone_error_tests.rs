//! D246 follow-up H-2 (audit b167, ADR-0111): a watched path is "gone" only
//! when looking it up says so (`NotFound`, or `NotADirectory` when a parent
//! became a file). Any other error, such as `PermissionDenied` from a parent
//! directory the user can no longer search, means the file may still be
//! there: it routes as present (`modified`, and the unchanged check fails
//! open with `read_failed`). Before, `Path::exists` turned every error into
//! `deleted`. Symlinks are followed as before: a dangling link is gone.
use super::super::baseline::fixture::{fresh, TempDir};
use super::super::baseline::UnchangedCheck;
use super::super::kinds_fixture::T;
use super::super::{BaselineStore, WatchOutcome};
use super::process_event_checked;
use notify::event::{DataChange, ModifyKind, RemoveKind};
use notify::EventKind;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use WatchOutcome::{EmittedDeleted, EmittedModified};

const CONTENT: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));
const REMOVE_FILE: EventKind = EventKind::Remove(RemoveKind::File);

fn outcome(kind: EventKind, p: &Path, store: &BaselineStore) -> (WatchOutcome, UnchangedCheck) {
    let event = notify::Event::new(kind).add_path(p.to_path_buf());
    let (_, outcome, check) = process_event_checked(&event, &fresh(), store, T);
    (outcome, check)
}

/// Restores a directory's mode when dropped, so a failed assert never leaves
/// an unsearchable directory behind.
struct Mode(PathBuf, u32);
impl Drop for Mode {
    fn drop(&mut self) {
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(self.1));
    }
}

/// `dir/name` holding `bytes`, registered, canonical path.
fn registered_in(dir: &Path, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    fs::create_dir_all(dir).expect("dir");
    let p = fs::canonicalize(dir).expect("canonical dir").join(name);
    fs::write(&p, bytes).expect("write");
    let store = BaselineStore::default();
    store.register(&p);
    (store, p)
}

/// A: the parent directory loses its search bit. The file is still there,
/// and the lookup fails with `PermissionDenied`: a modify and a remove both
/// route `modified`, failing open in the unchanged check (`read_failed`),
/// never `deleted`. Each kind gets its own registered store, because a
/// failed read drops the baseline entry. RED before.
#[test]
fn ge_a_a_permission_error_is_not_gone() {
    let d = TempDir::new("ge-a");
    let sub = d.path().join("locked");
    let (store_m, p) = registered_in(&sub, "a.md", b"bytes");
    let store_r = BaselineStore::default();
    store_r.register(&p);
    fs::set_permissions(&sub, fs::Permissions::from_mode(0o000)).expect("chmod 000");
    let _restore = Mode(sub.clone(), 0o755);
    let err = fs::metadata(&p).expect_err("precondition: the lookup fails");
    assert_eq!(
        err.kind(),
        std::io::ErrorKind::PermissionDenied,
        "precondition (not root)"
    );
    for (kind, store) in [(CONTENT, &store_m), (REMOVE_FILE, &store_r)] {
        assert_eq!(
            outcome(kind, &p, store),
            (EmittedModified, UnchangedCheck::ReadFailed),
            "{kind:?}"
        );
    }
}

/// B (pin): a parent replaced by a regular file is `NotADirectory`: gone.
#[test]
fn ge_b_a_parent_that_became_a_file_is_gone() {
    let d = TempDir::new("ge-b");
    let sub = d.path().join("sub");
    let (store, p) = registered_in(&sub, "b.md", b"bytes");
    fs::remove_dir_all(&sub).expect("rm -r sub");
    fs::write(&sub, b"now a file").expect("sub becomes a file");
    let err = fs::metadata(&p).expect_err("precondition");
    assert_eq!(
        err.kind(),
        std::io::ErrorKind::NotADirectory,
        "precondition"
    );
    for kind in [CONTENT, REMOVE_FILE] {
        assert_eq!(
            outcome(kind, &p, &store),
            (EmittedDeleted, UnchangedCheck::NotChecked),
            "{kind:?}"
        );
    }
}

/// C (pin): a watched symlink whose target was removed is gone, as with
/// `Path::exists` (links are followed).
#[test]
fn ge_c_a_dangling_symlink_is_gone() {
    let d = TempDir::new("ge-c");
    let target = d.file("target.md", b"bytes");
    let link = fs::canonicalize(d.path())
        .expect("canonical")
        .join("link.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");
    let store = BaselineStore::default();
    store.register(&link);
    fs::remove_file(&target).expect("rm target");
    assert_eq!(
        outcome(CONTENT, &link, &store),
        (EmittedDeleted, UnchangedCheck::NotChecked)
    );
}

/// D (pin): a plain missing file is gone.
#[test]
fn ge_d_not_found_is_gone() {
    let d = TempDir::new("ge-d");
    let (store, p) = registered_in(&d.path().join("s"), "d.md", b"bytes");
    fs::remove_file(&p).expect("rm");
    assert_eq!(
        outcome(REMOVE_FILE, &p, &store),
        (EmittedDeleted, UnchangedCheck::NotChecked)
    );
}
