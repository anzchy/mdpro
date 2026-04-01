use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::models::{AppearanceConfig, AutoSaveConfig, EditorConfig, ExportConfig, ImageConfig, KeyboardShortcuts, LogSettings, MarkdownConfig, McpConfig, TabBarConfig, ThemeMode, UserPreferences, ViewMode, WindowGeometry, WindowState};
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
    pub auto_save: Option<AutoSaveConfig>,
    pub tab_bar: Option<TabBarConfig>,
    pub image: Option<ImageConfig>,
    pub mcp: Option<McpConfig>,
    pub editor: Option<EditorConfig>,
    pub markdown: Option<MarkdownConfig>,
    pub appearance: Option<AppearanceConfig>,
    pub export: Option<ExportConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum PreferencesError {
    IoError { message: String },
    ParseError { message: String },
}

/// Global mutex that serialises the load → merge → save cycle in
/// `set_preferences` and `save_window_state`. Prevents concurrent writes from
/// silently overwriting each other's changes.
pub(crate) fn preferences_rw_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn preferences_dir() -> Result<PathBuf, PreferencesError> {
    let home = dirs::home_dir().ok_or_else(|| PreferencesError::IoError {
        message: "Could not determine home directory".to_string(),
    })?;
    Ok(home.join(".mdpro"))
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

    let final_path = dir.join("config.json");
    let tmp_path = dir.join("config.json.tmp");

    let payload = serde_json::to_string_pretty(preferences).map_err(|err| {
        PreferencesError::ParseError {
            message: err.to_string(),
        }
    })?;

    // Write to a temp file first so a crash mid-write leaves config.json intact.
    fs::write(&tmp_path, payload).map_err(|err| PreferencesError::IoError {
        message: err.to_string(),
    })?;

    // Restrict file permissions on Unix (macOS target: owner read/write only).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600));
    }

    // Atomic rename: either the full new content is visible or the old file remains.
    fs::rename(&tmp_path, &final_path).map_err(|err| PreferencesError::IoError {
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
        auto_save: updates.auto_save.unwrap_or(current.auto_save),
        tab_bar: updates.tab_bar.unwrap_or(current.tab_bar),
        image: updates.image.unwrap_or(current.image),
        mcp: updates.mcp.unwrap_or(current.mcp),
        editor: updates.editor.unwrap_or(current.editor),
        markdown: updates.markdown.unwrap_or(current.markdown),
        appearance: updates.appearance.unwrap_or(current.appearance),
        export: updates.export.unwrap_or(current.export),
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EditorConfig, AppearanceConfig, MarkdownConfig, CodeTheme, UserPreferences};

    /// Constructs a PartialPreferences with all fields set to None except the
    /// ones supplied by the caller. This helper reduces boilerplate in each test.
    fn empty_partial() -> PartialPreferences {
        PartialPreferences {
            theme_mode: None,
            auto_save_interval: None,
            default_view_mode: None,
            last_view_mode: None,
            show_sidebar: None,
            enable_scroll_sync: None,
            recent_files: None,
            window_state: None,
            keyboard_shortcuts: None,
            window_states: None,
            logging: None,
            auto_save: None,
            tab_bar: None,
            image: None,
            mcp: None,
            editor: None,
            markdown: None,
            appearance: None,
            export: None,
        }
    }

    // -----------------------------------------------------------------------
    // merge_preferences — editor field
    // -----------------------------------------------------------------------

    #[test]
    fn merge_editor_some_replaces_editor_config() {
        let current = UserPreferences::default();
        let new_editor = EditorConfig {
            font_size: 18,
            ..EditorConfig::default()
        };
        let updates = PartialPreferences {
            editor: Some(new_editor),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert_eq!(result.editor.font_size, 18);
    }

    #[test]
    fn merge_editor_none_preserves_current_editor_config() {
        let mut current = UserPreferences::default();
        current.editor.font_size = 20;
        let updates = PartialPreferences {
            editor: None,
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert_eq!(result.editor.font_size, 20);
    }

    #[test]
    fn merge_editor_preserves_all_other_fields_when_only_editor_updated() {
        let mut current = UserPreferences::default();
        current.auto_save_interval = 120;
        current.show_sidebar = false;
        let updates = PartialPreferences {
            editor: Some(EditorConfig { font_size: 14, ..EditorConfig::default() }),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        // Editor updated
        assert_eq!(result.editor.font_size, 14);
        // Unrelated fields preserved
        assert_eq!(result.auto_save_interval, 120);
        assert!(!result.show_sidebar);
    }

    // -----------------------------------------------------------------------
    // merge_preferences — markdown field
    // -----------------------------------------------------------------------

    #[test]
    fn merge_markdown_some_updates_auto_pair_to_false() {
        let current = UserPreferences::default();
        assert!(current.markdown.auto_pair, "default auto_pair should be true");
        let updates = PartialPreferences {
            markdown: Some(MarkdownConfig { auto_pair: false }),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert!(!result.markdown.auto_pair);
    }

    #[test]
    fn merge_markdown_none_preserves_current_auto_pair() {
        let mut current = UserPreferences::default();
        current.markdown.auto_pair = false;
        let updates = PartialPreferences {
            markdown: None,
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert!(!result.markdown.auto_pair);
    }

    // -----------------------------------------------------------------------
    // merge_preferences — appearance field
    // -----------------------------------------------------------------------

    #[test]
    fn merge_appearance_some_updates_code_theme_to_one_dark() {
        let current = UserPreferences::default();
        let updates = PartialPreferences {
            appearance: Some(AppearanceConfig { code_theme: CodeTheme::OneDark }),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert!(matches!(result.appearance.code_theme, CodeTheme::OneDark));
    }

    #[test]
    fn merge_appearance_none_preserves_current_code_theme() {
        let mut current = UserPreferences::default();
        current.appearance.code_theme = CodeTheme::OneDark;
        let updates = PartialPreferences {
            appearance: None,
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert!(matches!(result.appearance.code_theme, CodeTheme::OneDark));
    }

    // -----------------------------------------------------------------------
    // merge_preferences — scalar fields
    // -----------------------------------------------------------------------

    #[test]
    fn merge_auto_save_interval_some_updates_value() {
        let current = UserPreferences::default();
        let updates = PartialPreferences {
            auto_save_interval: Some(300),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert_eq!(result.auto_save_interval, 300);
    }

    #[test]
    fn merge_auto_save_interval_none_preserves_current() {
        let mut current = UserPreferences::default();
        current.auto_save_interval = 60;
        let updates = empty_partial(); // all None
        let result = merge_preferences(current, updates);
        assert_eq!(result.auto_save_interval, 60);
    }

    #[test]
    fn merge_show_sidebar_some_flips_value() {
        let mut current = UserPreferences::default();
        current.show_sidebar = true;
        let updates = PartialPreferences {
            show_sidebar: Some(false),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        assert!(!result.show_sidebar);
    }

    // -----------------------------------------------------------------------
    // load_preferences — error paths (serde layer)
    // -----------------------------------------------------------------------

    #[test]
    fn deserialise_returns_error_on_malformed_json() {
        // Simulates what load_preferences does on a corrupt config file.
        let malformed = "{ not valid json !! }";
        let result = serde_json::from_str::<UserPreferences>(malformed);
        assert!(result.is_err(), "malformed JSON should not deserialise into UserPreferences");
    }

    #[test]
    fn deserialise_succeeds_on_partial_json_with_serde_defaults() {
        // A config written by an older version (missing newer fields) should
        // still deserialise because all nested structs carry #[serde(default)].
        let minimal = r#"{"themeMode":"light","autoSaveInterval":30,"defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","showSidebar":true,"enableScrollSync":true,"recentFiles":[],"windowState":{"width":1200,"height":800,"x":100,"y":100,"isMaximized":false}}"#;
        let result = serde_json::from_str::<UserPreferences>(minimal);
        assert!(result.is_ok(), "partial JSON (missing newer fields) should still deserialise: {:?}", result.err());
    }

    #[test]
    fn serialise_then_deserialise_round_trips_cleanly() {
        let original = UserPreferences::default();
        let json = serde_json::to_string_pretty(&original).expect("serialise");
        let decoded: UserPreferences = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(decoded.auto_save_interval, original.auto_save_interval);
        assert_eq!(decoded.show_sidebar, original.show_sidebar);
        assert_eq!(decoded.editor.font_size, original.editor.font_size);
    }

    #[test]
    fn merge_preserves_all_fields_when_only_one_updated() {
        // Regression guard: adding a new field to UserPreferences/PartialPreferences
        // but forgetting to add it to merge_preferences would cause a compile error
        // (struct initialiser must be complete). This test documents the expectation
        // that unrelated fields survive a partial merge.
        let mut current = UserPreferences::default();
        current.auto_save_interval = 999;
        current.show_sidebar = false;
        current.enable_scroll_sync = false;

        let updates = PartialPreferences {
            editor: Some(EditorConfig { font_size: 20, ..EditorConfig::default() }),
            ..empty_partial()
        };

        let result = merge_preferences(current, updates);

        // Changed
        assert_eq!(result.editor.font_size, 20);
        // Untouched
        assert_eq!(result.auto_save_interval, 999);
        assert!(!result.show_sidebar);
        assert!(!result.enable_scroll_sync);
    }
}
