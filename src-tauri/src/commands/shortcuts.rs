//! Purpose: the `get_applied_shortcuts` IPC command (M1a WI-4, ADR-0114):
//! returns the keyboard-shortcut snapshot this run applied at startup. A Settings
//! save does not change it; a restart does.
//!
//! Key decisions:
//! - The command is a one-line delegate to [`get_applied_shortcuts_inner`],
//!   so it is testable without a Tauri runtime (a `State<'_, _>` cannot be
//!   built in a unit test).
//! - It logs the bound count only: never a chord, a sentinel or a path.
//!
//! @coordinates-with services/applied_shortcuts.rs — the snapshot and its state
//! @coordinates-with src/services/preferencesService.ts — `getAppliedShortcuts()`

use std::time::Instant;

use serde_json::json;
use tauri::State;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::applied_shortcuts::{binding_counts, AppliedShortcuts, AppliedShortcutsState};
use crate::services::logger;

const GET_EVENT: &str = "preferences.shortcuts.applied.get";

/// Returns the applied snapshot (`get_applied_shortcuts`).
#[tauri::command]
pub fn get_applied_shortcuts(
    state: State<'_, AppliedShortcutsState>,
) -> Result<AppliedShortcuts, String> {
    get_applied_shortcuts_inner(&state)
}

/// The body of [`get_applied_shortcuts`]: a copy of the snapshot, with a
/// `Start` / `Success` log pair. Never fails; `Result` is the IPC contract.
pub fn get_applied_shortcuts_inner(
    state: &AppliedShortcutsState,
) -> Result<AppliedShortcuts, String> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: GET_EVENT.to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: None,
        duration_ms: None,
        error: None,
    });
    let snapshot = state.snapshot().clone();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: GET_EVENT.to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({ "boundCount": binding_counts(&snapshot.bindings).bound })),
        duration_ms: Some(u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)),
        error: None,
    });
    Ok(snapshot)
}
