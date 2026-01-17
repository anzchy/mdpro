use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    /// Theme mode preference
    pub theme_mode: ThemeMode,
    /// Auto-save interval in seconds (default: 30)
    pub auto_save_interval: u32,
    /// Default view mode on startup
    pub default_view_mode: ViewMode,
    /// Show sidebar on startup
    pub show_sidebar: bool,
    /// Enable scroll sync between editor and preview
    pub enable_scroll_sync: bool,
    /// Recently opened files (max 10)
    pub recent_files: Vec<String>,
    /// Window dimensions on last close
    pub window_state: WindowState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewMode {
    Split,
    EditorOnly,
    PreviewOnly,
    Wysiwyg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_maximized: bool,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme_mode: ThemeMode::System,
            auto_save_interval: 30,
            default_view_mode: ViewMode::Split,
            show_sidebar: true,
            enable_scroll_sync: true,
            recent_files: Vec::new(),
            window_state: WindowState {
                width: 1200,
                height: 800,
                x: 100,
                y: 100,
                is_maximized: false,
            },
        }
    }
}
