//! ADR-0047 WI-002 / WI-3 (WI3-T01…T06): `migrate_legacy_drafts_logged` is a
//! characterization of the startup block that used to live inline in
//! `main.rs`. Each test runs under a temp `$HOME` held by `crate::HOME_LOCK`,
//! with the real logger forced on (primed under a separate throwaway HOME so
//! `load_preferences()` never writes into the fixture or the real `~/.mdpro`),
//! and reads the JSONL log back from `<H>/.mdpro/mdpro.log`.
use super::migrate_legacy_drafts_logged;
use crate::models::{LogLevel, LogSettings};
use crate::services::logger::{get_log_settings, set_log_settings};
use crate::HOME_LOCK;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

const EVENT: &str = "app.draft_migration";

fn set_home(path: &Path) {
    // SAFETY: every caller holds HOME_LOCK.
    unsafe { std::env::set_var("HOME", path) };
}

struct HomeRestorer(Option<std::ffi::OsString>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// Temp HOME + forced Info logging. Drop order: `Drop::drop` restores the
/// log settings and removes the dirs, then `_home` restores `$HOME`, then
/// `_lock` releases the lock.
struct Fixture {
    root: PathBuf,
    home: PathBuf,
    prev_settings: LogSettings,
    _home: HomeRestorer,
    _lock: MutexGuard<'static, ()>,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev_home = std::env::var_os("HOME");
        let root = std::env::temp_dir()
            .join("mdpro_test")
            .join(format!("wi3-{label}-{}", uuid::Uuid::new_v4()));
        let prime = root.join("prime");
        let home = root.join("home");
        fs::create_dir_all(&prime).expect("create prime home");
        fs::create_dir_all(&home).expect("create fixture home");
        let restorer = HomeRestorer(prev_home);
        // F3: the settings cache's first init reads $HOME/.mdpro/config.json.
        // Since M1a WI-1 that read is read-only and never creates the file, but
        // priming under `prime` still keeps the read off the fixture home.
        set_home(&prime);
        let prev_settings = get_log_settings();
        set_log_settings(LogSettings {
            enabled: true,
            level: LogLevel::Info,
        });
        set_home(&home);
        Fixture {
            root,
            home,
            prev_settings,
            _home: restorer,
            _lock: lock,
        }
    }

    fn legacy_dir(&self) -> PathBuf {
        self.home.join(".mdpro").join("drafts")
    }

    /// Where production moves the drafts: `dirs::data_dir()/mdpro/drafts`
    /// (`draft::paths::drafts_dir`). D193: this was the macOS path on every OS,
    /// so on Linux the tests looked in a directory nothing writes. The data
    /// dir is first proven to be inside the fixture HOME and, where the OS has
    /// one, equal to its literal location there.
    fn dest_dir(&self) -> PathBuf {
        let data = dirs::data_dir().expect("data_dir()");
        assert!(
            data.starts_with(&self.home),
            "data_dir() {data:?} escaped the fixture HOME {:?}",
            self.home
        );
        #[cfg(target_os = "macos")]
        assert_eq!(data, self.home.join("Library").join("Application Support"));
        #[cfg(target_os = "linux")]
        assert_eq!(data, self.home.join(".local").join("share"));
        data.join("mdpro").join("drafts")
    }

    fn write_legacy(&self, name: &str, bytes: &[u8]) {
        fs::create_dir_all(self.legacy_dir()).expect("create legacy dir");
        fs::write(self.legacy_dir().join(name), bytes).expect("write legacy file");
    }

    /// Every `app.draft_migration` line in the fixture's log, parsed.
    fn migration_lines(&self) -> Vec<Value> {
        let log = self.home.join(".mdpro").join("mdpro.log");
        fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).expect("log line is JSON"))
            .filter(|v| v["event"] == EVENT)
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        set_log_settings(self.prev_settings.clone());
        restore_mode(&self.legacy_dir(), 0o755);
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[cfg(unix)]
fn restore_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}
#[cfg(not(unix))]
fn restore_mode(_path: &Path, _mode: u32) {}

fn assert_success(line: &Value, n: u64) {
    assert_eq!(line["level"], "info", "{line}");
    assert_eq!(line["status"], "success", "{line}");
    assert_eq!(
        line["context"],
        serde_json::json!({ "filesMigrated": n }),
        "{line}"
    );
    assert!(line["error"].is_null(), "{line}");
}

fn assert_fail(line: &Value) {
    assert_eq!(line["level"], "error", "{line}");
    assert_eq!(line["status"], "fail", "{line}");
    let err = line["error"].as_str().expect("error is a string");
    assert!(!err.is_empty(), "{line}");
    assert!(line["context"].get("filesMigrated").is_none(), "{line}");
}

#[test]
fn wi3_t01_one_legacy_draft_moved_with_one_success_line() {
    let fx = Fixture::new("t01");
    let bytes = br#"{"content":"hello","title":"t"}"#;
    fx.write_legacy("d1.draft.json", bytes);

    migrate_legacy_drafts_logged();

    let moved = fx.dest_dir().join("d1.draft.json");
    assert_eq!(fs::read(&moved).expect("moved file"), bytes.to_vec());
    assert!(!fx.legacy_dir().join("d1.draft.json").exists());
    let lines = fx.migration_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_success(&lines[0], 1);
}

#[test]
fn wi3_t02_count_flows_through_to_one_line() {
    let fx = Fixture::new("t02");
    fx.write_legacy("a.draft.json", b"{}");
    fx.write_legacy("b.draft.md", b"# b");
    fx.write_legacy("b.meta.json", b"{}");

    migrate_legacy_drafts_logged();

    let lines = fx.migration_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_success(&lines[0], 3);
}

#[test]
fn wi3_t03_no_legacy_dir_logs_nothing() {
    let fx = Fixture::new("t03");

    migrate_legacy_drafts_logged();

    assert!(fx.migration_lines().is_empty());
}

#[test]
fn wi3_t04_empty_legacy_dir_logs_nothing_and_is_removed() {
    let fx = Fixture::new("t04");
    fs::create_dir_all(fx.legacy_dir()).expect("create legacy dir");

    migrate_legacy_drafts_logged();

    assert!(fx.migration_lines().is_empty());
    assert!(
        !fx.legacy_dir().exists(),
        "empty legacy dir should be removed"
    );
}

#[test]
fn wi3_t05_blocked_destination_logs_one_fail_line() {
    let fx = Fixture::new("t05");
    fx.write_legacy("d1.draft.json", b"{}");
    // Deviation from the matrix fixture (r1): a file AT `.../mdpro/drafts`
    // passes `ensure_dir`'s `exists()` check and the ENOTDIR rename is skipped
    // silently (Ok(0), no line). A file at its parent `.../mdpro` makes
    // `create_dir_all` fail, which is the failure this case means to pin.
    let blocker = fx.dest_dir().parent().expect("dest parent").to_path_buf();
    fs::create_dir_all(blocker.parent().expect("blocker parent")).expect("create blocker parent");
    fs::write(&blocker, b"not a dir").expect("block destination with a file");

    migrate_legacy_drafts_logged();

    let lines = fx.migration_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_fail(&lines[0]);
    assert!(fx.legacy_dir().join("d1.draft.json").exists());
}

/// Whether a mode-000 dir actually denies `read_dir` here (it does not as root).
#[cfg(unix)]
fn permission_denial_enforceable(scratch: &Path) -> bool {
    let probe = scratch.join("probe-000");
    fs::create_dir_all(&probe).expect("create probe dir");
    restore_mode(&probe, 0o000);
    let denied = fs::read_dir(&probe).is_err();
    restore_mode(&probe, 0o755);
    denied
}

#[cfg(unix)]
#[test]
fn wi3_t06_unreadable_legacy_dir_logs_one_fail_line() {
    let fx = Fixture::new("t06");
    if !permission_denial_enforceable(&fx.root) {
        println!("SKIPPED: permission denial not enforceable (euid 0?)");
        return;
    }
    fx.write_legacy("d1.draft.json", b"{}");
    restore_mode(&fx.legacy_dir(), 0o000);

    migrate_legacy_drafts_logged();

    restore_mode(&fx.legacy_dir(), 0o755);
    let lines = fx.migration_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_fail(&lines[0]);
    assert!(fx.legacy_dir().join("d1.draft.json").exists());
}
