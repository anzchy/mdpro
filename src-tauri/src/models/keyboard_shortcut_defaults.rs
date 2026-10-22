//! Purpose: the default chord of every `KeyboardShortcuts` field, named by
//! its `#[serde(default = "…")]` attributes and its hand-written `Default`.
//! Split out of `models/preferences.rs` (M1a WI-0, rule 50 § 6); values
//! unchanged.
//!
//! @coordinates-with models/keyboard_shortcuts.rs

// Default shortcut values (Typora macOS conventions)
pub(super) fn default_new() -> String {
    "Cmd+N".to_string()
}
pub(super) fn default_new_window() -> String {
    "Cmd+Shift+N".to_string()
}
pub(super) fn default_open() -> String {
    "Cmd+O".to_string()
}
pub(super) fn default_open_quickly() -> String {
    "Cmd+Shift+O".to_string()
}
pub(super) fn default_save() -> String {
    "Cmd+S".to_string()
}
pub(super) fn default_save_as() -> String {
    "Cmd+Shift+S".to_string()
}
pub(super) fn default_close() -> String {
    "Cmd+W".to_string()
}
pub(super) fn default_preferences() -> String {
    "Cmd+,".to_string()
}

pub(super) fn default_copy_as_markdown() -> String {
    "Cmd+Shift+C".to_string()
}
pub(super) fn default_paste_as_plain_text() -> String {
    "Cmd+Shift+V".to_string()
}
pub(super) fn default_select_line() -> String {
    "Cmd+L".to_string()
}
pub(super) fn default_select_word() -> String {
    "Cmd+D".to_string()
}
pub(super) fn default_delete_word() -> String {
    "Cmd+Shift+D".to_string()
}
pub(super) fn default_jump_to_top() -> String {
    "Cmd+Up".to_string()
}
pub(super) fn default_jump_to_bottom() -> String {
    "Cmd+Down".to_string()
}
pub(super) fn default_find() -> String {
    "Cmd+F".to_string()
}
pub(super) fn default_find_next() -> String {
    "Cmd+G".to_string()
}
pub(super) fn default_find_previous() -> String {
    "Cmd+Shift+G".to_string()
}
pub(super) fn default_replace() -> String {
    "Cmd+H".to_string()
}

pub(super) fn default_heading1() -> String {
    "Cmd+1".to_string()
}
pub(super) fn default_heading2() -> String {
    "Cmd+2".to_string()
}
pub(super) fn default_heading3() -> String {
    "Cmd+3".to_string()
}
pub(super) fn default_heading4() -> String {
    "Cmd+4".to_string()
}
pub(super) fn default_heading5() -> String {
    "Cmd+5".to_string()
}
pub(super) fn default_heading6() -> String {
    "Cmd+6".to_string()
}
pub(super) fn default_paragraph() -> String {
    "Cmd+0".to_string()
}
pub(super) fn default_increase_heading() -> String {
    "Cmd+=".to_string()
}
pub(super) fn default_decrease_heading() -> String {
    "Cmd+-".to_string()
}
pub(super) fn default_table() -> String {
    "Cmd+Option+T".to_string()
}
pub(super) fn default_code_fences() -> String {
    "Cmd+Option+C".to_string()
}
pub(super) fn default_math_block() -> String {
    "Cmd+Option+B".to_string()
}
pub(super) fn default_quote() -> String {
    "Cmd+Option+Q".to_string()
}
pub(super) fn default_ordered_list() -> String {
    "Cmd+Option+O".to_string()
}
pub(super) fn default_unordered_list() -> String {
    "Cmd+Option+U".to_string()
}
pub(super) fn default_indent() -> String {
    "Cmd+]".to_string()
}
pub(super) fn default_outdent() -> String {
    "Cmd+[".to_string()
}

pub(super) fn default_strong() -> String {
    "Cmd+B".to_string()
}
pub(super) fn default_emphasis() -> String {
    "Cmd+I".to_string()
}
pub(super) fn default_underline() -> String {
    "Cmd+U".to_string()
}
pub(super) fn default_code() -> String {
    "Cmd+Shift+`".to_string()
}
pub(super) fn default_strike() -> String {
    "Ctrl+Shift+`".to_string()
}
pub(super) fn default_hyperlink() -> String {
    "Cmd+K".to_string()
}
pub(super) fn default_image() -> String {
    "Cmd+Ctrl+I".to_string()
}

/// Effective Image key for a platform; the saved value itself stays untouched.
pub(crate) fn effective_image_shortcut(is_macos: bool, stored: &str) -> &str {
    if stored.is_empty() {
        return if is_macos {
            "Cmd+Ctrl+I"
        } else {
            "<unassigned>"
        };
    }
    if !is_macos && stored == "Cmd+Ctrl+I" {
        return "<unassigned>";
    }
    stored
}

#[cfg(test)]
#[path = "legacy_image_shortcut_tests.rs"]
mod legacy_image_shortcut_tests;
pub(super) fn default_highlight() -> String {
    "Cmd+Shift+H".to_string()
}
pub(super) fn default_clear_format() -> String {
    "Cmd+\\".to_string()
}
pub(super) fn default_export_html() -> String {
    "Cmd+Shift+E".to_string()
}

/// Mirrors the macOS accelerator ⌃2 on the View → Source item
/// (`menu_submenus.rs` `view_item_accelerator`; Windows and Linux have none,
/// ADR-0096) and `src/types/preferences.ts`'s `viewSource` (rule 41).
pub(super) fn default_view_source() -> String {
    "Ctrl+2".to_string()
}
/// Mirrors the macOS accelerator ⌃4 on the View → WYSIWYG item
/// (`menu_submenus.rs` `view_item_accelerator`; Windows and Linux have none,
/// ADR-0096) and `src/types/preferences.ts`'s `viewWysiwyg` (rule 41).
pub(super) fn default_view_wysiwyg() -> String {
    "Ctrl+4".to_string()
}
pub(super) fn default_toggle_sidebar() -> String {
    "Cmd+Shift+L".to_string()
}
pub(super) fn default_cycle_view_mode() -> String {
    "Cmd+/".to_string()
}
pub(super) fn default_toggle_fullscreen() -> String {
    "Cmd+Option+F".to_string()
}
pub(super) fn default_switch_documents() -> String {
    "Cmd+`".to_string()
}

// Table action shortcuts — direction mnemonic via Cmd+Option+arrows.
pub(super) fn default_table_insert_row_above() -> String {
    "Cmd+Option+Up".to_string()
}
pub(super) fn default_table_insert_row_below() -> String {
    "Cmd+Option+Down".to_string()
}
pub(super) fn default_table_insert_column_left() -> String {
    "Cmd+Option+Left".to_string()
}
pub(super) fn default_table_insert_column_right() -> String {
    "Cmd+Option+Right".to_string()
}
pub(super) fn default_table_delete_row() -> String {
    "Cmd+Option+Backspace".to_string()
}
pub(super) fn default_table_delete_column() -> String {
    "Cmd+Option+Shift+Backspace".to_string()
}
