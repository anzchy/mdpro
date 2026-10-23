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
fn d299_claim_write_under_same_id_consumes_claim_without_a_move() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_same_id_claim");
    let _home_guard = set_home(&home);
    let _ = fs::remove_dir_all(drafts_dir().unwrap());
    fs::create_dir_all(drafts_dir().unwrap()).unwrap();
    let owner = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    let token = DraftClaimToken {
        source_id: "b".into(),
        nonce: "claim-1".into(),
        session_id: owner.session_id.clone(),
    };
    let source = DraftBundle {
        revision: String::new(),
        owner: Some(owner.clone()),
        claim: Some(token.clone()),
        claim_consumed: false,
        content: "R".into(),
        original_path: None,
        last_modified: "2026-10-20T00:00:00Z".into(),
        recovered: true,
        title: "B".into(),
    };
    write_bundle_atomic(&bundle_path("b").unwrap(), &source, "b").unwrap();
    assert_eq!(delete_draft_with_token("b", Some(&token)).unwrap(), false);
    assert_eq!(load_draft("b").unwrap().unwrap().content, "R");
    save_draft_as_with_token(Some(owner), "b", "R", None, "B", Some(&token)).unwrap();
    let value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(bundle_path("b").unwrap()).unwrap()).unwrap();
    assert_eq!(value["content"], serde_json::json!("R"));
    assert!(
        value.get("claim").is_none(),
        "token write must consume the claim"
    );
    assert_eq!(fs::read_dir(drafts_dir().unwrap()).unwrap().count(), 1);
    assert_eq!(delete_draft("b").unwrap(), true);
    assert_eq!(fs::read_dir(drafts_dir().unwrap()).unwrap().count(), 0);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_old_token_never_deletes_a_newer_claim_at_the_same_source_id() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_claim_nonce");
    let _home_guard = set_home(&home);
    let _ = fs::remove_dir_all(drafts_dir().unwrap());
    fs::create_dir_all(drafts_dir().unwrap()).unwrap();
    let owner = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    let old = DraftClaimToken {
        source_id: "b".into(),
        nonce: "c1".into(),
        session_id: owner.session_id.clone(),
    };
    let newer = DraftClaimToken {
        source_id: "b".into(),
        nonce: "c2".into(),
        session_id: owner.session_id.clone(),
    };
    let source = DraftBundle {
        revision: String::new(),
        owner: Some(owner.clone()),
        claim: Some(newer),
        claim_consumed: false,
        content: "R2".into(),
        original_path: None,
        last_modified: "2026-10-20T00:00:00Z".into(),
        recovered: true,
        title: "new".into(),
    };
    write_bundle_atomic(&bundle_path("b").unwrap(), &source, "b").unwrap();
    let before = fs::read(bundle_path("b").unwrap()).unwrap();
    save_draft_as_with_token(Some(owner), "y", "R1", None, "old", Some(&old)).unwrap();
    assert_eq!(delete_draft_with_token("b", Some(&old)).unwrap(), false);
    assert_eq!(fs::read(bundle_path("b").unwrap()).unwrap(), before);
    assert_eq!(load_draft("y").unwrap().unwrap().content, "R1");
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_stale_same_id_token_preserves_newer_own_text() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_stale_same_id");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    let own = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    let old = DraftClaimToken {
        source_id: "b".into(),
        nonce: "stale".into(),
        session_id: own.session_id.clone(),
    };
    save_draft_as(Some(own.clone()), "b", "newer B edit", None, "B").unwrap();
    save_draft_as_with_token(Some(own), "b", "older R", None, "R", Some(&old)).unwrap();
    let contents: Vec<String> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .collect();
    assert_eq!(contents.len(), 2);
    assert!(contents.iter().any(|raw| raw.contains("newer B edit")));
    assert!(contents.iter().any(|raw| raw.contains("older R")));
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_unconsumed_claim_moves_before_no_token_write_then_old_token_is_stale() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_claim_move_then_stale");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let own = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    let token = DraftClaimToken {
        source_id: "b".into(),
        nonce: "c1".into(),
        session_id: own.session_id.clone(),
    };
    let source = DraftBundle {
        revision: String::new(),
        owner: Some(own.clone()),
        claim: Some(token.clone()),
        claim_consumed: false,
        content: "R".into(),
        original_path: None,
        last_modified: "2026-10-20T00:00:00Z".into(),
        recovered: true,
        title: "R".into(),
    };
    write_bundle_atomic(&bundle_path("b").unwrap(), &source, "b").unwrap();
    save_draft_as(Some(own.clone()), "b", "B edit", None, "B").unwrap();
    save_draft_as_with_token(Some(own), "y", "R", None, "R", Some(&token)).unwrap();
    assert_eq!(delete_draft_with_token("b", Some(&token)).unwrap(), false);
    assert_eq!(load_draft("b").unwrap().unwrap().content, "B edit");
    assert_eq!(load_draft("y").unwrap().unwrap().content, "R");
    assert_eq!(
        fs::read_dir(&dir).unwrap().count(),
        3,
        "moved R, B edit and Y all survive"
    );
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d299_dirty_same_id_tab_cannot_erase_recovered_text_before_y_autosave() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d299_dirty_b_y");
    let _home_guard = set_home(&home);
    let dir = drafts_dir().unwrap();
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let owner = DraftOwner {
        session_id: session_id().into(),
        window_label: "main".into(),
    };
    let token = DraftClaimToken {
        source_id: "b".into(),
        nonce: "c1".into(),
        session_id: owner.session_id.clone(),
    };
    let source = DraftBundle {
        revision: String::new(),
        owner: Some(owner.clone()),
        claim: Some(token.clone()),
        claim_consumed: false,
        content: "R unsaved".into(),
        original_path: Some("/tmp/b.md".into()),
        last_modified: "2026-10-20T00:00:00Z".into(),
        recovered: true,
        title: "R".into(),
    };
    write_bundle_atomic(&bundle_path("b").unwrap(), &source, "b").unwrap();
    save_draft_as_with_token(
        Some(owner.clone()),
        "y",
        "R unsaved",
        Some("/tmp/b.md".into()),
        "R",
        Some(&token),
    )
    .unwrap();
    // A crash here leaves both copies, not zero: the source is removed only later.
    assert_eq!(load_draft("b").unwrap().unwrap().content, "R unsaved");
    assert_eq!(load_draft("y").unwrap().unwrap().content, "R unsaved");
    assert_eq!(delete_draft_with_token("b", Some(&token)).unwrap(), true);
    // No autosave for Y has run. B may now save, close, or be discarded at quit.
    save_draft_as(Some(owner), "b", "B edit", Some("/tmp/b.md".into()), "B").unwrap();
    assert_eq!(delete_draft("b").unwrap(), true);
    assert_eq!(load_draft("y").unwrap().unwrap().content, "R unsaved");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    let _ = fs::remove_dir_all(&home);
}
