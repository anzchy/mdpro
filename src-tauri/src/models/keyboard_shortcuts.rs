//! Purpose: the `KeyboardShortcuts` preference group: its 58 bindings, the
//! hand-written `Default`, the empty-binding repair (D-b) and the two
//! non-chord binding states `<unassigned>` / `<system>` (ADR-0114 Decision 7).
//! Split out of `models/preferences.rs` (M1a WI-0, rule 50 § 6); behaviour
//! unchanged. Re-exported as `crate::models::KeyboardShortcuts`.
//!
//! @coordinates-with models/keyboard_shortcut_defaults.rs — the `default_*()`
//!   functions the serde attributes and `Default` name

use serde::{Deserialize, Serialize};

use super::keyboard_shortcut_defaults::*;

/// A binding the user deliberately left without a chord (ADR-0114 Decision 7).
/// Stored verbatim in place of a chord; the TS twin is
/// `src/types/keyboardShortcuts.ts`, and both are held to the contract
/// fixture's `$keyboardShortcutStates`.
pub const UNASSIGNED_BINDING: &str = "<unassigned>";
/// A binding left to the system's own handling (ADR-0114 Decision 7).
pub const SYSTEM_BINDING: &str = "<system>";

/// Keyboard shortcut definitions
/// Maps action names to key combinations
///
/// # `Default` is hand-written, not derived (ADR-0031 step 4, WI-7)
///
/// Every field's default lives in a `#[serde(default = "…")]` attribute, and a
/// `#[derive(Default)]` never consults those — it produces `String::default()`,
/// i.e. `""`, for all 58 fields. That derived value is what `load_preferences`
/// materialised to disk on first run, so every shipped `config.json` held 58
/// empty accelerators. The hand-written impl below calls the same `default_*()`
/// functions the attributes name, so the two mechanisms cannot diverge;
/// `models/preferences_wi7_tests.rs::wi7_b_…` is the fence that keeps them
/// equal when a field is added.
///
/// **Adding a field**: give it a `#[serde(default = "…")]` *and* a line in the
/// impl below. Forgetting the second is what WI7-B fails on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardShortcuts {
    // File operations
    #[serde(default = "default_new")]
    pub file_new: String,
    #[serde(default = "default_new_window")]
    pub file_new_window: String,
    #[serde(default = "default_open")]
    pub file_open: String,
    #[serde(default = "default_open_quickly")]
    pub file_open_quickly: String,
    #[serde(default = "default_save")]
    pub file_save: String,
    #[serde(default = "default_save_as")]
    pub file_save_as: String,
    #[serde(default = "default_close")]
    pub file_close: String,
    #[serde(default = "default_preferences")]
    pub file_preferences: String,

    // Edit operations
    #[serde(default = "default_copy_as_markdown")]
    pub edit_copy_as_markdown: String,
    #[serde(default = "default_paste_as_plain_text")]
    pub edit_paste_as_plain_text: String,
    #[serde(default = "default_select_line")]
    pub edit_select_line: String,
    #[serde(default = "default_select_word")]
    pub edit_select_word: String,
    #[serde(default = "default_delete_word")]
    pub edit_delete_word: String,
    #[serde(default = "default_jump_to_top")]
    pub edit_jump_to_top: String,
    #[serde(default = "default_jump_to_bottom")]
    pub edit_jump_to_bottom: String,
    #[serde(default = "default_find")]
    pub edit_find: String,
    #[serde(default = "default_find_next")]
    pub edit_find_next: String,
    #[serde(default = "default_find_previous")]
    pub edit_find_previous: String,
    #[serde(default = "default_replace")]
    pub edit_replace: String,

    // Paragraph operations
    #[serde(default = "default_heading1")]
    pub paragraph_heading1: String,
    #[serde(default = "default_heading2")]
    pub paragraph_heading2: String,
    #[serde(default = "default_heading3")]
    pub paragraph_heading3: String,
    #[serde(default = "default_heading4")]
    pub paragraph_heading4: String,
    #[serde(default = "default_heading5")]
    pub paragraph_heading5: String,
    #[serde(default = "default_heading6")]
    pub paragraph_heading6: String,
    #[serde(default = "default_paragraph")]
    pub paragraph_paragraph: String,
    #[serde(default = "default_increase_heading")]
    pub paragraph_increase_heading: String,
    #[serde(default = "default_decrease_heading")]
    pub paragraph_decrease_heading: String,
    #[serde(default = "default_table")]
    pub paragraph_table: String,
    #[serde(default = "default_code_fences")]
    pub paragraph_code_fences: String,
    #[serde(default = "default_math_block")]
    pub paragraph_math_block: String,
    #[serde(default = "default_quote")]
    pub paragraph_quote: String,
    #[serde(default = "default_ordered_list")]
    pub paragraph_ordered_list: String,
    #[serde(default = "default_unordered_list")]
    pub paragraph_unordered_list: String,
    #[serde(default = "default_indent")]
    pub paragraph_indent: String,
    #[serde(default = "default_outdent")]
    pub paragraph_outdent: String,

    // Format operations
    #[serde(default = "default_strong")]
    pub format_strong: String,
    #[serde(default = "default_emphasis")]
    pub format_emphasis: String,
    #[serde(default = "default_underline")]
    pub format_underline: String,
    #[serde(default = "default_code")]
    pub format_code: String,
    #[serde(default = "default_strike")]
    pub format_strike: String,
    #[serde(default = "default_hyperlink")]
    pub format_hyperlink: String,
    #[serde(default = "default_image")]
    pub format_image: String,
    #[serde(default = "default_highlight")]
    pub format_highlight: String,
    #[serde(default = "default_clear_format")]
    pub format_clear_format: String,

    // File export operations
    #[serde(default = "default_export_html")]
    pub file_export_html: String,

    // View operations
    #[serde(default = "default_view_source")]
    pub view_source: String,
    #[serde(default = "default_view_wysiwyg")]
    pub view_wysiwyg: String,
    #[serde(default = "default_toggle_sidebar")]
    pub view_toggle_sidebar: String,
    #[serde(default = "default_cycle_view_mode")]
    pub view_cycle_view_mode: String,
    #[serde(default = "default_toggle_fullscreen")]
    pub view_toggle_fullscreen: String,
    #[serde(default = "default_switch_documents")]
    pub view_switch_documents: String,

    // Table action shortcuts (Phase 1.5 follow-up).
    #[serde(default = "default_table_insert_row_above")]
    pub table_insert_row_above: String,
    #[serde(default = "default_table_insert_row_below")]
    pub table_insert_row_below: String,
    #[serde(default = "default_table_insert_column_left")]
    pub table_insert_column_left: String,
    #[serde(default = "default_table_insert_column_right")]
    pub table_insert_column_right: String,
    #[serde(default = "default_table_delete_row")]
    pub table_delete_row: String,
    #[serde(default = "default_table_delete_column")]
    pub table_delete_column: String,
}

impl Default for KeyboardShortcuts {
    fn default() -> Self {
        Self {
            file_new: default_new(),
            file_new_window: default_new_window(),
            file_open: default_open(),
            file_open_quickly: default_open_quickly(),
            file_save: default_save(),
            file_save_as: default_save_as(),
            file_close: default_close(),
            file_preferences: default_preferences(),
            edit_copy_as_markdown: default_copy_as_markdown(),
            edit_paste_as_plain_text: default_paste_as_plain_text(),
            edit_select_line: default_select_line(),
            edit_select_word: default_select_word(),
            edit_delete_word: default_delete_word(),
            edit_jump_to_top: default_jump_to_top(),
            edit_jump_to_bottom: default_jump_to_bottom(),
            edit_find: default_find(),
            edit_find_next: default_find_next(),
            edit_find_previous: default_find_previous(),
            edit_replace: default_replace(),
            paragraph_heading1: default_heading1(),
            paragraph_heading2: default_heading2(),
            paragraph_heading3: default_heading3(),
            paragraph_heading4: default_heading4(),
            paragraph_heading5: default_heading5(),
            paragraph_heading6: default_heading6(),
            paragraph_paragraph: default_paragraph(),
            paragraph_increase_heading: default_increase_heading(),
            paragraph_decrease_heading: default_decrease_heading(),
            paragraph_table: default_table(),
            paragraph_code_fences: default_code_fences(),
            paragraph_math_block: default_math_block(),
            paragraph_quote: default_quote(),
            paragraph_ordered_list: default_ordered_list(),
            paragraph_unordered_list: default_unordered_list(),
            paragraph_indent: default_indent(),
            paragraph_outdent: default_outdent(),
            format_strong: default_strong(),
            format_emphasis: default_emphasis(),
            format_underline: default_underline(),
            format_code: default_code(),
            format_strike: default_strike(),
            format_hyperlink: default_hyperlink(),
            format_image: default_image(),
            format_highlight: default_highlight(),
            format_clear_format: default_clear_format(),
            file_export_html: default_export_html(),
            view_source: default_view_source(),
            view_wysiwyg: default_view_wysiwyg(),
            view_toggle_sidebar: default_toggle_sidebar(),
            view_cycle_view_mode: default_cycle_view_mode(),
            view_toggle_fullscreen: default_toggle_fullscreen(),
            view_switch_documents: default_switch_documents(),
            table_insert_row_above: default_table_insert_row_above(),
            table_insert_row_below: default_table_insert_row_below(),
            table_insert_column_left: default_table_insert_column_left(),
            table_insert_column_right: default_table_insert_column_right(),
            table_delete_row: default_table_delete_row(),
            table_delete_column: default_table_delete_column(),
        }
    }
}

impl KeyboardShortcuts {
    /// Substitutes the documented default for every binding that is the empty
    /// string (ADR-0031 step 4, decision D-b).
    ///
    /// # Which invariant this is
    ///
    /// **Load-side only.** A `""` **may** sit on disk — a whole-group write
    /// through `set_preferences` puts one there unchanged — and it is repaired
    /// on **every read** through `load_preferences`. This is deliberately not
    /// the stronger claim that no `""` ever reaches the file: a support dump,
    /// the shortcuts panel's own file read, and any future migration all see
    /// the raw document, and each would see the `""`.
    /// `models/preferences_wi7_tests.rs::wi7_g_…` asserts exactly that, so the
    /// narrowing is pinned rather than merely tolerated.
    ///
    /// # Why it goes through serde rather than 58 `if` statements
    ///
    /// Dropping the empty-valued keys and re-deserialising re-fires the
    /// per-field `#[serde(default = "…")]` attributes, so this function cannot
    /// fall out of step with a newly added field. It is also **per field**: a
    /// user's real binding beside an empty one survives untouched, which
    /// "replace the whole group with defaults" would destroy.
    ///
    /// # Recorded cost, and how ADR-0114 extends it
    ///
    /// `""` still means "use the default", so `""` can never unbind a shortcut.
    /// ADR-0114 Decision 7 **extends** D-b rather than reversing it: a
    /// deliberate unbinding is stored as [`UNASSIGNED_BINDING`] and a binding
    /// left to the system as [`SYSTEM_BINDING`]. Both are ordinary non-empty
    /// strings here, so this repair passes them through untouched, as it does
    /// near-misses such as `"<UNASSIGNED>"`
    /// (`models/keyboard_shortcuts_state_tests.rs`).
    ///
    /// Infallible by construction, and on the impossible serde error it
    /// returns `self` unchanged rather than panicking on user-supplied data.
    #[must_use]
    pub fn with_empty_bindings_defaulted(self) -> Self {
        let Ok(serde_json::Value::Object(map)) = serde_json::to_value(&self) else {
            return self;
        };
        let bound: serde_json::Map<String, serde_json::Value> = map
            .into_iter()
            .filter(|(_, value)| value.as_str() != Some(""))
            .collect();
        match serde_json::from_value(serde_json::Value::Object(bound)) {
            Ok(repaired) => repaired,
            Err(_) => self,
        }
    }
}

#[cfg(test)]
#[path = "keyboard_shortcuts_state_tests.rs"]
mod keyboard_shortcuts_state_tests;
