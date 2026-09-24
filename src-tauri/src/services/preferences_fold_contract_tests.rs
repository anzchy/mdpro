//! F-D — the backend half of the preference merge contract.
//!
//! The frontend test harness (`tests/support/preferenceRecorder.ts#foldWrites`)
//! models `set_preferences` as a **top-level whole-group replace** with identity
//! on an absent group. Thirteen S5 cases in the preference write-path matrix use
//! that fold as their oracle, so if the model is wrong every one of them is
//! quietly wrong too. This module pins the model against the real
//! `merge_preferences` and the real serde derives, so a change on the Rust side
//! has to break a test here rather than silently invalidate the TS suite.
//!
//! The second half demonstrates *why* per-leaf writes are unsafe rather than
//! asserting it by fiat:
//!   - `ExportConfig` carries `#[serde(default = "default_html_include_styles")]`,
//!     so a partial export payload silently resurrects `true`.
//!   - `ImageConfig` carries no `#[serde(default)]` at all, so a partial image
//!     payload fails deserialization outright.
//!
//! Scope: `merge_preferences` is pure. Nothing here touches the config file, and
//! nothing here routes through `set_preferences` — which would.
//!
//! Sibling test module (rule 50 §6): `services/preferences.rs` is past the
//! 300-line budget, so these live in their own file.

use super::*;
use crate::models::{
    AppearanceConfig, AutoSaveConfig, CodeTheme, EditorConfig, ExportConfig, ImageConfig,
    KeyboardShortcuts, LogLevel, LogSettings, MarkdownConfig, McpConfig, TabBarConfig, ThemeMode,
    UserPreferences, ViewMode, WindowState,
};

// ---------------------------------------------------------------------------
// Helpers
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

/// A `UserPreferences` with a distinguishable value in every group, so that a
/// merge bug cannot accidentally produce the right answer by landing on a
/// default.
fn seeded() -> UserPreferences {
    UserPreferences {
        theme_mode: ThemeMode::Dark,
        auto_save_interval: 99,
        default_view_mode: ViewMode::Source,
        last_view_mode: ViewMode::Wysiwyg,
        show_sidebar: false,
        enable_scroll_sync: false,
        recent_files: vec!["/seed/one.md".to_string()],
        window_state: WindowState {
            width: 1111,
            height: 777,
            x: 11,
            y: 22,
            is_maximized: true,
        },
        keyboard_shortcuts: KeyboardShortcuts::default(),
        window_states: std::collections::HashMap::new(),
        logging: LogSettings {
            enabled: false,
            level: LogLevel::Error,
        },
        auto_save: AutoSaveConfig {
            enabled: false,
            interval_ms: 4321,
            debounce_ms: 1234,
            save_on_blur: false,
        },
        tab_bar: TabBarConfig::default(),
        image: image_i1(),
        mcp: McpConfig::default(),
        editor: EditorConfig {
            font_size: 21,
            ..EditorConfig::default()
        },
        markdown: MarkdownConfig::default(),
        appearance: AppearanceConfig {
            code_theme: CodeTheme::OneDark,
        },
        export: export_e1(),
    }
}

fn export_e1() -> ExportConfig {
    ExportConfig {
        default_folder: "/old".to_string(),
        html_include_styles: false,
    }
}

fn export_e2() -> ExportConfig {
    ExportConfig {
        default_folder: "/new".to_string(),
        html_include_styles: true,
    }
}

fn image_i1() -> ImageConfig {
    ImageConfig {
        asset_folder: "./assets".to_string(),
        copy_external_images: true,
        show_paste_preview: true,
        max_dimension: None,
    }
}

fn image_i2() -> ImageConfig {
    ImageConfig {
        asset_folder: "./media".to_string(),
        copy_external_images: false,
        show_paste_preview: false,
        max_dimension: Some(800),
    }
}

fn as_json(prefs: &UserPreferences) -> serde_json::Value {
    serde_json::to_value(prefs).expect("UserPreferences must serialize")
}

/// The three partial values the sequence property enumerates over.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Step {
    Empty,
    Export,
    Image,
}

fn partial_for(step: Step) -> PartialPreferences {
    match step {
        Step::Empty => empty_partial(),
        Step::Export => PartialPreferences {
            export: Some(export_e2()),
            ..empty_partial()
        },
        Step::Image => PartialPreferences {
            image: Some(image_i2()),
            ..empty_partial()
        },
    }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

#[test]
fn merge_with_empty_partial_is_the_identity() {
    let seed = seeded();

    let merged = merge_preferences(seed.clone(), empty_partial());

    assert_eq!(as_json(&merged), as_json(&seed));
}

// ---------------------------------------------------------------------------
// Whole-group replace, every other group untouched
// ---------------------------------------------------------------------------

#[test]
fn some_export_replaces_the_whole_export_group_and_nothing_else() {
    let seed = seeded();
    let updates = PartialPreferences {
        export: Some(export_e2()),
        ..empty_partial()
    };

    let merged = merge_preferences(seed.clone(), updates);

    // Replaced wholesale: BOTH leaves come from the payload, including the one
    // the caller did not "mean" to change.
    assert_eq!(merged.export.default_folder, "/new");
    assert!(merged.export.html_include_styles);

    // Every other group bit-identical to the seed.
    let mut before = as_json(&seed);
    let mut after = as_json(&merged);
    before.as_object_mut().unwrap().remove("export");
    after.as_object_mut().unwrap().remove("export");
    assert_eq!(before, after);
}

#[test]
fn some_image_replaces_the_whole_image_group_and_nothing_else() {
    let seed = seeded();
    let updates = PartialPreferences {
        image: Some(image_i2()),
        ..empty_partial()
    };

    let merged = merge_preferences(seed.clone(), updates);

    assert_eq!(merged.image.asset_folder, "./media");
    assert!(!merged.image.copy_external_images);
    assert!(!merged.image.show_paste_preview);
    assert_eq!(merged.image.max_dimension, Some(800));

    let mut before = as_json(&seed);
    let mut after = as_json(&merged);
    before.as_object_mut().unwrap().remove("image");
    after.as_object_mut().unwrap().remove("image");
    assert_eq!(before, after);
}

// ---------------------------------------------------------------------------
// Last-write-wins per top-level key across a sequence of merges
// ---------------------------------------------------------------------------

#[test]
fn folding_a_sequence_is_last_write_wins_per_top_level_key() {
    let alphabet = [Step::Empty, Step::Export, Step::Image];

    let mut sequences: Vec<Vec<Step>> = vec![vec![]];
    for a in alphabet {
        sequences.push(vec![a]);
        for b in alphabet {
            sequences.push(vec![a, b]);
        }
    }
    assert_eq!(sequences.len(), 1 + 3 + 9);

    for seq in &sequences {
        let seed = seeded();
        let mut merged = seed.clone();
        for step in seq {
            merged = merge_preferences(merged, partial_for(*step));
        }

        // Independent reverse scan: the last step that carried each key wins;
        // absent from every step means the seed value survives.
        let expected_export = match seq.iter().rev().find(|s| **s == Step::Export) {
            Some(_) => export_e2(),
            None => export_e1(),
        };
        let expected_image = match seq.iter().rev().find(|s| **s == Step::Image) {
            Some(_) => image_i2(),
            None => image_i1(),
        };

        assert_eq!(
            merged.export.default_folder, expected_export.default_folder,
            "export.defaultFolder after {seq:?}"
        );
        assert_eq!(
            merged.export.html_include_styles, expected_export.html_include_styles,
            "export.htmlIncludeStyles after {seq:?}"
        );
        assert_eq!(
            merged.image.asset_folder, expected_image.asset_folder,
            "image.assetFolder after {seq:?}"
        );
        assert_eq!(
            merged.image.max_dimension, expected_image.max_dimension,
            "image.maxDimension after {seq:?}"
        );

        // Conservation: a group no step touched is untouched.
        assert_eq!(merged.auto_save_interval, 99, "after {seq:?}");
        assert_eq!(merged.editor.font_size, 21, "after {seq:?}");
    }
}

// ---------------------------------------------------------------------------
// Why per-leaf writes are unsafe (the F-B' counterpart)
// ---------------------------------------------------------------------------

#[test]
fn partial_export_payload_silently_resurrects_the_serde_default() {
    let parsed: PartialPreferences = serde_json::from_str(r#"{"export":{"defaultFolder":"x"}}"#)
        .expect("ExportConfig has #[serde(default)] on every field, so a partial payload parses");

    let export = parsed.export.expect("export group present");
    assert_eq!(export.default_folder, "x");
    // The user's stored `false` would be overwritten with this. This is the
    // defect WI-1 exists to fix, which is why per-leaf writes are not a
    // legitimate alternative fix.
    assert!(
        export.html_include_styles,
        "a partial export payload must deserialize htmlIncludeStyles to the serde default `true`"
    );
}

#[test]
fn partial_image_payload_fails_to_deserialize() {
    let as_partial = serde_json::from_str::<PartialPreferences>(r#"{"image":{"assetFolder":"a"}}"#);
    assert!(
        as_partial.is_err(),
        "ImageConfig has no #[serde(default)], so a partial image payload must be rejected"
    );

    let as_group = serde_json::from_str::<ImageConfig>(r#"{"assetFolder":"a"}"#);
    assert!(
        as_group.is_err(),
        "ImageConfig itself must reject a payload missing copyExternalImages"
    );
}

#[test]
fn a_complete_group_payload_deserializes_and_merges() {
    let parsed: PartialPreferences = serde_json::from_str(
        r#"{"image":{"assetFolder":"./media","copyExternalImages":false,"showPastePreview":false,"maxDimension":800}}"#,
    )
    .expect("a complete image group must parse");

    let merged = merge_preferences(seeded(), parsed);

    assert_eq!(merged.image.asset_folder, "./media");
    assert_eq!(merged.image.max_dimension, Some(800));
}
