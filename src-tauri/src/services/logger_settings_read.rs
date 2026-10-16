//! Purpose: the logger's initial settings — the stored `logging` section read
//! lock-free and read-only, and the fail-closed decision the settings cache
//! installs from it (M1a WI-1; moved out of `logger.rs` by M1a WI-3a).
//!
//! Key decisions:
//! - The read takes no preferences lock and never writes, so a log line from
//!   inside a held `PrefsGuard` span cannot deadlock or be refused.
//! - The whole document is parsed, so the read agrees with the loader on every
//!   file, and an unreadable one fails closed (ADR-0042 decision 6).
//!
//! @coordinates-with services/logger.rs — `settings_cache` installs
//!   [`initial_settings`]; re-exports the two `pub(crate)` names
//! @coordinates-with services/preferences.rs — `config_path` and the loader
//!   this read must agree with

use std::io::ErrorKind;

use crate::models::{LogLevel, LogSettings, UserPreferences};
use crate::services::preferences::config_path;

/// Read-side fallback applied when the logging settings cannot be loaded.
///
/// `enabled: false`, and only that field differs from `LogSettings::default()`.
/// `enabled` is the field carrying a safety meaning: a fail-*open* fallback
/// silently re-enables logging for a user who turned it off, and because it is
/// byte-identical to `LogSettings::default()` nothing downstream can tell that
/// from a healthy fresh install. `level` carries no such meaning and stays at
/// the ordinary default.
///
/// A fresh install does NOT reach this value. [`read_initial_logging`] treats
/// a MISSING config.json (`NotFound`) as the success path — it returns
/// `LogSettings::default()` and writes nothing — so a first launch arrives at
/// `enabled: true` through the success branch. Reaching this constant means
/// config.json exists and is genuinely unreadable or unparseable (or is not a
/// file at all, or the home directory cannot be resolved).
///
/// Deliberately separate from `LogSettings::default()` rather than a change to
/// it: `models/log_entry.rs`'s
/// `default_log_settings_are_enabled_at_info_and_mirror_ts_default_preferences`
/// pins the default, and the TS default must keep mirroring it. This is the
/// same shape as the frontend half of the defect, `FAIL_CLOSED_SETTINGS` in
/// `src/services/loggingService.ts`.
///
/// Never persisted — writing it back to config.json would turn a transient read
/// failure into permanent destruction of the user's real setting.
const FAIL_CLOSED_SETTINGS: LogSettings = LogSettings {
    enabled: false,
    level: LogLevel::Info,
};

/// Decide the log-settings cache's initial value from the settings read.
///
/// `None` means [`read_initial_logging`] could not read the stored settings.
/// Extracted from `settings_cache`
/// because that cache is a `OnceLock`: it initialises exactly once per
/// process, and six other test modules in this crate touch `$HOME` before it
/// might be reached, so the failure branch is not reachable from a test
/// through the cache. The decision is the thing worth testing, so the
/// decision is what got extracted.
pub(super) fn resolve_initial_settings(loaded: Option<LogSettings>) -> LogSettings {
    loaded.unwrap_or(FAIL_CLOSED_SETTINGS)
}

/// The stored logging settings, read without the preferences lock and without
/// writing anything (M1a WI-1).
///
/// The settings cache initialises on the first log line, and a log line can
/// come from inside a held `PrefsGuard` span. Calling the public
/// `load_preferences` there would be refused as a re-entrant load (or wait on
/// the lock), and a refusal would fail closed and silence the log. So this
/// read takes no lock, never repairs or migrates, and never materialises a
/// missing file.
///
/// It agrees with the loader on every existing document: the **whole**
/// document is parsed as `UserPreferences` and `.logging` is taken, so any
/// document the loader refuses (corrupt JSON, an ill-typed sibling field) is
/// `None` here and the logger fails closed (ADR-0042 decision 6). Parsing only
/// the `logging` section would turn logging back on for such a file.
///
/// - missing file (`NotFound`) → `Some(LogSettings::default())`;
/// - any other I/O error (a directory in its place, no permission) → `None`;
/// - unparseable → `None`; no resolvable home directory → `None`.
pub(crate) fn read_initial_logging() -> Option<LogSettings> {
    let path = config_path().ok()?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str::<UserPreferences>(&contents)
            .ok()
            .map(|prefs| prefs.logging),
        Err(err) if err.kind() == ErrorKind::NotFound => Some(LogSettings::default()),
        Err(_) => None,
    }
}

/// The settings cache's initial value: [`read_initial_logging`] through the
/// fail-closed decision. What `settings_cache` installs, extracted so a test
/// can run it on a thread that holds a `PrefsGuard`.
pub(crate) fn initial_settings() -> LogSettings {
    resolve_initial_settings(read_initial_logging())
}

#[cfg(test)]
#[path = "logger_fail_closed_tests.rs"]
mod logger_fail_closed_tests;
