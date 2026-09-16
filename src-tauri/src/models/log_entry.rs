use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn rank(self) -> u8 {
        match self {
            LogLevel::Debug => 0,
            LogLevel::Info => 1,
            LogLevel::Warn => 2,
            LogLevel::Error => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogStatus {
    Start,
    Success,
    Fail,
    Cancel,
}

pub type LogContext = Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub ts: String,
    pub level: LogLevel,
    pub event: String,
    pub status: LogStatus,
    pub action_id: Option<String>,
    pub context: Option<LogContext>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryPayload {
    pub level: LogLevel,
    pub event: String,
    pub status: LogStatus,
    pub action_id: Option<String>,
    pub context: Option<LogContext>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSettings {
    pub enabled: bool,
    pub level: LogLevel,
}

impl Default for LogSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            level: LogLevel::Info,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserPreferences;

    // `LogSettings` deliberately does not derive `PartialEq`, so every
    // assertion below compares the `enabled` / `level` fields separately
    // rather than the struct as a whole. `LogLevel` does derive
    // `PartialEq, Eq`, so the level comparisons stand on their own.

    /// WI-4-A — the Rust-side default the TypeScript default must mirror.
    ///
    /// `LogSettings::default()` is zero-arity, so this single example is an
    /// exhaustive claim over its whole input domain.
    #[test]
    fn default_log_settings_are_enabled_at_info_and_mirror_ts_default_preferences() {
        let defaults = LogSettings::default();
        assert!(
            defaults.enabled,
            "logging must default to enabled; the TS default mirrors this value"
        );
        assert_eq!(
            defaults.level,
            LogLevel::Info,
            "logging must default to Info; the TS default mirrors this value"
        );
    }

    /// WI-4-B — `UserPreferences::default()` must *delegate* to
    /// `LogSettings::default()` rather than inline its own literals.
    ///
    /// Both sides are live expressions on purpose: asserting against literal
    /// `true` / `Info` here would still pass if the delegation at
    /// `models/preferences.rs:712` were replaced by hand-written values, which
    /// is exactly the drift this case exists to catch.
    #[test]
    fn user_preferences_default_delegates_its_logging_field_to_log_settings_default() {
        let prefs_logging = UserPreferences::default().logging;
        let log_defaults = LogSettings::default();

        assert_eq!(
            prefs_logging.enabled, log_defaults.enabled,
            "UserPreferences::default().logging.enabled must come from LogSettings::default()"
        );
        assert_eq!(
            prefs_logging.level, log_defaults.level,
            "UserPreferences::default().logging.level must come from LogSettings::default()"
        );
    }

    /// WI-4-D — the wire format the TypeScript `LogLevel` union consumes.
    ///
    /// The frontend ranks levels by exact string match. Dropping
    /// `#[serde(rename_all = "lowercase")]` from `LogLevel` would make this
    /// command emit `"Info"`, the TS `levelRank` lookup would yield
    /// `undefined`, and every frontend log record — errors included — would be
    /// silently discarded. No other test in either lane observes what Rust
    /// actually serialises, so this assertion is the only guard.
    ///
    /// The exact-string form pins the lowercase rename, the field names and
    /// the field order in one go.
    #[test]
    fn log_level_wire_format_matches_typescript_loglevel_union() {
        assert_eq!(
            serde_json::to_string(&LogSettings::default()).unwrap(),
            r#"{"enabled":true,"level":"info"}"#,
            "LogSettings must serialise with lowercase level and this field order"
        );

        // Exhaustive over the complete four-member LogLevel domain.
        for (variant, expected) in [
            (LogLevel::Debug, r#""debug""#),
            (LogLevel::Info, r#""info""#),
            (LogLevel::Warn, r#""warn""#),
            (LogLevel::Error, r#""error""#),
        ] {
            assert_eq!(
                serde_json::to_string(&variant).unwrap(),
                expected,
                "LogLevel::{:?} must serialise as {}",
                variant,
                expected
            );
        }
    }
}
