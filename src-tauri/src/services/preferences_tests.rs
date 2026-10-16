use super::*;
use crate::models::{AppearanceConfig, CodeTheme, EditorConfig, MarkdownConfig, UserPreferences};

/// Constructs a PartialPreferences with all fields set to None except the
/// ones supplied by the caller. This helper reduces boilerplate in each test.
fn empty_partial() -> PartialPreferences {
    PartialPreferences {
        theme_mode: None,
        auto_save_interval: None,
        default_view_mode: None,
        last_view_mode: None,
        show_sidebar: None,
        sidebar_width: None,
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
