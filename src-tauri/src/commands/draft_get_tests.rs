use super::*;
use std::fs;

// Use the crate-level HOME_LOCK so that commands::draft tests and
// services::draft::migration tests cannot race on the process-wide $HOME.
use crate::HOME_LOCK;

fn make_temp_home(label: &str) -> std::path::PathBuf {
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

/// Sets HOME and returns a guard that restores the original value on drop.
/// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
fn set_home(path: &std::path::Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
    HomeRestorer(prev)
}

// HOME_LOCK is deliberately held across the await: it serializes mutation of
// the process-wide $HOME, and the awaited call reads $HOME, so the guard must
// outlive it. `#[tokio::test]` runs on a current_thread runtime, so the future
// never migrates between threads. Releasing the lock earlier would let two
// tests race on $HOME and make the suite flaky.
/// Regression test: get_draft must propagate IO/parse errors instead of
/// silently coercing them to None (the original bug).
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn get_draft_propagates_parse_error_for_corrupt_metadata() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("gd_corrupt_meta");
    let _home_guard = set_home(&home);

    // After fix/audit-128, drafts live under data_dir() not home_dir().
    // With HOME set above, dirs::data_dir() returns HOME/Library/Application Support on macOS.
    let drafts_dir = dirs::data_dir()
        .unwrap_or_else(|| home.clone())
        .join("mdpro")
        .join("drafts");
    fs::create_dir_all(&drafts_dir).unwrap();
    fs::write(drafts_dir.join("test-doc-corrupt.draft.md"), "content").unwrap();
    fs::write(drafts_dir.join("test-doc-corrupt.meta.json"), "{invalid}").unwrap();

    let result = get_draft("test-doc-corrupt".to_string()).await;
    let _ = fs::remove_dir_all(&home);

    assert!(
        result.is_err(),
        "get_draft must propagate errors instead of returning Ok(None); got {result:?}"
    );
}

// Same rationale as above: $HOME serialization requires holding HOME_LOCK
// across the await, and the current_thread test runtime makes that safe.
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn get_draft_returns_ok_none_for_missing_draft() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("gd_missing");
    let _home_guard = set_home(&home);

    let result = get_draft("no-such-doc-xyzzy".to_string()).await;
    let _ = fs::remove_dir_all(&home);

    assert!(
        matches!(result, Ok(None)),
        "expected Ok(None) for missing draft; got {result:?}"
    );
}

#[test]
fn d305_command_rejects_invalid_id_and_uses_trusted_window_label() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d305_command_owner");
    let _home_guard = set_home(&home);
    let owner = DraftOwner {
        session_id: session_id().to_string(),
        window_label: "B".into(),
    };
    let saved = save_draft_as_with_token(Some(owner), "X", "B bytes", None, "B", None).unwrap();
    let before = load_draft("X").unwrap().unwrap();
    assert!(delete_discarded_draft_logged("../X", "A", &saved.revision).is_err());
    assert_eq!(
        delete_discarded_draft_logged("X", "A", &saved.revision).unwrap(),
        OwnedDeleteOutcome::Protected
    );
    assert_eq!(load_draft("X").unwrap().unwrap().content, before.content);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn d305_stale_command_keeps_newer_bytes_and_emits_diagnostic() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("d305_stale_command");
    let _home_guard = set_home(&home);
    crate::services::logger::set_log_settings(crate::models::LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let owner = DraftOwner {
        session_id: session_id().to_string(),
        window_label: "A".into(),
    };
    let first = save_draft_as_with_token(Some(owner.clone()), "X", "V1", None, "X", None).unwrap();
    let second = save_draft_as_with_token(Some(owner), "X", "V2", None, "X", None).unwrap();
    let path = std::path::PathBuf::from(&second.draft_path);
    let v2 = fs::read(&path).unwrap();
    let stale = delete_discarded_draft_logged("X", "A", &first.revision).unwrap();
    assert_eq!(serde_json::to_value(stale).unwrap(), json!("stale"));
    assert_eq!(fs::read(&path).unwrap(), v2);
    let log_path = crate::services::logger::log_path().unwrap();
    let lines = fs::read_to_string(log_path).unwrap();
    let stale_line: serde_json::Value = lines
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .find(|line: &serde_json::Value| line["event"] == "file.draft.discard.stale")
        .expect("stale diagnostic");
    assert!(stale_line["actionId"]
        .as_str()
        .is_some_and(|id| !id.is_empty()));
    assert_eq!(
        delete_discarded_draft_logged("X", "A", &second.revision).unwrap(),
        OwnedDeleteOutcome::Deleted
    );
    assert_eq!(
        delete_discarded_draft_logged("X", "A", &second.revision).unwrap(),
        OwnedDeleteOutcome::Absent
    );
    let _ = fs::remove_dir_all(&home);
}
