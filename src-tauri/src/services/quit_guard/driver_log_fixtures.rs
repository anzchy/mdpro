//! The log-file helpers of the driver specifications, and `guard_at`, which
//! pins a guard's request ids so a log-reading test can filter on its own.
//!
//! Registered from `driver_fixtures.rs` and re-exported from it, so callers
//! see no difference; split out when `driver_fixtures.rs` reached its line
//! budget (moved from `driver_deadline_tests.rs` originally).

use super::super::driver::*;
use super::{later, leak_gate, recording_guard, unique_temp_dir, RecordingEffects};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// A fresh, empty temp `$HOME` for log assertions, unique per call. It does not
/// create the log file or touch the logging settings; callers that need
/// logging on must enable it themselves.
pub(in super::super) fn fresh_log_home(label: &str) -> PathBuf {
    unique_temp_dir(label)
}

pub(in super::super) fn log_lines(home: &Path) -> Vec<Value> {
    let raw = fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect()
}

/// Lines for one event and request id, narrowed further by `distinguishes` —
/// a `$HOME` is process-wide, so a test running in parallel writes into this
/// same file, and request ids restart at 1 for every guard. The extra predicate
/// is what makes the count assertions below about this test's own lines.
pub(in super::super) fn entries_where(
    home: &Path,
    event: &str,
    request_id: u64,
    distinguishes: impl Fn(&Value) -> bool,
) -> Vec<Value> {
    log_lines(home)
        .into_iter()
        .filter(|v| {
            v.get("event").and_then(Value::as_str) == Some(event)
                && v.pointer("/context/requestId").and_then(Value::as_u64) == Some(request_id)
                && distinguishes(v)
        })
        .collect()
}

/// A guard whose next request id is exactly `floor`, so a log-reading test can
/// filter on a request id no other guard in the process will reach. It burns
/// `floor - 1` requests (`begin(["burn"])` then `window_gone("burn")`) with
/// logging off, then turns logging back on at `Info`.
/// SAFETY: caller must hold HOME_LOCK — the logging settings are process-wide.
pub(in super::super) fn guard_at(floor: u64) -> QuitGuard<RecordingEffects> {
    use crate::models::{LogLevel, LogSettings};
    use crate::services::logger;
    logger::set_log_settings(LogSettings {
        enabled: false,
        level: LogLevel::Info,
    });
    let guard = recording_guard(leak_gate());
    for _ in 1..floor {
        later(guard.begin(&["burn"], 0));
        guard.window_gone("burn", 0);
    }
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    guard
}
