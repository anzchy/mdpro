use crate::models::WindowGeometry;
use crate::services::preferences::{load_preferences, save_preferences};
use serde::{Deserialize, Serialize};
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

    let window = builder.build().map_err(|e| format!("Failed to create window: {}", e))?;

    // If file path provided, emit event to new window to open the file
    if let Some(path) = file_path {
        let _ = window.emit("file:open", vec![path]);
    }

    Ok(CreateWindowResponse { window_id })
}

/// Save window geometry for a file path
#[tauri::command]
pub async fn save_window_geometry(
    file_path: String,
    geometry: WindowGeometry,
) -> Result<(), String> {
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
