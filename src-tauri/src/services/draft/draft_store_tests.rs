//! Storage tests for `services/draft`: `save_draft` / `delete_draft` on a
//! temp `$HOME`. Moved verbatim out of `mod.rs` (D27 WI-1 split).
use super::*;
use std::fs;

// Use the crate-level HOME_LOCK so these tests cannot race on the
// process-wide $HOME with commands::draft or services::draft::migration
// tests that also redirect $HOME to a temp directory.
use crate::HOME_LOCK;

fn make_temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("mdpro_test").join(label);
    fs::create_dir_all(&dir).unwrap();
    dir
}

struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
    HomeRestorer(prev)
}

// Regression test for issue #75:
// close_document with discard_changes=true relies on delete_draft returning
// Ok(true) and removing the bundle file. Before the fix, close_document
// always returned draft_deleted: false and never called delete_draft, so
// stale drafts were offered for recovery on next launch.
//
// Note: close_document cannot be tested at the command level here because
// it requires tauri::State<'_, FileWatcher>, which needs a full AppHandle
// to construct. The service-level test below pins the exact behaviour that
// the fixed command path depends on.
#[test]
fn test_delete_draft_removes_file_and_returns_true() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("dd_exists");
    let _home_guard = set_home(&home);

    // dirs::data_dir() now resolves inside the temp home.
    let drafts = dirs::data_dir()
        .unwrap_or_else(|| home.clone())
        .join("mdpro")
        .join("drafts");
    fs::create_dir_all(&drafts).unwrap();

    let id = "test75_doc_exists";

    save_draft(id, "# hello", None, "Test Doc").expect("save_draft must succeed");

    let bundle = bundle_path(id).expect("bundle_path must resolve");
    assert!(bundle.exists(), "draft file must exist after save_draft");

    // This is the call that close_document with discard_changes=true makes.
    let result = delete_draft(id).expect("delete_draft must not error");
    assert!(result, "delete_draft must return true when draft existed");
    assert!(
        !bundle.exists(),
        "draft file must be gone after delete_draft"
    );

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn test_delete_draft_returns_false_when_no_draft() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("dd_absent");
    let _home_guard = set_home(&home);

    let result =
        delete_draft("test75_no_such_doc").expect("delete_draft must not error on missing draft");
    assert!(
        !result,
        "delete_draft must return false when draft was absent"
    );

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn test_delete_draft_removes_legacy_files() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("dd_legacy");
    let _home_guard = set_home(&home);

    let drafts = dirs::data_dir()
        .unwrap_or_else(|| home.clone())
        .join("mdpro")
        .join("drafts");
    fs::create_dir_all(&drafts).unwrap();

    let id = "test75_legacy_doc";

    // Write legacy two-file format directly (bypassing save_draft which uses bundle format).
    let legacy_draft = legacy_draft_path(id).expect("legacy_draft_path must resolve");
    let legacy_meta = legacy_meta_path(id).expect("legacy_meta_path must resolve");
    fs::write(&legacy_draft, "# Legacy content").unwrap();
    fs::write(&legacy_meta, r#"{"originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false,"title":"Legacy"}"#).unwrap();

    assert!(
        legacy_draft.exists(),
        "legacy .draft.md must exist before delete"
    );
    assert!(
        legacy_meta.exists(),
        "legacy .meta.json must exist before delete"
    );

    let result = delete_draft(id).expect("delete_draft must not error on legacy files");
    assert!(
        result,
        "delete_draft must return true when legacy files existed"
    );
    assert!(
        !legacy_draft.exists(),
        ".draft.md must be gone after delete_draft"
    );
    assert!(
        !legacy_meta.exists(),
        ".meta.json must be gone after delete_draft"
    );

    let _ = fs::remove_dir_all(&home);
}
