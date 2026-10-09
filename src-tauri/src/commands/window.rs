use crate::models::{LogEntryPayload, LogLevel, LogStatus, WindowGeometry};
use crate::services::logger;
use crate::services::preferences::{load_preferences, preferences_rw_lock, save_preferences};
use crate::services::quit_guard::{effects::AppQuitGuard, window_gate::new_window_gate};
use crate::services::window_restore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

/// The pure geometry rules (validation, clamp, resolve) live in
/// `services/window_geometry.rs`, shared with `services/window_restore.rs`.
use crate::services::window_geometry::sanitize_geometry;
// `window_tests.rs` reaches the rest of the rules through `use super::*`.
#[cfg(test)]
use crate::services::window_geometry::{
    clamp_geometry, resolve_window_geometry, GeometryError, WorkArea, DEFAULT_WINDOW_SIZE,
    MAX_WINDOW_COORDINATE, MAX_WINDOW_DIMENSION, MIN_WINDOW_COORDINATE, MIN_WINDOW_SIZE,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWindowResponse {
    pub window_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWindowGeometryResponse {
    pub geometry: Option<WindowGeometry>,
}

/// Create a new mdpro window, optionally with a file to open.
///
/// While a quit request is live this returns
/// `Err(quit_guard::window_gate::QUIT_PENDING_REFUSAL)` and builds nothing
/// (D74); `windowService.createWindow` treats that error as a quiet `null`.
#[tauri::command]
pub async fn create_window(
    app: AppHandle,
    file_path: Option<String>,
) -> Result<CreateWindowResponse, String> {
    let action_id = Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "window.create".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "filePath": file_path })),
        duration_ms: None,
        error: None,
    });

    // D74: a window opened while a quit request is live is outside that
    // request's snapshot — never prompted, never waited for — so it is refused.
    // The gate drops the coordinator lock before returning; the build below
    // must never run under it (see `quit_guard::window_gate`).
    if let Err(refusal) = new_window_gate(app.try_state::<AppQuitGuard>().as_deref()) {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Warn,
            event: "window.create".to_string(),
            status: LogStatus::Cancel,
            action_id: Some(action_id),
            context: Some(json!({ "reason": "quit_pending" })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(refusal.to_string()),
        });
        return Err(refusal.to_string());
    }

    let window_id = format!("mdpro-{}", Uuid::new_v4());

    // Stored geometry for the file (any spelling of its path), else the fitted
    // default with no position. The decision is `window_restore`'s, shared with
    // `open_file_in_new_window`; only `apply_resolved` touches the builder.
    let (resolved, outcome) = window_restore::restore_geometry_for(
        file_path.as_deref(),
        window_restore::primary_work_area(&app),
    );
    let builder = WebviewWindowBuilder::new(&app, &window_id, WebviewUrl::default())
        .title("Untitled - mdpro");
    let builder = window_restore::apply_resolved(builder, &resolved);

    let window = builder.build().map_err(|e| {
        let elapsed = start.elapsed().as_millis() as u64;
        let err_msg = format!("Failed to create window: {}", e);
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "window.create".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "filePath": file_path })),
            duration_ms: Some(elapsed),
            error: Some(err_msg.clone()),
        });
        err_msg
    })?;

    // If file path provided, emit event to new window to open the file
    if let Some(ref path) = file_path {
        let _ = window.emit("file:open", vec![path.clone()]);
    }

    let elapsed = start.elapsed().as_millis() as u64;
    logger::log_event(LogEntryPayload {
        level: window_restore::restore_log_level(&outcome),
        event: "window.create".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(window_restore::window_create_context(
            &window_id,
            file_path.as_deref(),
            &outcome,
        )),
        duration_ms: Some(elapsed),
        error: None,
    });

    Ok(CreateWindowResponse { window_id })
}

/// Save window geometry for a file path
#[tauri::command]
pub async fn save_window_geometry(
    file_path: String,
    geometry: WindowGeometry,
) -> Result<(), String> {
    // Rule 60: this command trusts nothing from the frontend. The guard is the
    // first statement so a rejection cannot have touched config.json — `width`
    // and `height` are `u32`, so `0` is representable and used to be accepted.
    let mut geo = sanitize_geometry(geometry).map_err(|e| e.to_string())?;

    let _lock = preferences_rw_lock()
        .lock()
        .map_err(|_| "preferences lock poisoned".to_string())?;

    let mut prefs = load_preferences().map_err(|e| format!("{:?}", e))?;

    // Update geometry with current timestamp
    geo.last_accessed = chrono::Utc::now().timestamp();

    // Insert or update
    let inserted_key = file_path.clone();
    prefs.window_states.insert(file_path, geo);

    // LRU eviction: keep only 100 most recent entries.
    //
    // The entry this call just inserted is excluded from the candidate set
    // outright (WI3-J): a clock skew or a hand-edited future `lastAccessed`
    // otherwise makes the record the user just produced the oldest one, and
    // eviction deletes the very thing the call was for. Ties then break on the
    // key, because `HashMap` iteration order is not deterministic and a tie
    // would otherwise make the evicted entry random.
    if prefs.window_states.len() > 100 {
        let mut entries: Vec<(String, i64)> = prefs
            .window_states
            .iter()
            .filter(|(key, _)| *key != &inserted_key)
            .map(|(k, v)| (k.clone(), v.last_accessed))
            .collect();
        entries.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

        // Remove oldest entries
        let to_remove = prefs.window_states.len() - 100;
        for (key, _) in entries.iter().take(to_remove) {
            prefs.window_states.remove(key);
        }
    }

    save_preferences(&prefs).map_err(|e| format!("{:?}", e))?;
    Ok(())
}

/// Get the stored window geometry for a file path — the DevTools confirmation
/// surface. Goes through `window_restore::read_stored_geometry`, the same read
/// restore uses: under `preferences_rw_lock` (so a first-run default
/// `config.json` cannot race a `save_window_geometry`) and with the same
/// alias-tolerant lookup, so what it reports is what a window opened for that
/// file gets. A corrupt `config.json` is an `Err`, not a fake `None`.
#[tauri::command]
pub async fn get_window_geometry(file_path: String) -> Result<GetWindowGeometryResponse, String> {
    let geometry =
        window_restore::read_stored_geometry(&file_path).map_err(|e| format!("{:?}", e))?;
    Ok(GetWindowGeometryResponse { geometry })
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod window_tests;
// The lookup fixture is shared with `open_route::lookup`, not copied (its
// items are `pub(super)`, so each user re-includes it). Only the `Fixture`
// part is used here, hence `dead_code`.
#[cfg(all(test, unix))]
#[allow(dead_code, clippy::duplicate_mod)]
#[path = "../services/open_route/lookup_fixture.rs"]
mod window_fixture;
#[cfg(test)]
#[path = "window_locked_get_tests.rs"]
mod window_locked_get_tests;
#[cfg(all(test, unix))]
#[path = "window_lookup_tests.rs"]
mod window_lookup_tests;
#[cfg(test)]
#[path = "window_wiring_tests.rs"]
mod window_wiring_tests;

#[cfg(test)]
#[path = "window_quit_gate_tests.rs"]
mod window_quit_gate_tests;
