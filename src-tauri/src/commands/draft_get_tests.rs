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
