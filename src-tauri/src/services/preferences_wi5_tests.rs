//! WI-5 (ADR-0031 step 4) — the three field additions that close D23.
//!
//! Covers matrix cases WI5-A, WI5-B, WI5-C, WI5-E, WI5-F and WI5-G. The TS
//! half (WI5-D) lives in `tests/preferences-keyboard-shortcut-fields.test.ts`,
//! and the cross-language assertion belongs to WI-8, not here.
//!
//! Sibling test module (rule 50 §6): `services/preferences.rs` is already past
//! the 300-line budget, so these live in their own file.

use super::*;
use crate::models::{
    AppearanceConfig, AutoSaveConfig, CloseFocusBehavior, CodeTheme, ContentWidth, EditorConfig,
    ExportConfig, ImageConfig, KeyboardShortcuts, LogLevel, LogSettings, MarkdownConfig, McpConfig,
    TabBarConfig, TabBarPosition, UserPreferences,
};
use crate::HOME_LOCK;

// ---------------------------------------------------------------------------
// Local helpers (self-contained so the pre-existing `mod tests` is untouched)
// ---------------------------------------------------------------------------

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
        .join("mdpro_prefs_wi5_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn sorted_keys(value: &serde_json::Value) -> Vec<String> {
    let mut keys: Vec<String> = value
        .as_object()
        .expect("expected a JSON object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

// ---------------------------------------------------------------------------
// WI5-A — markdown.autoReformatTablesOnSave survives save → load
// ---------------------------------------------------------------------------

#[test]
fn wi5_a_auto_reformat_tables_on_save_survives_save_load_cycle() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("auto_reformat_roundtrip");
    let _home_guard = set_home(&home);

    for v in [true, false] {
        let mut prefs = UserPreferences::default();
        prefs.markdown.auto_reformat_tables_on_save = v;
        // Conservation witness: the sibling field must survive too, which
        // catches a MarkdownConfig that serialises only the new field.
        prefs.markdown.auto_pair = !v;
        save_preferences(&prefs).expect("save");

        let reloaded = load_preferences().expect("reload");
        assert_eq!(
            reloaded.markdown.auto_reformat_tables_on_save, v,
            "auto_reformat_tables_on_save must survive save → load for {v}"
        );
        assert_eq!(
            reloaded.markdown.auto_pair, !v,
            "the sibling auto_pair must survive the same cycle"
        );
    }

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI5-B — the wire spelling is literally `autoReformatTablesOnSave`
// ---------------------------------------------------------------------------

#[test]
fn wi5_b_markdown_config_wire_key_set_is_exactly_camel_case() {
    let value = serde_json::to_value(MarkdownConfig {
        auto_pair: true,
        auto_reformat_tables_on_save: true,
    })
    .expect("serialise MarkdownConfig");

    assert_eq!(
        sorted_keys(&value),
        vec![
            "autoPair".to_string(),
            "autoReformatTablesOnSave".to_string()
        ],
        "the MarkdownConfig wire contract is exactly these two camelCase keys"
    );
}

// ---------------------------------------------------------------------------
// WI5-C — keyboardShortcuts.viewSource / viewWysiwyg
// ---------------------------------------------------------------------------

#[test]
fn wi5_c_view_shortcut_wire_keys_are_view_source_and_view_wysiwyg() {
    let value =
        serde_json::to_value(KeyboardShortcuts::default()).expect("serialise KeyboardShortcuts");
    let object = value.as_object().expect("expected a JSON object");

    assert!(
        object.contains_key("viewSource"),
        "KeyboardShortcuts must serialise a literal `viewSource` key"
    );
    assert!(
        object.contains_key("viewWysiwyg"),
        "KeyboardShortcuts must serialise a literal `viewWysiwyg` key"
    );
}

#[test]
fn wi5_c_view_shortcut_defaults_match_the_menu_accelerators() {
    // src-tauri/src/menu.rs lines 135 / 143 carry Some("Ctrl+2") / Some("Ctrl+4")
    // and src/types/preferences.ts:213-214 carry the same (rule 41).
    //
    // Deserialising `{}` is what fires the `#[serde(default = "…")]` functions
    // this WI adds — and it is the ONLY mechanism WI-5 owns. NOT asserted here:
    // `KeyboardShortcuts::default()`. WI-7 has since replaced the derived
    // `Default` with a hand-written impl, so it no longer yields `""` — but
    // asserting it here would still be asserting another work item's criterion.
    // (This comment previously described the derive and its all-empty result as
    // current; WI-7 falsified both clauses on 2026-09-23.)
    let shortcuts: KeyboardShortcuts =
        serde_json::from_str("{}").expect("an empty object fires every per-field serde default");
    assert_eq!(shortcuts.view_source, "Ctrl+2");
    assert_eq!(shortcuts.view_wysiwyg, "Ctrl+4");
}

#[test]
fn wi5_c_view_shortcuts_round_trip_non_default_values() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("view_shortcut_roundtrip");
    let _home_guard = set_home(&home);

    let mut prefs = UserPreferences::default();
    // Deliberately non-default and non-empty: a `load` that silently
    // substitutes defaults is caught, and WI-7's "empty means unset" repair
    // cannot fire on these.
    prefs.keyboard_shortcuts.view_source = "Ctrl+9".to_string();
    prefs.keyboard_shortcuts.view_wysiwyg = "Ctrl+0".to_string();
    save_preferences(&prefs).expect("save");

    let reloaded = load_preferences().expect("reload");
    assert_eq!(reloaded.keyboard_shortcuts.view_source, "Ctrl+9");
    assert_eq!(reloaded.keyboard_shortcuts.view_wysiwyg, "Ctrl+0");

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI5-E — the markdown group merges both fields and conserves a scalar
// ---------------------------------------------------------------------------

#[test]
fn wi5_e_markdown_merge_updates_both_fields_and_conserves_auto_save_interval() {
    let current = UserPreferences {
        auto_save_interval: 321,
        markdown: MarkdownConfig {
            auto_pair: false,
            auto_reformat_tables_on_save: false,
        },
        ..UserPreferences::default()
    };
    let updates = PartialPreferences {
        markdown: Some(MarkdownConfig {
            auto_pair: true,
            auto_reformat_tables_on_save: true,
        }),
        ..empty_partial()
    };

    let result = merge_preferences(current, updates);

    assert!(result.markdown.auto_pair);
    assert!(result.markdown.auto_reformat_tables_on_save);
    assert_eq!(result.auto_save_interval, 321);
}

// ---------------------------------------------------------------------------
// WI5-F — LAW: every nested group is replaced wholesale, never field-merged.
//
// This documents the CURRENT semantics as INTENDED (ADR-0031 D24's hazard).
// If a future decision makes nested merging field-wise, this is the case that
// must be deliberately rewritten under a new ADR; its going red is the signal.
// ---------------------------------------------------------------------------

macro_rules! assert_group_replaced_wholesale {
    ($field:ident, $wire:literal, $ty:ty, $non_default:expr) => {{
        let current = UserPreferences {
            auto_save_interval: 4321,
            $field: $non_default,
            ..UserPreferences::default()
        };
        let updates = PartialPreferences {
            $field: Some(<$ty>::default()),
            ..empty_partial()
        };
        let result = merge_preferences(current, updates);
        let serialised = serde_json::to_value(&result).expect("serialise merged preferences");
        assert_eq!(
            serialised[$wire],
            serde_json::to_value(<$ty>::default()).expect("serialise default group"),
            "nested group `{}` must be replaced wholesale, not field-merged",
            $wire
        );
        assert_eq!(
            result.auto_save_interval, 4321,
            "a scalar outside `{}` must be conserved",
            $wire
        );
    }};
}

#[test]
fn wi5_f_every_nested_group_is_replaced_wholesale() {
    assert_group_replaced_wholesale!(
        auto_save,
        "autoSave",
        AutoSaveConfig,
        AutoSaveConfig {
            enabled: false,
            interval_ms: 60000,
            debounce_ms: 999,
            save_on_blur: false,
        }
    );
    assert_group_replaced_wholesale!(
        tab_bar,
        "tabBar",
        TabBarConfig,
        TabBarConfig {
            position: TabBarPosition::Bottom,
            max_visible_tabs: 3,
            show_close_on_hover: false,
            close_focus_behavior: CloseFocusBehavior::Left,
        }
    );
    assert_group_replaced_wholesale!(
        image,
        "image",
        ImageConfig,
        ImageConfig {
            asset_folder: "./pictures".to_string(),
            copy_external_images: false,
            show_paste_preview: false,
            max_dimension: Some(800),
        }
    );
    assert_group_replaced_wholesale!(
        mcp,
        "mcp",
        McpConfig,
        // ADR-0039: mcp.enabled retired — renamed to `server_enabled`, and
        // `false` because `$non_default` must differ from the new default
        // (`true`), or the wholesale check is vacuous for this field.
        McpConfig {
            server_enabled: false,
            start_on_launch: true,
            auto_approve_edits: true,
        }
    );
    assert_group_replaced_wholesale!(
        editor,
        "editor",
        EditorConfig,
        EditorConfig {
            font_family: "mono".to_string(),
            font_size: 22,
            line_height_x10: 20,
            content_width: ContentWidth::Wide,
            tab_size: 2,
            word_wrap: false,
        }
    );
    assert_group_replaced_wholesale!(
        markdown,
        "markdown",
        MarkdownConfig,
        MarkdownConfig {
            auto_pair: false,
            auto_reformat_tables_on_save: true,
        }
    );
    assert_group_replaced_wholesale!(
        appearance,
        "appearance",
        AppearanceConfig,
        AppearanceConfig {
            code_theme: CodeTheme::OneDark,
        }
    );
    assert_group_replaced_wholesale!(
        export,
        "export",
        ExportConfig,
        ExportConfig {
            default_folder: "/tmp/mdpro-exports".to_string(),
            html_include_styles: false,
        }
    );
    assert_group_replaced_wholesale!(
        logging,
        "logging",
        LogSettings,
        LogSettings {
            enabled: false,
            level: LogLevel::Error,
        }
    );
}

#[test]
fn wi5_f_editor_sibling_word_wrap_is_replaced_not_preserved() {
    // The plan's named witness, kept explicit: patching `editor` with a
    // partially-specified struct literal resets the siblings to the patch's
    // values. `..EditorConfig::default()` carries word_wrap = true, so the
    // current `false` does NOT survive. Intended, not a defect.
    let current = UserPreferences {
        editor: EditorConfig {
            word_wrap: false,
            ..EditorConfig::default()
        },
        ..UserPreferences::default()
    };
    let updates = PartialPreferences {
        editor: Some(EditorConfig {
            font_size: 18,
            ..EditorConfig::default()
        }),
        ..empty_partial()
    };

    let result = merge_preferences(current, updates);

    assert_eq!(result.editor.font_size, 18);
    assert!(
        result.editor.word_wrap,
        "the sibling is replaced by the patch's value, not merged with current"
    );
}

// ---------------------------------------------------------------------------
// WI5-G — an older config missing all three new keys still loads
// ---------------------------------------------------------------------------

#[test]
fn wi5_g_older_config_without_the_new_keys_loads_with_documented_defaults() {
    // Verbatim the literal already used by
    // `deserialise_succeeds_on_partial_json_with_serde_defaults`.
    let minimal = r#"{"themeMode":"light","autoSaveInterval":30,"defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","showSidebar":true,"enableScrollSync":true,"recentFiles":[],"windowState":{"width":1200,"height":800,"x":100,"y":100,"isMaximized":false}}"#;

    let prefs = serde_json::from_str::<UserPreferences>(minimal)
        .expect("a config written by an older version must still load");

    assert!(
        !prefs.markdown.auto_reformat_tables_on_save,
        "auto_reformat_tables_on_save defaults to false"
    );
    assert!(
        prefs.markdown.auto_pair,
        "the absent `markdown` group falls to MarkdownConfig's hand-written Default"
    );

    // The shortcut defaults are deliberately NOT asserted from this literal.
    // It omits `keyboardShortcuts` entirely, so serde uses the *struct-level*
    // `Default` — which is derived and therefore empty — and never reaches the
    // per-field `#[serde(default = "…")]` attributes. That gap is WI-7's
    // subject, not WI-5's. See the sibling case below for the group-present
    // path, which is the one WI-5's attributes actually govern.
}

#[test]
fn wi5_g_present_shortcut_group_missing_the_new_keys_takes_their_documented_defaults() {
    // Same older-config shape, but with `keyboardShortcuts` present and empty —
    // the shape a config gets once anything has written the group. Here the
    // per-field `#[serde(default = "…")]` attributes are what run, so this is
    // the case that pins the defaults WI-5 introduces.
    let minimal = r#"{"themeMode":"light","autoSaveInterval":30,"defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","showSidebar":true,"enableScrollSync":true,"recentFiles":[],"windowState":{"width":1200,"height":800,"x":100,"y":100,"isMaximized":false},"keyboardShortcuts":{}}"#;

    let prefs = serde_json::from_str::<UserPreferences>(minimal)
        .expect("a config whose shortcut group predates the new keys must still load");

    assert_eq!(prefs.keyboard_shortcuts.view_source, "Ctrl+2");
    assert_eq!(prefs.keyboard_shortcuts.view_wysiwyg, "Ctrl+4");
    assert_eq!(prefs.keyboard_shortcuts.file_open_quickly, "Cmd+Shift+O");
}
