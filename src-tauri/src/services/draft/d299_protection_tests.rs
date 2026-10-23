//! D299 real-disk regression tests for the draft service.
use super::*;
use crate::HOME_LOCK;
use std::fs;
use std::path::{Path, PathBuf};

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

fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
    HomeRestorer(prev)
}
#[test]
fn d299_wi5_no_token_delete_preserves_prior_session_bundle_once() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_wi5_preserve_delete");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    let old = DraftOwner {
        session_id: "prior-session".into(),
        window_label: "main".into(),
    };
    save_draft_as(Some(old), "b", "R", Some("/tmp/b.md".into()), "R title").unwrap();
    let before: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(bundle_path("b").unwrap()).unwrap()).unwrap();
    assert_eq!(delete_draft("b").unwrap(), true);
    assert!(!bundle_path("b").unwrap().exists());
    let entries: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(Result::ok).collect();
    assert_eq!(entries.len(), 1);
    let moved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(entries[0].path()).unwrap()).unwrap();
    for field in ["content", "title", "originalPath", "lastModified"] {
        assert_eq!(moved[field], before[field]);
    }
    assert!(moved.get("owner").is_none());
    assert!(moved.get("claim").is_none());
    assert_eq!(moved["recovered"], serde_json::json!(false));
    let next_launch = LiveContext {
        session_id: "next-session".into(),
        live_labels: std::collections::HashSet::new(),
        open: Ok(OpenSet::default()),
    };
    let listing = list_drafts_for(&next_launch).unwrap();
    assert_eq!(listing.entries.len(), 1);
    assert_ne!(listing.entries[0].id, "b");
    assert_eq!(delete_draft("b").unwrap(), false);
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_prior_session_claim_is_protected_after_restart() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_prior_claim");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let source = DraftBundle {
        revision: String::new(),
        owner: Some(DraftOwner {
            session_id: "old-session".into(),
            window_label: "main".into(),
        }),
        claim: Some(DraftClaimToken {
            source_id: "b".into(),
            nonce: "old-nonce".into(),
            session_id: "old-session".into(),
        }),
        claim_consumed: false,
        content: "R".into(),
        original_path: None,
        last_modified: "2026-10-20T00:00:00Z".into(),
        recovered: true,
        title: "R".into(),
    };
    write_bundle_atomic(&bundle_path("b").unwrap(), &source, "b").unwrap();
    delete_draft("b").unwrap();
    let entries: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(Result::ok).collect();
    assert_eq!(entries.len(), 1);
    let moved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(entries[0].path()).unwrap()).unwrap();
    assert_eq!(moved["content"], serde_json::json!("R"));
    assert!(moved.get("owner").is_none());
    assert!(moved.get("claim").is_none());
    assert_eq!(moved["recovered"], serde_json::json!(false));
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_own_autosaves_and_save_delete_make_no_preservation_copy() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_own_lifecycle");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    let own = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    save_draft_as(Some(own.clone()), "b", "one", None, "B").unwrap();
    save_draft_as(Some(own), "b", "two", None, "B").unwrap();
    assert_eq!(load_draft("b").unwrap().unwrap().content, "two");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    assert_eq!(delete_draft("b").unwrap(), true);
    assert_eq!(delete_draft("b").unwrap(), false);
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_legacy_two_file_draft_survives_ordinary_same_id_delete() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_legacy_delete");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(legacy_draft_path("b").unwrap(), "legacy R").unwrap();
    fs::write(legacy_meta_path("b").unwrap(), r#"{"originalPath":"/tmp/b.md","lastModified":"2026-10-20T00:00:00Z","recovered":false,"title":"Legacy B"}"#).unwrap();
    assert_eq!(delete_draft("b").unwrap(), true);
    let bundles: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".draft.json"))
        .collect();
    assert_eq!(
        bundles.len(),
        1,
        "legacy text must be preserved as a listable bundle"
    );
    let moved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(bundles[0].path()).unwrap()).unwrap();
    assert_eq!(moved["content"], serde_json::json!("legacy R"));
    assert_eq!(moved["title"], serde_json::json!("Legacy B"));
    assert_eq!(moved["originalPath"], serde_json::json!("/tmp/b.md"));
    assert_eq!(
        moved["lastModified"],
        serde_json::json!("2026-10-20T00:00:00Z")
    );
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_legacy_two_file_draft_survives_same_id_autosave() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_legacy_save");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(legacy_draft_path("b").unwrap(), "legacy R").unwrap();
    fs::write(legacy_meta_path("b").unwrap(), r#"{"originalPath":"/tmp/b.md","lastModified":"2026-10-20T00:00:00Z","recovered":false,"title":"Legacy B"}"#).unwrap();
    let own = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    save_draft_as(Some(own), "b", "B new", Some("/tmp/b.md".into()), "B").unwrap();
    assert_eq!(load_draft("b").unwrap().unwrap().content, "B new");
    let bundles: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .collect();
    assert_eq!(bundles.len(), 2);
    assert!(bundles.iter().any(|raw| raw.contains("legacy R")));
    assert!(bundles.iter().any(|raw| raw.contains("B new")));
    let _ = fs::remove_dir_all(&home);
}

#[cfg(unix)]
#[test]
fn d299_failed_preservation_move_aborts_save_and_delete() {
    use std::os::unix::fs::PermissionsExt;
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_preservation_io_failure");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let old = DraftOwner {
        session_id: "prior-session".into(),
        window_label: "main".into(),
    };
    let own = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    for operation in ["save", "delete"] {
        let id = format!("b_{operation}");
        save_draft_as(Some(old.clone()), &id, "R", None, "R title").unwrap();
        let before = fs::read(bundle_path(&id).unwrap()).unwrap();
        let original_mode = fs::metadata(&dir).unwrap().permissions().mode();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        let result = if operation == "save" {
            save_draft_as(Some(own.clone()), &id, "B", None, "B title").map(|_| true)
        } else {
            delete_draft(&id)
        };
        fs::set_permissions(&dir, fs::Permissions::from_mode(original_mode)).unwrap();
        assert!(
            result.is_err(),
            "{operation} must fail when preservation cannot be written"
        );
        assert_eq!(fs::read(bundle_path(&id).unwrap()).unwrap(), before);
        if operation == "save" {
            save_draft_as(Some(own.clone()), &id, "B", None, "B title").unwrap();
        } else {
            delete_draft(&id).unwrap();
        }
        assert!(fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|e| fs::read_to_string(e.path()).ok())
            .any(|raw| raw.contains("\"content\": \"R\"")));
    }
    let _ = fs::remove_dir_all(&home);
}
