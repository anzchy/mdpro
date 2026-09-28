use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::models::{
    AppearanceConfig, AutoSaveConfig, EditorConfig, ExportConfig, ImageConfig, KeyboardShortcuts,
    LogSettings, MarkdownConfig, McpConfig, TabBarConfig, ThemeMode, UserPreferences, ViewMode,
    WindowGeometry, WindowState,
};
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

/// `~/.mdpro/config.json`. Shared with the read-only MCP launch reader
/// (`services/mcp_launch.rs`) so both agree on one path.
pub(crate) fn config_path() -> Result<PathBuf, PreferencesError> {
    Ok(preferences_dir()?.join("config.json"))
}

/// Reads `~/.mdpro/config.json`, materialising defaults on first run.
///
/// # Empty shortcut bindings are repaired here (ADR-0031 step 4, decision D-b)
///
/// Every `config.json` a shipped build ever wrote holds 58 empty
/// `keyboardShortcuts` values, because `KeyboardShortcuts` used to derive
/// `Default`. Those keys are **present**, so serde's per-field defaults never
/// fire for them — only a read-time repair reaches them, which is what
/// [`KeyboardShortcuts::with_empty_bindings_defaulted`] does, per field, without
/// disturbing a binding the user actually set.
///
/// **The repair is load-side only**: a `""` may still sit on disk (a whole-group
/// write through `set_preferences` puts one there unchanged) and is substituted
/// on every read. `models/preferences_wi7_tests.rs::wi7_g_…` pins that exact
/// invariant; see the doc comment on the method for why the stronger write-side
/// claim was not taken.
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

    let mut preferences: UserPreferences =
        serde_json::from_str(&contents).map_err(|err| PreferencesError::ParseError {
            message: err.to_string(),
        })?;
    preferences.keyboard_shortcuts = preferences
        .keyboard_shortcuts
        .with_empty_bindings_defaulted();
    Ok(preferences)
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

    let payload =
        serde_json::to_string_pretty(preferences).map_err(|err| PreferencesError::ParseError {
            message: err.to_string(),
        })?;

    // Write to a temp file first so a crash mid-write leaves config.json intact.
    // Write + flush + fsync so the bytes are durable before the rename — a
    // power loss between rename and an unsynced write could otherwise leave a
    // renamed-but-empty config.
    {
        use std::io::Write;
        let mut file = fs::File::create(&tmp_path).map_err(|err| PreferencesError::IoError {
            message: err.to_string(),
        })?;
        file.write_all(payload.as_bytes())
            .and_then(|_| file.flush())
            .and_then(|_| file.sync_all())
            .map_err(|err| {
                // Remove the partial temp so a failed write leaves no debris.
                let _ = fs::remove_file(&tmp_path);
                PreferencesError::IoError {
                    message: err.to_string(),
                }
            })?;
    }

    // Restrict file permissions on Unix (macOS target: owner read/write only).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600));
    }

    // Atomic rename: either the full new content is visible or the old file
    // remains. On failure, remove the temp so it isn't left behind.
    fs::rename(&tmp_path, &final_path).map_err(|err| {
        let _ = fs::remove_file(&tmp_path);
        PreferencesError::IoError {
            message: err.to_string(),
        }
    })?;

    // Durability of the rename itself: best-effort fsync of the parent dir.
    if let Ok(dir_handle) = fs::File::open(&dir) {
        let _ = dir_handle.sync_all();
    }

    Ok(())
}

/// Nested groups are replaced wholesale, except `mcp.serverEnabled`, which is
/// kept from disk: only `persist_server_enabled` writes it (ADR-0040).
pub fn merge_preferences(current: UserPreferences, updates: PartialPreferences) -> UserPreferences {
    UserPreferences {
        theme_mode: updates.theme_mode.unwrap_or(current.theme_mode),
        auto_save_interval: updates
            .auto_save_interval
            .unwrap_or(current.auto_save_interval),
        default_view_mode: updates
            .default_view_mode
            .unwrap_or(current.default_view_mode),
        last_view_mode: updates.last_view_mode.unwrap_or(current.last_view_mode),
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
        mcp: updates
            .mcp
            .map(|m| McpConfig {
                server_enabled: current.mcp.server_enabled,
                ..m
            })
            .unwrap_or(current.mcp),
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
    use crate::models::{
        AppearanceConfig, CodeTheme, EditorConfig, MarkdownConfig, UserPreferences,
    };

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
        let current = UserPreferences {
            auto_save_interval: 120,
            show_sidebar: false,
            ..UserPreferences::default()
        };
        let updates = PartialPreferences {
            editor: Some(EditorConfig {
                font_size: 14,
                ..EditorConfig::default()
            }),
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
        assert!(
            current.markdown.auto_pair,
            "default auto_pair should be true"
        );
        let updates = PartialPreferences {
            markdown: Some(MarkdownConfig {
                auto_pair: false,
                auto_reformat_tables_on_save: false,
            }),
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
            appearance: Some(AppearanceConfig {
                code_theme: CodeTheme::OneDark,
            }),
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
        let current = UserPreferences {
            auto_save_interval: 60,
            ..UserPreferences::default()
        };
        let updates = empty_partial(); // all None
        let result = merge_preferences(current, updates);
        assert_eq!(result.auto_save_interval, 60);
    }

    #[test]
    fn merge_show_sidebar_some_flips_value() {
        let current = UserPreferences {
            show_sidebar: true,
            ..UserPreferences::default()
        };
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
        assert!(
            result.is_err(),
            "malformed JSON should not deserialise into UserPreferences"
        );
    }

    #[test]
    fn deserialise_succeeds_on_partial_json_with_serde_defaults() {
        // A config written by an older version (missing newer fields) should
        // still deserialise because all nested structs carry #[serde(default)].
        let minimal = r#"{"themeMode":"light","autoSaveInterval":30,"defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","showSidebar":true,"enableScrollSync":true,"recentFiles":[],"windowState":{"width":1200,"height":800,"x":100,"y":100,"isMaximized":false}}"#;
        let result = serde_json::from_str::<UserPreferences>(minimal);
        assert!(
            result.is_ok(),
            "partial JSON (missing newer fields) should still deserialise: {:?}",
            result.err()
        );
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

    // -----------------------------------------------------------------------
    // save_preferences → load_preferences round-trip (persist across "restart")
    //
    // Isolated under $HOME so the test never touches the developer's real
    // ~/.mdpro/config.json. Uses HOME_LOCK to serialise with other HOME-mutating
    // tests (file.rs / draft.rs follow the same pattern).
    // -----------------------------------------------------------------------

    use crate::HOME_LOCK;

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    /// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
    fn set_home(path: &std::path::Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
        HomeRestorer(prev)
    }

    fn temp_home(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join("mdpro_prefs_test")
            .join(format!("{label}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn settings_persist_across_restart() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("persist");
        let _home_guard = set_home(&home);

        // First "session": change a setting and save.
        let mut prefs = load_preferences().expect("initial load");
        prefs.auto_save_interval = 222;
        prefs.show_sidebar = false;
        save_preferences(&prefs).expect("save");

        // Second "session": a fresh load (simulating restart) must see them.
        let reloaded = load_preferences().expect("reload after restart");
        assert_eq!(reloaded.auto_save_interval, 222);
        assert!(!reloaded.show_sidebar);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn first_load_creates_default_config_file() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("first_load");
        let _home_guard = set_home(&home);

        // No config yet → load_preferences must materialise defaults to disk.
        let path = home.join(".mdpro").join("config.json");
        assert!(!path.exists(), "config must not exist before first load");
        let _ = load_preferences().expect("first load");
        assert!(path.exists(), "first load must create the config file");

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn save_uses_atomic_rename_no_leftover_tmp() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("atomic");
        let _home_guard = set_home(&home);

        save_preferences(&UserPreferences::default()).expect("save");
        let tmp = home.join(".mdpro").join("config.json.tmp");
        assert!(
            !tmp.exists(),
            "the temp file must be renamed away, not left behind"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn save_failure_preserves_existing_config_and_leaves_no_tmp() {
        use std::os::unix::fs::PermissionsExt;
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("atomic_fail");
        let _home_guard = set_home(&home);

        // First save establishes a known-good config.json.
        let first = UserPreferences {
            auto_save_interval: 42,
            ..UserPreferences::default()
        };
        save_preferences(&first).expect("first save");
        let dir = home.join(".mdpro");
        let config = dir.join("config.json");
        let original = std::fs::read(&config).expect("read original");

        // Make the dir read-only so creating the temp fails on the next save.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let second = UserPreferences {
            auto_save_interval: 999,
            ..UserPreferences::default()
        };
        let res = save_preferences(&second);

        // Restore perms for assertions + cleanup.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert!(
            res.is_err(),
            "save into read-only dir must fail, got: {res:?}"
        );
        assert_eq!(
            std::fs::read(&config).expect("read after failed save"),
            original,
            "the existing config.json must survive a failed save"
        );
        assert!(
            !dir.join("config.json.tmp").exists(),
            "no temp file may be left behind after a failed save"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn merge_preserves_all_fields_when_only_one_updated() {
        // Regression guard: adding a new field to UserPreferences/PartialPreferences
        // but forgetting to add it to merge_preferences would cause a compile error
        // (struct initialiser must be complete). This test documents the expectation
        // that unrelated fields survive a partial merge.
        let current = UserPreferences {
            auto_save_interval: 999,
            show_sidebar: false,
            enable_scroll_sync: false,
            ..UserPreferences::default()
        };

        let updates = PartialPreferences {
            editor: Some(EditorConfig {
                font_size: 20,
                ..EditorConfig::default()
            }),
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

#[cfg(test)]
#[path = "preferences_wi5_tests.rs"]
mod preferences_wi5_tests;

#[cfg(test)]
#[path = "preferences_fold_contract_tests.rs"]
mod preferences_fold_contract_tests;

#[cfg(test)]
#[path = "preferences_mcp_merge_tests.rs"]
mod preferences_mcp_merge_tests;
