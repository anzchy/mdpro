//! `save_window_state` IPC command: only the `main` window may write the
//! global `windowState` in `~/.mdpro/config.json` (ADR-0037 Decision 3).
//!
//! Purpose: the save side of ADR-0037. Hydration already applies the global
//! `windowState` to `main` only (`src/utils/windowGeometry.ts`,
//! `ownsGlobalWindowState`); this module makes the write mirror that.
//!
//! Pipeline: `save_window_state` (Tauri command, `window.label()` injected by
//! Tauri, JS payload `{ windowState }` unchanged) → [`save_window_state_as`]
//! → owner: the unguarded writer `preferences::save_window_state` (lock →
//! load → update → save) / non-owner: skip.
//!
//! Key decisions:
//! - [`owns_global_window_state`] is exact equality with
//!   [`GLOBAL_WINDOW_STATE_OWNER`]: no prefix match, case folding or trimming,
//!   the same contract as the frontend.
//! - A non-owner takes no lock, does no load and no write, and returns
//!   `Ok(())`. It logs a `Start` + `Success` pair under
//!   `preferences.window_state.save` with context
//!   `{field, outcome:"skipped", reason:"not_main"}` — never the label.
//! - The label check lives here, not in `preferences.rs`, so that writer (and
//!   its oversized test file) keep their signature. A `tauri::Window` cannot be
//!   built in a unit test, so the logic is tested through
//!   [`save_window_state_as`]; the thin command wrapper is covered by the
//!   step-5b GUI acceptance item GA-10.
//!
//! @coordinates-with `commands/preferences.rs` (the writer),
//! `commands/mod.rs` (registration), `src/services/preferencesService.ts`.

use serde_json::json;
use tauri::Window;

use crate::commands::preferences::{self, WINDOW_STATE_SAVE_EVENT};
use crate::models::{LogEntryPayload, LogLevel, LogStatus, WindowState};
use crate::services::logger;
use crate::services::preferences::PreferencesError;

/// The only window label allowed to write the global `windowState`.
pub(crate) const GLOBAL_WINDOW_STATE_OWNER: &str = "main";

/// Exact equality with [`GLOBAL_WINDOW_STATE_OWNER`].
pub(crate) fn owns_global_window_state(label: &str) -> bool {
    label == GLOBAL_WINDOW_STATE_OWNER
}

/// Saves `window_state` as the global `windowState` if `label` owns it.
///
/// Owner: delegates to `preferences::save_window_state` (its own lock, load,
/// log pair and error propagation). Non-owner: logs a `Start` + `Success` pair
/// with a skip context, touches neither the lock nor the file, returns `Ok`.
pub(crate) async fn save_window_state_as(
    label: &str,
    window_state: WindowState,
) -> Result<(), PreferencesError> {
    if owns_global_window_state(label) {
        return preferences::save_window_state(window_state).await;
    }
    log_skip();
    Ok(())
}

/// The non-owner log pair. Carries no label and no coordinate.
fn log_skip() {
    let action_id = uuid::Uuid::new_v4().to_string();
    let context = json!({ "field": "windowState", "outcome": "skipped", "reason": "not_main" });
    for status in [LogStatus::Start, LogStatus::Success] {
        let is_start = matches!(status, LogStatus::Start);
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: WINDOW_STATE_SAVE_EVENT.to_string(),
            status,
            action_id: Some(action_id.clone()),
            context: Some(context.clone()),
            duration_ms: if is_start { None } else { Some(0) },
            error: None,
        });
    }
}

/// Tauri command: persists the closing window's geometry, `main` only.
#[tauri::command]
pub async fn save_window_state(
    window: Window,
    window_state: WindowState,
) -> Result<(), PreferencesError> {
    save_window_state_as(window.label(), window_state).await
}

#[cfg(test)]
#[path = "window_state_tests.rs"]
mod tests;
