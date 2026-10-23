use super::pick_registered_save_as;
use crate::commands::file_save_fixture::Dir;
use crate::commands::save_as_transaction::{save_as_post_picker, SaveAsTransaction};
use crate::models::mcp::WindowState;
use crate::models::{DocumentState, ShadowStore};
use crate::services::file_watcher::FileWatcher;
use std::collections::HashSet;
use std::fs;
use std::sync::{Arc, Mutex};

fn registered(path: &str) -> crate::models::SharedShadowStore {
    let mut store = ShadowStore::default();
    store.windows.insert(
        "window-a".into(),
        WindowState {
            label: "window-a".into(),
            documents: vec![DocumentState {
                id: "a".into(),
                title: "A".into(),
                path: Some(path.into()),
                content: "edited\n".into(),
                cursor: 0,
                is_dirty: true,
                is_active: true,
                over_limit: false,
            }],
            ..WindowState::default()
        },
    );
    Arc::new(Mutex::new(store))
}

#[test]
fn deleted_registered_original_reaches_picker_and_cancel_writes_nothing() {
    let dir = Dir::new("d255_registered_deleted_cancel");
    let original = dir.file("deleted.md", b"old\n");
    fs::remove_file(&original).unwrap();
    let old = original.to_string_lossy().into_owned();
    let shadow = registered(&old);
    let mut picker_calls = 0;
    let result = pick_registered_save_as(
        &shadow,
        "window-a",
        "a",
        Some(old.clone()),
        "d255-deleted-cancel",
        || {
            picker_calls += 1;
            None
        },
    )
    .unwrap();
    assert!(result.is_none());
    assert_eq!(picker_calls, 1);
    assert!(!original.exists());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn deleted_registered_original_picker_selection_saves_elsewhere() {
    let dir = Dir::new("d255_registered_deleted_save");
    let original = dir.file("deleted.md", b"old\n");
    fs::remove_file(&original).unwrap();
    let target = dir.path().join("new.md");
    let old = original.to_string_lossy().into_owned();
    let shadow = registered(&old);
    let selection = pick_registered_save_as(
        &shadow,
        "window-a",
        "a",
        Some(old),
        "d255-deleted-save",
        || Some(target.clone()),
    )
    .unwrap()
    .unwrap();
    let watcher = FileWatcher::for_tests();
    let labels = HashSet::from(["window-a".to_string()]);
    let saved = save_as_post_picker(
        SaveAsTransaction {
            label: "window-a",
            document_id: "a".into(),
            content: "edited\n".into(),
            picked: selection.picked.to_string_lossy().into_owned(),
            original_path: selection.original_path.as_deref(),
            original_bytes: selection.original_bytes.as_deref(),
            encoding: None,
            line_ending: None,
            action_id: "d255-deleted-save",
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
    assert!(!original.exists());
}
