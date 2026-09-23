//! Test cases for `services::app_exit::run_exit_cleanup` (WI-1).
//!
//! Wired from `app_exit.rs` with `#[cfg(test)] #[path = ...] mod tests;` so the
//! specification lives apart from the implementation it constrains.

use super::*;
use crate::models::LogSettings;
use crate::services::draft;
use crate::HOME_LOCK;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
    HomeRestorer(prev)
}

/// Fresh temp HOME: removed first, so a previous run cannot leak state in.
fn make_temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("mdpro_test").join(label);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// `data_dir()/mdpro`, asserted to live inside the temp HOME first. On WSL
/// with XDG_DATA_HOME set, `data_dir()` ignores $HOME and cleanup would hit
/// the developer's real config files; this makes that fail loudly.
fn mdpro_dir(temp_home: &Path) -> PathBuf {
    let data = dirs::data_dir().unwrap();
    assert!(
        data.starts_with(temp_home),
        "data_dir() {:?} escaped temp HOME {:?}",
        data,
        temp_home
    );
    data.join("mdpro")
}

struct LogSettingsRestorer(LogSettings);
impl Drop for LogSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

#[test]
fn c1_removes_config_files_signals_receiver_and_conserves_everything_else() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("exit_c1");
    let _home_guard = set_home(&home);

    let dir = mdpro_dir(&home);
    http_server::write_server_config(4242, "tok").unwrap();
    draft::save_draft("keep", "KEEP-BODY", None, "t").unwrap();
    let other = dir.join("other.json");
    fs::write(&other, b"{\"x\":1}").unwrap();
    let other_before = fs::read(&other).unwrap();
    let draft_file = dir.join("drafts").join("keep.draft.json");

    // Not vacuous: all four files exist before the call.
    assert!(dir.join("server.port").exists());
    assert!(dir.join("server.token").exists());
    assert!(draft_file.exists());
    assert!(other.exists());

    let (tx, mut rx) = oneshot::channel();
    let slot = Mutex::new(Some(tx));

    run_exit_cleanup(&slot);

    assert!(!dir.join("server.port").exists(), "server.port survived");
    assert!(!dir.join("server.token").exists(), "server.token survived");
    assert_eq!(rx.try_recv(), Ok(()), "shutdown receiver was not signalled");
    assert!(slot.lock().unwrap().is_none(), "sender slot not taken");

    // Conservation: nothing else under data_dir()/mdpro was touched.
    assert!(draft_file.exists(), "draft bundle was deleted");
    assert_eq!(
        draft::load_draft("keep").unwrap().unwrap().content,
        "KEEP-BODY"
    );
    assert_eq!(fs::read(&other).unwrap(), other_before);
}

#[test]
fn c2_second_run_is_a_no_op_with_the_same_end_state() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("exit_c2");
    let _home_guard = set_home(&home);

    let dir = mdpro_dir(&home);
    http_server::write_server_config(4242, "tok").unwrap();
    assert!(dir.join("server.port").exists());

    let (tx, mut rx) = oneshot::channel();
    let slot = Mutex::new(Some(tx));

    run_exit_cleanup(&slot);
    assert!(!dir.join("server.port").exists());
    assert!(!dir.join("server.token").exists());
    assert_eq!(rx.try_recv(), Ok(()));

    run_exit_cleanup(&slot);
    assert!(!dir.join("server.port").exists());
    assert!(!dir.join("server.token").exists());
    assert!(slot.lock().unwrap().is_none());
    // Exactly one value was delivered: the sender is gone, not pending.
    assert_eq!(rx.try_recv(), Err(oneshot::error::TryRecvError::Closed));

    // A restarted server rewrote the files; the slot is already empty.
    http_server::write_server_config(4243, "tok2").unwrap();
    assert!(dir.join("server.port").exists());

    run_exit_cleanup(&slot);
    assert!(
        !dir.join("server.port").exists(),
        "cleanup skipped the files because the sender slot was empty"
    );
    assert!(!dir.join("server.token").exists());
}

#[test]
fn c3_no_config_files_and_an_empty_slot_returns_normally() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("exit_c3");
    let _home_guard = set_home(&home);

    let data = dirs::data_dir().unwrap();
    assert!(data.starts_with(&home));
    let dir = data.join("mdpro");
    assert!(!dir.exists(), "temp HOME was not clean");

    let slot: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
    run_exit_cleanup(&slot);

    assert!(!dir.exists(), "cleanup created data_dir()/mdpro");
}

#[test]
fn c4_poisoned_mutex_still_removes_files_and_signals_the_sender() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("exit_c4");
    let _home_guard = set_home(&home);

    let dir = mdpro_dir(&home);
    http_server::write_server_config(4242, "tok").unwrap();
    assert!(dir.join("server.port").exists());

    let (tx, mut rx) = oneshot::channel();
    let slot = Arc::new(Mutex::new(Some(tx)));

    let poisoner = Arc::clone(&slot);
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let joined = std::thread::spawn(move || {
        let _held = poisoner.lock().unwrap();
        panic!("poison the shutdown slot");
    })
    .join();
    std::panic::set_hook(hook);
    assert!(joined.is_err());
    assert!(slot.is_poisoned(), "slot was not poisoned");

    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_exit_cleanup(&slot);
    }));

    assert!(outcome.is_ok(), "cleanup panicked on a poisoned lock");
    assert!(!dir.join("server.port").exists());
    assert!(!dir.join("server.token").exists());
    assert_eq!(
        rx.try_recv(),
        Ok(()),
        "a poisoned lock swallowed the MCP shutdown signal"
    );
}

#[test]
fn c5_writes_exactly_one_app_quit_success_line_per_run_with_no_content() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("exit_c5");
    let _home_guard = set_home(&home);

    let _log_guard = LogSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });

    let log_path = home.join(".mdpro").join("mdpro.log");
    let quit_lines = |path: &Path| -> Vec<serde_json::Value> {
        let text = fs::read_to_string(path).unwrap_or_default();
        text.lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter(|v| v.get("event").and_then(|e| e.as_str()) == Some("app.quit"))
            .collect()
    };

    let slot: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

    run_exit_cleanup(&slot);
    let after_one = quit_lines(&log_path);
    assert_eq!(after_one.len(), 1, "expected one app.quit line per run");

    run_exit_cleanup(&slot);
    let after_two = quit_lines(&log_path);
    assert_eq!(after_two.len(), 2, "expected one app.quit line per run");

    for line in &after_two {
        assert_eq!(line.get("status").and_then(|s| s.as_str()), Some("success"));
        let context = line.get("context").cloned().unwrap_or(json!({}));
        for key in ["content", "documentIds", "text"] {
            assert!(
                context.get(key).is_none(),
                "app.quit context leaked `{}`",
                key
            );
        }
    }
}
