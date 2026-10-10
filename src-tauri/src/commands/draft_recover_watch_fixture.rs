//! Test-only helpers shared by the D59 WI-2 test files
//! (`draft_recover_watch_tests.rs`, `draft_recover_watch_law_tests.rs`,
//! `draft_recover_watch_roundtrip_tests.rs`). Mounted as a child of each,
//! which also mount `draft_test_home` (and, for the law files, the open-route
//! `lookup_fixture` and `draft_recover_watch_rows.rs`) as siblings.
use super::draft_test_home::{ago, bundle_json, ctx, who, TempHome};
use crate::commands::draft_recover_watch::recover_draft_watched_with;
use crate::models::{LogLevel, LogSettings, ShadowStore};
use crate::services::draft::{DraftError, LiveContext, RecoverResult};
use crate::services::file_watcher::FileWatcher;
use crate::services::logger::set_log_settings;
use crate::services::quit_guard::DraftGate;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) const S: &str = "sess-current";
pub(super) const P: &str = "previous-run";
pub(super) const REGISTER: &str = "file.watch.register";
pub(super) const UNREGISTER: &str = "file.watch.unregister";

pub(super) fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Enable Info logging and start from an empty log file.
pub(super) fn start_log(home: &TempHome) -> PathBuf {
    set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let path = home.path().join(".mdpro").join("mdpro.log");
    let _ = fs::remove_file(&path);
    path
}

/// Every parseable log line, in file order: (raw text, parsed JSON).
pub(super) fn all_lines(log: &Path) -> Vec<(String, Value)> {
    fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            serde_json::from_str::<Value>(l)
                .ok()
                .map(|v| (l.to_string(), v))
        })
        .collect()
}

/// Every parsed line whose `event` is `event`.
pub(super) fn lines_of(log: &Path, event: &str) -> Vec<Value> {
    all_lines(log)
        .into_iter()
        .map(|(_, v)| v)
        .filter(|v| v["event"] == json!(event))
        .collect()
}

/// A bundle with content `"body"`, owned by a dead window of a previous run.
pub(super) fn seed(home: &TempHome, id: &str, path: Option<&str>) {
    home.write_raw(
        id,
        &bundle_json("body", path, &ago(1), false, Some((P, "main"))),
    );
}

/// An empty, readable open set with no live windows.
pub(super) fn empty_ctx() -> LiveContext {
    ctx(S, &[], &ShadowStore::default())
}

/// Recover `id` as window `W` of this session through the D59 seam.
pub(super) fn recover_in(
    gate: &DraftGate,
    id: &str,
    c: LiveContext,
    fw: &FileWatcher,
) -> Result<RecoverResult, DraftError> {
    recover_draft_watched_with(gate, id, &who(S, "W"), move || c, fw)
}

/// [`recover_in`] with [`empty_ctx`].
pub(super) fn recover(
    gate: &DraftGate,
    id: &str,
    fw: &FileWatcher,
) -> Result<RecoverResult, DraftError> {
    recover_in(gate, id, empty_ctx(), fw)
}

/// `list` with every occurrence of `p` removed.
pub(super) fn minus(list: &[String], p: &str) -> Vec<String> {
    list.iter().filter(|x| x.as_str() != p).cloned().collect()
}
