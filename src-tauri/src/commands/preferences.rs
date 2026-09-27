use serde_json::json;
use tauri::Theme;
use tauri::Window;

use crate::models::{LogEntryPayload, LogLevel, LogStatus, UserPreferences, WindowState};
use crate::services::logger;
use crate::services::preferences::{
    load_preferences, merge_preferences, preferences_rw_lock, save_preferences, PartialPreferences,
    PreferencesError,
};

#[tauri::command]
pub async fn get_preferences() -> Result<UserPreferences, String> {
    load_preferences().map_err(|e| format!("Failed to load preferences: {:?}", e))
}

/// Event name for the `save_window_state` Start/terminal log pair (rule 20).
pub(crate) const WINDOW_STATE_SAVE_EVENT: &str = "preferences.window_state.save";

/// The variant name of `e`, and nothing else, for a Fail record's `error`.
///
/// Both writers' Fail records log only this. The variant's `message` can carry
/// serde position text, OS error text or a home-dir path, none of which belongs
/// in `~/.mdpro/mdpro.log` (same contract as `DraftError::kind()`). The match is
/// exhaustive on purpose: a new variant must choose its logged name here.
fn error_kind(e: &PreferencesError) -> &'static str {
    match e {
        PreferencesError::IoError { .. } => "IoError",
        PreferencesError::ParseError { .. } => "ParseError",
    }
}

/// Applies a partial preferences patch to `~/.mdpro/config.json`.
///
/// # A failed load is propagated, never defaulted (ADR-0031 step 1)
///
/// `load_preferences()` is propagated with `?`. It used to fall back to a
/// default `UserPreferences` on failure, which turned one unreadable or corrupt
/// config.json into total settings loss: `current` became a default struct, and
/// the very next partial write persisted those defaults over every other
/// setting the user had. Failing loudly leaves the existing file untouched.
///
/// The **native** error type is propagated, not a re-wrapped one: a serde
/// failure is `PreferencesError::ParseError` (`services/preferences.rs:74`),
/// while `read_to_string` (`:70`) and a missing home dir (`:52`) are
/// `IoError`. Labelling a parse failure `IoError` would be a lie to the
/// caller. (`commands/logging.rs` re-wraps; that is a separate pre-existing
/// inaccuracy, not a pattern to copy.)
///
/// # Logging
///
/// A `Start` plus one `Success`/`Fail` record under `preferences.set`, sharing
/// one `actionId`. The Fail record's `error` is the variant name only (see
/// [`error_kind`]), never the error's message.
#[tauri::command]
pub async fn set_preferences(
    preferences: PartialPreferences,
) -> Result<UserPreferences, PreferencesError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "preferences.set".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "partial": true })),
        duration_ms: None,
        error: None,
    });

    // Hold the lock for the entire read → merge → write to prevent concurrent
    // calls from overwriting each other's changes.
    let result = (|| {
        let _lock = preferences_rw_lock()
            .lock()
            .map_err(|_| PreferencesError::IoError {
                message: "preferences lock poisoned".to_string(),
            })?;
        let current = load_preferences()?;
        let next = merge_preferences(current, preferences);
        save_preferences(&next)?;
        Ok(next)
    })();

    let elapsed = start.elapsed().as_millis() as u64;
    match &result {
        Ok(_) => logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "preferences.set".to_string(),
            status: LogStatus::Success,
            action_id: Some(action_id),
            context: None,
            duration_ms: Some(elapsed),
            error: None,
        }),
        Err(e) => logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "preferences.set".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id),
            context: None,
            duration_ms: Some(elapsed),
            error: Some(error_kind(e).to_string()),
        }),
    }
    result
}

#[tauri::command]
pub fn get_system_theme(window: Window) -> Result<String, String> {
    let theme = window
        .theme()
        .map_err(|e| format!("Failed to get system theme: {}", e))?;
    Ok(match theme {
        Theme::Dark => "dark".to_string(),
        _ => "light".to_string(),
    })
}

#[tauri::command]
pub async fn pick_export_folder() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .map(|p| p.path().to_string_lossy().to_string());
    Ok(folder)
}

/// Persists the window geometry captured on close into the `windowState`
/// field, leaving every other preference as it was on disk.
///
/// # A failed load is propagated, never defaulted (ADR-0031 step 1)
///
/// Same rationale as [`set_preferences`]: the old defaults fallback here
/// rewrote the whole document from defaults on the strength of one unreadable
/// file.
/// The native `PreferencesError` — `ParseError` for a serde failure, `IoError`
/// for an unreadable file or a missing home dir — is propagated unwrapped.
///
/// # Logging
///
/// Emits a `Start` plus exactly one `Success`/`Fail` record under
/// [`WINDOW_STATE_SAVE_EVENT`], sharing one `actionId` (rule 20). The failure
/// path only became reachable with the change above, so it has to be visible
/// in `~/.mdpro/mdpro.log`. The context carries field names and no values: a
/// window rectangle is not secret, but the log must not grow a habit of
/// carrying payloads.
/// The Fail record's `error` is the variant name only (see [`error_kind`]).
///
/// # Not a command; callers must be `main` (ADR-0037 Decision 3)
///
/// This is the **unguarded** writer. The `save_window_state` IPC command lives
/// in `commands/window_state.rs`, which checks the invoking window's label and
/// calls this only for `main`. Do not call it from anywhere else.
pub(crate) async fn save_window_state(window_state: WindowState) -> Result<(), PreferencesError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: WINDOW_STATE_SAVE_EVENT.to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "field": "windowState" })),
        duration_ms: None,
        error: None,
    });

    // Hold the lock for the entire read → update → write, as set_preferences
    // does: all writers share ~/.mdpro/config.json.
    let result = (|| {
        let _lock = preferences_rw_lock()
            .lock()
            .map_err(|_| PreferencesError::IoError {
                message: "preferences lock poisoned".to_string(),
            })?;
        let current = load_preferences()?;
        let next = UserPreferences {
            window_state,
            ..current
        };
        save_preferences(&next)
    })();

    let elapsed = start.elapsed().as_millis() as u64;
    match &result {
        Ok(_) => logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: WINDOW_STATE_SAVE_EVENT.to_string(),
            status: LogStatus::Success,
            action_id: Some(action_id),
            context: None,
            duration_ms: Some(elapsed),
            error: None,
        }),
        Err(e) => logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: WINDOW_STATE_SAVE_EVENT.to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id),
            context: None,
            duration_ms: Some(elapsed),
            error: Some(error_kind(e).to_string()),
        }),
    }
    result
}

#[cfg(test)]
#[path = "preferences_tests.rs"]
mod preferences_tests;

#[cfg(test)]
#[path = "preferences_log_redaction_tests.rs"]
mod preferences_log_redaction_tests;
