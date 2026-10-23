//! D255: an external edit while the native picker is open never becomes an own-path save.
use super::{original_bytes_before_dialog, refuse_original_changed_during_dialog};
use crate::commands::file::FileError;
use crate::commands::file_save_fixture::Dir;
use crate::services::file_watcher::FileWatcher;
use std::fs;

#[test]
fn own_path_change_after_watcher_refresh_is_still_refused() {
    let d = Dir::new("d255_dialog_snapshot");
    let original = d.file("a.md", b"loaded\n");
    let path = original.to_string_lossy().into_owned();
    let before = original_bytes_before_dialog(Some(&path));
    fs::write(&original, b"external\n").unwrap();
    let err = refuse_original_changed_during_dialog(&path, Some(&path), before.as_deref(), None)
        .expect_err("external write while picker open");
    assert!(matches!(err, FileError::ExternalChangeConflict { .. }));
    assert_eq!(fs::read(&original).unwrap(), b"external\n");
}

#[test]
fn deleted_open_target_is_still_refused_after_holder_parent_canonicalization() {
    let d = Dir::new("d255_deleted_open_target");
    let source = d.file("a.md", b"A\n");
    let target = d.file("b.md", b"B\n");
    let fw = FileWatcher::for_tests();
    fw.reserve_hold("window-a", &source).expect("source hold");
    fw.reserve_hold("window-b", &target).expect("B hold");
    fs::remove_file(&target).expect("external deletion");
    let err = super::refuse_open_target(
        &target.to_string_lossy(),
        Some(&source.to_string_lossy()),
        None,
        &fw,
    )
    .expect_err("open deleted B must still be refused");
    assert!(matches!(err, FileError::AlreadyOpen { .. }));
    assert!(!target.exists());
}

#[test]
fn snapshot_guard_allows_unchanged_own_path_and_a_different_unopened_target() {
    let d = Dir::new("d255_snapshot_allowed");
    let source = d.file("a.md", b"loaded\n");
    let target = d.file("b.md", b"other\n");
    let source = source.to_string_lossy().into_owned();
    let target = target.to_string_lossy().into_owned();
    let before = original_bytes_before_dialog(Some(&source));
    refuse_original_changed_during_dialog(&source, Some(&source), before.as_deref(), None)
        .expect("unchanged own path is allowed");
    fs::write(&source, b"changed\n").unwrap();
    refuse_original_changed_during_dialog(&target, Some(&source), before.as_deref(), None)
        .expect("a different target is independent of old file changes");
    assert_eq!(fs::read(&target).unwrap(), b"other\n");
}
