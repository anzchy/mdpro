use super::{save_as_post_picker, SaveAsTransaction};
use crate::commands::file::FileError;
use crate::commands::file_save_fixture::Dir;
use crate::commands::save_as_watch::original_bytes_before_dialog;
use crate::models::mcp::WindowState;
use crate::models::{DocumentState, ShadowStore};
use crate::services::file_watcher::FileWatcher;
use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::symlink;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn new_open_between_decision_and_reservation_is_refused_without_write() {
    let dir = Dir::new("d255_transaction_interleave");
    let source = dir.file("a.md", b"source\n");
    let target = dir.file("b.md", b"target\n");
    let watcher = FileWatcher::for_tests();
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string(), "window-b".to_string()]);
    let picked = target.to_string_lossy().into_owned();
    let original = source.to_string_lossy().into_owned();
    let result = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "saved source\n".into(),
            picked,
            original_path: Some(&original),
            original_bytes: None,
            encoding: None,
            line_ending: None,
            action_id: "d255-interleave",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {
            let hold = watcher.reserve_hold("window-b", &target).unwrap();
            watcher.watch(&target);
            watcher.confirm_hold(&hold);
        },
    )
    .await;
    assert!(
        matches!(result, Err(FileError::AlreadyOpen { .. })),
        "{result:?}"
    );
    assert_eq!(fs::read(&target).unwrap(), b"target\n");
}

#[tokio::test]
async fn deleted_original_saves_to_unopened_path_without_recreating_it() {
    let dir = Dir::new("d255_deleted_original_save_as");
    let source = dir.file("deleted.md", b"old\n");
    let target = dir.path().join("new.md");
    fs::remove_file(&source).unwrap();
    let original = source.to_string_lossy().into_owned();
    let before = original_bytes_before_dialog(Some(&original))
        .into_result()
        .unwrap();
    let watcher = FileWatcher::for_tests();
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string()]);
    let saved = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "edited\n".into(),
            picked: target.to_string_lossy().into_owned(),
            original_path: Some(&original),
            original_bytes: before.as_deref(),
            encoding: None,
            line_ending: None,
            action_id: "d255-deleted-save-as",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {},
    )
    .await
    .unwrap()
    .unwrap();
    assert!(saved.success);
    assert_eq!(fs::read(&target).unwrap(), b"edited\n");
    assert!(!source.exists());
}

async fn held_retargeted_path_without_shadow_is_refused(replace_link: bool, pick_new: bool) {
    let dir = Dir::new("d255_held_retarget_no_shadow");
    let old = dir.file("old.md", b"held original\n");
    let new = dir.file("new.md", b"new target\n");
    let link = dir.path().join("link.md");
    symlink(&old, &link).unwrap();
    let watcher = FileWatcher::for_tests();
    let hold = watcher.reserve_hold("window-b", &link).unwrap();
    watcher.watch(&link);
    watcher.confirm_hold(&hold);
    fs::remove_file(&link).unwrap();
    if replace_link {
        fs::write(&link, b"replacement\n").unwrap();
    } else {
        symlink(&new, &link).unwrap();
    }
    let picked = if pick_new { &new } else { &link };
    let before = fs::read(picked).unwrap();
    // This is also the CloseRequested-before-Destroyed state: shadow removed,
    // while the native window hold still exists.
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string(), "window-b".to_string()]);
    let result = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "save A\n".into(),
            picked: picked.to_string_lossy().into_owned(),
            original_path: None,
            original_bytes: None,
            encoding: None,
            line_ending: None,
            action_id: "d255-no-shadow-held",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {},
    )
    .await;
    assert!(
        matches!(result, Err(FileError::AlreadyOpen { .. })),
        "{result:?}"
    );
    assert_eq!(fs::read(picked).unwrap(), before);
    assert_eq!(fs::read(&old).unwrap(), b"held original\n");
}

#[tokio::test]
async fn retargeted_held_link_without_shadow_refuses_link_pick() {
    held_retargeted_path_without_shadow_is_refused(false, false).await;
}

#[tokio::test]
async fn retargeted_held_link_without_shadow_refuses_physical_pick() {
    held_retargeted_path_without_shadow_is_refused(false, true).await;
}

#[tokio::test]
async fn replaced_held_link_during_close_prompt_refuses_without_shadow() {
    held_retargeted_path_without_shadow_is_refused(true, false).await;
}

#[tokio::test]
async fn own_link_retargeted_to_shadowless_held_link_is_refused() {
    let dir = Dir::new("d255_own_link_shadowless_hold");
    let own_old = dir.file("own-old.md", b"equal\n");
    let held_old = dir.file("held-old.md", b"held\n");
    let new = dir.file("new.md", b"equal\n");
    let own_link = dir.path().join("own-link.md");
    let held_link = dir.path().join("held-link.md");
    symlink(&own_old, &own_link).unwrap();
    symlink(&held_old, &held_link).unwrap();
    let original = own_link.to_string_lossy().into_owned();
    let before = original_bytes_before_dialog(Some(&original))
        .into_result()
        .unwrap();
    let watcher = FileWatcher::for_tests();
    let hold = watcher.reserve_hold("window-b", &held_link).unwrap();
    watcher.watch(&held_link);
    watcher.confirm_hold(&hold);
    fs::remove_file(&own_link).unwrap();
    fs::remove_file(&held_link).unwrap();
    symlink(&new, &own_link).unwrap();
    symlink(&new, &held_link).unwrap();
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string(), "window-b".to_string()]);
    let result = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "overwrite\n".into(),
            picked: original.clone(),
            original_path: Some(&original),
            original_bytes: before.as_deref(),
            encoding: None,
            line_ending: None,
            action_id: "d255-own-shadowless-hold",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {},
    )
    .await;
    assert!(
        matches!(result, Err(FileError::AlreadyOpen { .. })),
        "{result:?}"
    );
    assert_eq!(fs::read(&new).unwrap(), b"equal\n");
    assert_eq!(fs::read(&own_old).unwrap(), b"equal\n");
}

#[tokio::test]
async fn successful_transaction_confirms_the_target_hold_and_bytes() {
    let dir = Dir::new("d255_transaction_success");
    let source = dir.file("a.md", b"source\n");
    let target = dir.file("b.md", b"target\n");
    let watcher = FileWatcher::for_tests();
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string()]);
    let original = source.to_string_lossy().into_owned();
    let result = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "saved source\n".into(),
            picked: target.to_string_lossy().into_owned(),
            original_path: Some(&original),
            original_bytes: None,
            encoding: None,
            line_ending: None,
            action_id: "d255-success",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {},
    )
    .await
    .unwrap()
    .unwrap();
    assert!(result.success && result.hold_gen > 0);
    assert_eq!(fs::read(&target).unwrap(), b"saved source\n");
    assert_eq!(
        watcher.consumer_spellings(&fs::canonicalize(&target).unwrap()),
        vec![target.to_string_lossy().into_owned()]
    );
}

#[tokio::test]
async fn failed_transaction_releases_new_reservation() {
    let dir = Dir::new("d255_transaction_failure");
    let target = dir.path().join("folder.md");
    fs::create_dir(&target).unwrap();
    let watcher = FileWatcher::for_tests();
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string()]);
    let result = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "saved source\n".into(),
            picked: target.to_string_lossy().into_owned(),
            original_path: None,
            original_bytes: None,
            encoding: None,
            line_ending: None,
            action_id: "d255-failure",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {},
    )
    .await;
    assert!(result.is_err());
    assert!(target.is_dir());
    assert!(watcher.consumer_spellings(&target).is_empty());
}

#[tokio::test]
async fn transaction_write_finishes_before_competing_open_acquires() {
    let dir = Dir::new("d255_transaction_lock");
    let target = dir.file("b.md", b"target\n");
    let watcher = Arc::new(FileWatcher::for_tests());
    let shadow = Arc::new(Mutex::new(ShadowStore::default()));
    let labels = HashSet::from(["window-a".to_string()]);
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (acquired_tx, acquired_rx) = std::sync::mpsc::channel();
    let opener_watcher = watcher.clone();
    let opener_target = target.clone();
    let mut opener = None;
    let saved = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "saved source\n".into(),
            picked: target.to_string_lossy().into_owned(),
            original_path: None,
            original_bytes: None,
            encoding: None,
            line_ending: None,
            action_id: "d255-lock",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {
            opener = Some(std::thread::spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async {
                    started_tx.send(()).unwrap();
                    let _guard = crate::commands::save_as_open_lock::lock().await;
                    let hold = opener_watcher
                        .reserve_hold("window-b", &opener_target)
                        .unwrap();
                    opener_watcher.watch(&opener_target);
                    opener_watcher.confirm_hold(&hold);
                    acquired_tx.send(fs::read(&opener_target).unwrap()).unwrap();
                });
            }));
            started_rx.recv().unwrap();
            assert!(
                matches!(
                    acquired_rx.recv_timeout(std::time::Duration::from_millis(100)),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                ),
                "opener acquired inside Save As transaction"
            );
        },
    )
    .await
    .unwrap()
    .unwrap();
    assert!(saved.success);
    assert_eq!(fs::read(&target).unwrap(), b"saved source\n");
    opener.unwrap().join().unwrap();
    assert_eq!(acquired_rx.recv().unwrap(), b"saved source\n");
    assert_eq!(
        watcher
            .consumer_spellings(&fs::canonicalize(&target).unwrap())
            .len(),
        1
    );
}

#[tokio::test]
async fn own_symlink_retargeted_to_another_open_document_is_refused() {
    let dir = Dir::new("d255_own_link_to_open_b");
    let old = dir.file("old.md", b"same\n");
    let other = dir.file("other.md", b"same\n");
    let link = dir.path().join("link.md");
    std::os::unix::fs::symlink(&old, &link).unwrap();
    let watcher = FileWatcher::for_tests();
    let own_hold = watcher.reserve_hold("window-a", &link).unwrap();
    watcher.watch(&link);
    watcher.confirm_hold(&own_hold);
    fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&other, &link).unwrap();
    let other_hold = watcher.reserve_hold("window-b", &other).unwrap();
    watcher.watch(&other);
    watcher.confirm_hold(&other_hold);

    let mut store = ShadowStore::default();
    for (label, id, path) in [("window-a", "a", &link), ("window-b", "b", &other)] {
        store.windows.insert(
            label.into(),
            WindowState {
                label: label.into(),
                documents: vec![DocumentState {
                    id: id.into(),
                    title: id.into(),
                    path: Some(path.to_string_lossy().into_owned()),
                    content: "same\n".into(),
                    cursor: 0,
                    is_dirty: false,
                    is_active: true,
                    over_limit: false,
                }],
                ..WindowState::default()
            },
        );
    }
    let shadow = Arc::new(Mutex::new(store));
    let labels = HashSet::from(["window-a".to_string(), "window-b".to_string()]);
    let picked = link.to_string_lossy().into_owned();
    let result = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "new text\n".into(),
            picked: picked.clone(),
            original_path: Some(&picked),
            original_bytes: Some(b"same\n"),
            encoding: None,
            line_ending: None,
            action_id: "d255-own-link",
            watcher: &watcher,
            shadow: &shadow,
            live_labels: &labels,
        },
        || {},
    )
    .await;
    assert!(
        matches!(result, Err(FileError::AlreadyOpen { .. })),
        "{result:?}"
    );
    assert_eq!(fs::read(&other).unwrap(), b"same\n");
}
