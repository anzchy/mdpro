//! D255: an external edit while the native picker is open never becomes an own-path save.
use super::{original_bytes_before_dialog, refuse_original_changed_during_dialog};
use crate::commands::file::FileError;
use crate::commands::file_save_fixture::Dir;
use crate::models::mcp::WindowState;
use crate::models::{DocumentState, ShadowStore};
use crate::services::file_watcher::FileWatcher;
use std::collections::HashSet;
use std::fs;
use std::sync::{Arc, Mutex};

fn live_open(path: &std::path::Path) -> (crate::models::SharedShadowStore, HashSet<String>) {
    let mut store = ShadowStore::default();
    store.windows.insert(
        "window-b".into(),
        WindowState {
            label: "window-b".into(),
            documents: vec![DocumentState {
                id: "b".into(),
                title: "B".into(),
                path: Some(path.to_string_lossy().into_owned()),
                content: "B".into(),
                cursor: 0,
                is_dirty: false,
                is_active: true,
                over_limit: false,
            }],
            ..WindowState::default()
        },
    );
    (
        Arc::new(Mutex::new(store)),
        HashSet::from(["window-b".into()]),
    )
}

fn checked_open_target(
    picked: &str,
    source: &str,
    fw: &FileWatcher,
    live_path: &std::path::Path,
) -> Result<(), FileError> {
    let (shadow, labels) = live_open(live_path);
    super::refuse_open_target(picked, Some(source), None, fw)?;
    super::refuse_live_open_target(picked, "window-a", "a", None, &shadow, &labels)
}

#[test]
fn linux_test_module_is_gated_like_its_fixture() {
    let source = include_str!("save_as_target.rs");
    assert!(source.contains(
        "#[cfg(all(test, target_os = \"macos\"))]\n#[path = \"save_as_target_tests.rs\"]"
    ));
}

#[test]
fn snapshot_refuses_device_before_dialog() {
    let d = Dir::new("d255_device_snapshot");
    let path = d.path().join("zero.md");
    std::os::unix::fs::symlink("/dev/null", &path).unwrap();
    let result = original_bytes_before_dialog(Some(&path.to_string_lossy()));
    assert!(
        format!("{result:?}").contains("InvalidPath"),
        "device was accepted"
    );
}

#[test]
fn missing_registered_original_can_reach_picker_and_cancel_without_write() {
    let d = Dir::new("d255_missing_original_picker");
    let original = d.file("deleted.md", b"old\n");
    fs::remove_file(&original).unwrap();
    let snapshot = original_bytes_before_dialog(Some(&original.to_string_lossy()));
    assert!(matches!(snapshot, super::OriginalSnapshot::Missing));
    assert!(snapshot.into_result().unwrap().is_none());
    // Cancelling the picker returns before the post-picker transaction.
    assert!(!original.exists());
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 0);
}

#[test]
fn missing_original_stays_missing_through_own_path_comparison() {
    let d = Dir::new("d255_missing_original_compare");
    let original = d.file("deleted.md", b"old\n");
    fs::remove_file(&original).unwrap();
    let path = original.to_string_lossy();
    let outcome = super::refuse_original_changed_during_dialog(&path, Some(&path), None, None);
    assert!(outcome.is_ok(), "{outcome:?}");
    assert!(!original.exists());
}

#[test]
fn snapshot_refuses_fifo_before_dialog_without_waiting_for_writer() {
    let d = Dir::new("d255_fifo_snapshot");
    let path = d.path().join("pipe.md");
    let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
    let result = original_bytes_before_dialog(Some(&path.to_string_lossy()));
    assert!(matches!(
        result,
        super::OriginalSnapshot::Error(FileError::InvalidPath { .. })
    ));
}

#[test]
fn snapshot_refuses_oversize_before_dialog() {
    let d = Dir::new("d255_oversize_snapshot");
    let path = d.path().join("large.md");
    let file = fs::File::create(&path).unwrap();
    file.set_len(crate::commands::file::MAX_FILE_SIZE + 1)
        .unwrap();
    let result = original_bytes_before_dialog(Some(&path.to_string_lossy()));
    assert!(
        format!("{result:?}").contains("FileTooLarge"),
        "oversize file was accepted"
    );
}

#[test]
fn snapshot_refuses_a_file_replaced_during_the_bounded_read() {
    let d = Dir::new("d255_unstable_snapshot");
    let path = d.file("a.md", b"loaded\n");
    let replacement = path.clone();
    let result = super::with_snapshot_read_hook(
        move || fs::write(&replacement, b"external\n").unwrap(),
        || original_bytes_before_dialog(Some(&path.to_string_lossy())),
    );
    assert!(
        format!("{result:?}").contains("IoError"),
        "unstable snapshot was accepted"
    );
}

#[test]
fn snapshot_refuses_fifo_swapped_under_open_handle() {
    let d = Dir::new("d255_fifo_swap");
    let path = d.file("a.md", b"loaded\n");
    let swap = path.clone();
    let result = super::with_snapshot_read_hook(
        move || {
            fs::remove_file(&swap).unwrap();
            let c_path = std::ffi::CString::new(swap.to_string_lossy().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        },
        || original_bytes_before_dialog(Some(&path.to_string_lossy())),
    );
    assert!(matches!(
        result,
        super::OriginalSnapshot::Error(FileError::IoError { .. })
    ));
}

#[test]
fn open_between_refusal_and_reservation_never_gets_overwritten() {
    let d = Dir::new("d255_open_during_save_as");
    let source = d.file("a.md", b"A\n");
    let target = d.file("b.md", b"B\n");
    let fw = FileWatcher::for_tests();
    let picked = target.to_string_lossy().into_owned();
    let old = source.to_string_lossy().into_owned();
    super::refuse_open_target(&picked, Some(&old), None, &fw).unwrap();
    let other = fw.reserve_hold("window-b", &target).unwrap();
    fw.watch(&target);
    fw.confirm_hold(&other);
    let outcome = super::refuse_open_target(&picked, Some(&old), None, &fw);
    assert!(
        matches!(outcome, Err(FileError::AlreadyOpen { .. })),
        "{outcome:?}"
    );
    assert_eq!(fs::read(&target).unwrap(), b"B\n");
    let command = include_str!("file.rs");
    assert!(command.contains("save_as_post_picker("));
    let transaction = include_str!("save_as_transaction.rs");
    let lock = transaction.find("save_as_open_lock::lock().await").unwrap();
    let refusal = transaction.find("refuse_open_target(").unwrap();
    let write = transaction.find("save_as_watched_with(").unwrap();
    assert!(
        lock < refusal && refusal < write,
        "lock must span check and write"
    );
}

#[tokio::test]
async fn open_acquisition_waits_for_save_decision_and_write_span() {
    let d = Dir::new("d255_serialized_target");
    let source = d.file("a.md", b"A\n");
    let target = d.file("b.md", b"B\n");
    let fw = Arc::new(FileWatcher::for_tests());
    let save_span = crate::commands::save_as_open_lock::lock().await;
    super::refuse_open_target(
        &target.to_string_lossy(),
        Some(&source.to_string_lossy()),
        None,
        &fw,
    )
    .expect("target starts unopened");

    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (acquired_tx, acquired_rx) = tokio::sync::oneshot::channel();
    let opener_fw = fw.clone();
    let opener_path = target.clone();
    let opener = tokio::spawn(async move {
        started_tx.send(()).unwrap();
        let _open_span = crate::commands::save_as_open_lock::lock().await;
        let hold = opener_fw.reserve_hold("window-b", &opener_path).unwrap();
        opener_fw.watch(&opener_path);
        opener_fw.confirm_hold(&hold);
        acquired_tx.send(()).unwrap();
    });
    started_rx.await.unwrap();
    let mut acquired_rx = acquired_rx;
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), &mut acquired_rx)
            .await
            .is_err(),
        "open cannot acquire while Save As owns the span"
    );
    assert!(fw.consumer_spellings(&target).is_empty());
    drop(save_span);
    acquired_rx.await.unwrap();
    opener.await.unwrap();

    let _save_span = crate::commands::save_as_open_lock::lock().await;
    let err = super::refuse_open_target(
        &target.to_string_lossy(),
        Some(&source.to_string_lossy()),
        None,
        &fw,
    )
    .expect_err("open B is refused after opener commits its hold");
    assert!(matches!(err, FileError::AlreadyOpen { .. }));
    assert_eq!(fs::read(&target).unwrap(), b"B\n");
}

#[tokio::test]
async fn save_as_write_finishes_before_a_competing_open_can_acquire() {
    let d = Dir::new("d255_save_before_open");
    let source = d.file("a.md", b"A\n");
    let target = d.file("b.md", b"B\n");
    let fw = Arc::new(FileWatcher::for_tests());
    let save_span = crate::commands::save_as_open_lock::lock().await;
    super::refuse_open_target(
        &target.to_string_lossy(),
        Some(&source.to_string_lossy()),
        None,
        &fw,
    )
    .unwrap();
    let hold = fw.reserve_hold("window-a", &target).unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (opened_tx, mut opened_rx) = tokio::sync::oneshot::channel();
    let opener_fw = fw.clone();
    let opener_path = target.clone();
    let opener = tokio::spawn(async move {
        ready_tx.send(()).unwrap();
        let _open_span = crate::commands::save_as_open_lock::lock().await;
        let other = opener_fw.reserve_hold("window-b", &opener_path).unwrap();
        opener_fw.watch(&opener_path);
        opener_fw.confirm_hold(&other);
        opened_tx.send(()).unwrap();
    });
    ready_rx.await.unwrap();
    let saved = super::super::save_as_watched_with(
        "doc-a".into(),
        "A saved\n".into(),
        target.to_string_lossy().into_owned(),
        None,
        None,
        None,
        &fw,
    )
    .await
    .unwrap();
    assert!(saved.success);
    fw.confirm_hold(&hold);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), &mut opened_rx)
            .await
            .is_err()
    );
    assert_eq!(fs::read(&target).unwrap(), b"A saved\n");
    drop(save_span);
    opened_rx.await.unwrap();
    opener.await.unwrap();
}

#[test]
fn all_live_acquisition_routes_share_the_transaction_lock() {
    let commands = include_str!("file.rs");
    for anchor in ["pub async fn open_file(", "pub async fn open_file_dialog("] {
        let body = commands.split(anchor).nth(1).unwrap();
        assert!(
            body.find("save_as_open_lock::lock().await").unwrap()
                < body.find("reserve_hold(").unwrap(),
            "{anchor} must lock before reserving"
        );
    }
    let recovery = include_str!("draft_recover_watch.rs");
    let body = recovery
        .split("pub(crate) async fn recover_draft_watched_locked_with(")
        .nth(1)
        .unwrap();
    assert!(
        body.find("save_as_open_lock::lock().await").unwrap()
            < body.find("watch_recovered(").unwrap()
    );
}

#[test]
fn replaced_symlink_remains_open_by_raw_path() {
    let d = Dir::new("d255_replaced_symlink");
    let source = d.file("a.md", b"A\n");
    let old = d.file("old.md", b"old\n");
    let link = d.path().join("link.md");
    std::os::unix::fs::symlink(&old, &link).unwrap();
    let fw = FileWatcher::for_tests();
    fw.reserve_hold("window-b", &link).unwrap();
    fw.watch(&link);
    fs::remove_file(&link).unwrap();
    fs::write(&link, b"new external bytes\n").unwrap();
    let err = checked_open_target(
        &link.to_string_lossy(),
        &source.to_string_lossy(),
        &fw,
        &link,
    )
    .expect_err("raw open path must be refused");
    assert!(matches!(err, FileError::AlreadyOpen { .. }));
    assert_eq!(fs::read(&link).unwrap(), b"new external bytes\n");
}

#[test]
fn retargeted_symlink_and_physical_target_remain_open() {
    let d = Dir::new("d255_retargeted_symlink");
    let source = d.file("a.md", b"A\n");
    let old = d.file("old.md", b"old\n");
    let new = d.file("new.md", b"new external bytes\n");
    let link = d.path().join("link.md");
    std::os::unix::fs::symlink(&old, &link).unwrap();
    let fw = FileWatcher::for_tests();
    fw.reserve_hold("window-b", &link).unwrap();
    fw.watch(&link);
    fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&new, &link).unwrap();
    for picked in [&link, &new] {
        let err = checked_open_target(
            &picked.to_string_lossy(),
            &source.to_string_lossy(),
            &fw,
            &link,
        )
        .expect_err("live open document identity must be refused");
        assert!(matches!(err, FileError::AlreadyOpen { .. }));
    }
    assert_eq!(fs::read(&new).unwrap(), b"new external bytes\n");
}

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
