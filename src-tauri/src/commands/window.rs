use crate::models::{LogEntryPayload, LogLevel, LogStatus, WindowGeometry};
use crate::services::logger;
use crate::services::preferences::{load_preferences, preferences_rw_lock, save_preferences};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

/// The pure geometry rules (validation, clamp, resolve). Kept in their own file
/// so this one stays under the 300-line limit (rule 50 §6); they are private to
/// the window commands, not a public surface.
#[path = "window_geometry.rs"]
mod geometry;
use geometry::{
    clamp_geometry, resolve_window_geometry, sanitize_geometry, GeometryError, ResolvedGeometry,
    WorkArea, DEFAULT_WINDOW_SIZE, FALLBACK_WORK_AREA, MAX_WINDOW_COORDINATE, MAX_WINDOW_DIMENSION,
    MIN_WINDOW_COORDINATE, MIN_WINDOW_SIZE,
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

/// Create a new mdpro window, optionally with a file to open
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

    let window_id = format!("mdpro-{}", Uuid::new_v4());

    // Get stored geometry if file path provided
    let geometry = if let Some(ref path) = file_path {
        get_stored_geometry(path)
    } else {
        None
    };

    // Build the window
    let mut builder = WebviewWindowBuilder::new(&app, &window_id, WebviewUrl::default())
        .title("Untitled - mdpro")
        .min_inner_size(MIN_WINDOW_SIZE.0, MIN_WINDOW_SIZE.1);

    // Apply stored or default geometry. The *decision* lives in
    // `resolve_window_geometry` so the rust lane can test it; only the builder
    // calls below need a live app handle and a window server.
    let resolved = resolve_window_geometry(geometry, primary_work_area(&app), MIN_WINDOW_SIZE);
    if let Some((x, y)) = resolved.position {
        builder = builder.position(x, y);
    }
    builder = builder.inner_size(resolved.size.0, resolved.size.1);

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
        level: LogLevel::Info,
        event: "window.create".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({ "windowId": window_id, "filePath": file_path })),
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

/// Get stored window geometry for a file path
#[tauri::command]
pub async fn get_window_geometry(file_path: String) -> Result<GetWindowGeometryResponse, String> {
    let prefs = load_preferences().map_err(|e| format!("{:?}", e))?;
    let geometry = prefs.window_states.get(&file_path).cloned();
    Ok(GetWindowGeometryResponse { geometry })
}

/// Helper to get stored geometry
fn get_stored_geometry(file_path: &str) -> Option<WindowGeometry> {
    let prefs = load_preferences().ok()?;
    prefs.window_states.get(file_path).cloned()
}

/// The primary monitor's work area in logical points, or [`FALLBACK_WORK_AREA`]
/// when the platform reports no monitor.
fn primary_work_area(app: &AppHandle) -> WorkArea {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return FALLBACK_WORK_AREA;
    };
    let raw = monitor.scale_factor();
    let scale = if raw.is_finite() && raw > 0.0 {
        raw
    } else {
        1.0
    };
    let area = monitor.work_area();
    WorkArea {
        x: area.position.x as f64 / scale,
        y: area.position.y as f64 / scale,
        width: area.size.width as f64 / scale,
        height: area.size.height as f64 / scale,
    }
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod window_tests;
