use crate::models::{LogEntryPayload, LogLevel, LogStatus, WindowGeometry};
use crate::services::logger;
use crate::services::preferences::{load_preferences, preferences_rw_lock, save_preferences};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

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
    let mut builder = WebviewWindowBuilder::new(
        &app,
        &window_id,
        WebviewUrl::default(),
    )
    .title("Untitled - mdpro")
    .min_inner_size(600.0, 400.0);

    // Apply stored or default geometry
    if let Some(geo) = geometry {
        builder = builder
            .position(geo.x as f64, geo.y as f64)
            .inner_size(geo.width as f64, geo.height as f64);
    } else {
        builder = builder.inner_size(1200.0, 800.0);
    }

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
    let _lock = preferences_rw_lock()
        .lock()
        .map_err(|_| "preferences lock poisoned".to_string())?;

    let mut prefs = load_preferences().map_err(|e| format!("{:?}", e))?;

    // Update geometry with current timestamp
    let mut geo = geometry;
    geo.last_accessed = chrono::Utc::now().timestamp();

    // Insert or update
    prefs.window_states.insert(file_path, geo);

    // LRU eviction: keep only 100 most recent entries
    if prefs.window_states.len() > 100 {
        let mut entries: Vec<_> = prefs.window_states.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        entries.sort_by(|a, b| a.1.last_accessed.cmp(&b.1.last_accessed));

        // Remove oldest entries
        let to_remove = entries.len() - 100;
        for (key, _) in entries.iter().take(to_remove) {
            prefs.window_states.remove(key);
        }
    }

    save_preferences(&prefs).map_err(|e| format!("{:?}", e))?;
    Ok(())
}

/// Get stored window geometry for a file path
#[tauri::command]
pub async fn get_window_geometry(
    file_path: String,
) -> Result<GetWindowGeometryResponse, String> {
    let prefs = load_preferences().map_err(|e| format!("{:?}", e))?;
    let geometry = prefs.window_states.get(&file_path).cloned();
    Ok(GetWindowGeometryResponse { geometry })
}

/// Helper to get stored geometry
fn get_stored_geometry(file_path: &str) -> Option<WindowGeometry> {
    let prefs = load_preferences().ok()?;
    prefs.window_states.get(file_path).cloned()
}
