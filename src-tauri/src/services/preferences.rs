use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{KeyboardShortcuts, LogSettings, ThemeMode, UserPreferences, ViewMode, WindowGeometry, WindowState};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialPreferences {
    pub theme_mode: Option<ThemeMode>,
    pub auto_save_interval: Option<u32>,
    pub default_view_mode: Option<ViewMode>,
    pub last_view_mode: Option<ViewMode>,
    pub show_sidebar: Option<bool>,
    pub enable_scroll_sync: Option<bool>,
    pub recent_files: Option<Vec<String>>,
    pub window_state: Option<WindowState>,
    pub keyboard_shortcuts: Option<KeyboardShortcuts>,
    pub window_states: Option<HashMap<String, WindowGeometry>>,
    pub logging: Option<LogSettings>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum PreferencesError {
    IoError { message: String },
    ParseError { message: String },
}

fn preferences_dir() -> Result<PathBuf, PreferencesError> {
    let home = std::env::var("HOME")
        .map_err(|err| PreferencesError::IoError {
            message: err.to_string(),
        })?;
    Ok(Path::new(&home).join(".mdpro"))
}

fn config_path() -> Result<PathBuf, PreferencesError> {
    Ok(preferences_dir()?.join("config.json"))
}

pub fn load_preferences() -> Result<UserPreferences, PreferencesError> {
    let path = config_path()?;
    if !path.exists() {
        let defaults = UserPreferences::default();
        save_preferences(&defaults)?;
        return Ok(defaults);
    }

    let contents = fs::read_to_string(&path).map_err(|err| PreferencesError::IoError {
        message: err.to_string(),
    })?;

    serde_json::from_str(&contents).map_err(|err| PreferencesError::ParseError {
        message: err.to_string(),
    })
}

pub fn save_preferences(preferences: &UserPreferences) -> Result<(), PreferencesError> {
    let dir = preferences_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|err| PreferencesError::IoError {
            message: err.to_string(),
        })?;
    }

    let path = dir.join("config.json");
    let payload = serde_json::to_string_pretty(preferences).map_err(|err| {
        PreferencesError::ParseError {
            message: err.to_string(),
        }
    })?;

    fs::write(path, payload).map_err(|err| PreferencesError::IoError {
        message: err.to_string(),
    })?;

    Ok(())
}

pub fn merge_preferences(current: UserPreferences, updates: PartialPreferences) -> UserPreferences {
    UserPreferences {
        theme_mode: updates.theme_mode.unwrap_or(current.theme_mode),
        auto_save_interval: updates
            .auto_save_interval
            .unwrap_or(current.auto_save_interval),
        default_view_mode: updates
            .default_view_mode
            .unwrap_or(current.default_view_mode),
        last_view_mode: updates
            .last_view_mode
            .unwrap_or(current.last_view_mode),
        show_sidebar: updates.show_sidebar.unwrap_or(current.show_sidebar),
        enable_scroll_sync: updates
            .enable_scroll_sync
            .unwrap_or(current.enable_scroll_sync),
        recent_files: updates.recent_files.unwrap_or(current.recent_files),
        window_state: updates.window_state.unwrap_or(current.window_state),
        keyboard_shortcuts: updates
            .keyboard_shortcuts
            .unwrap_or(current.keyboard_shortcuts),
        window_states: updates.window_states.unwrap_or(current.window_states),
        logging: updates.logging.unwrap_or(current.logging),
    }
}
