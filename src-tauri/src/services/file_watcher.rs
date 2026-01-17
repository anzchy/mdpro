use serde::Serialize;
use tauri::{AppHandle, Manager, Theme};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeChangedEvent {
    pub theme: String,
}

pub fn emit_theme_changed(app_handle: &AppHandle, theme: &Theme) {
    let value = match theme {
        Theme::Dark => "dark",
        _ => "light",
    };
    let _ = app_handle.emit_all(
        "theme:changed",
        ThemeChangedEvent {
            theme: value.to_string(),
        },
    );
}
