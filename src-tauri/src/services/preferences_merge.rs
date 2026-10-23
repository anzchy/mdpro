//! Purpose: folds a frontend `PartialPreferences` into the stored
//! `UserPreferences` for `set_preferences`. Moved out of `preferences.rs`
//! (M1a, rule 50 § 6); `preferences.rs` re-exports it, so callers are unchanged.
//!
//! Key decisions:
//! - `mcp.serverEnabled` and `keyboardShortcutsVersion` are kept from disk:
//!   only `persist_server_enabled` and the loader's migration move them.
//!
//! @coordinates-with services/preferences.rs — `PartialPreferences`, the caller

use crate::models::sidebar_width::clamp_sidebar_width;
use crate::models::{McpConfig, UserPreferences};
use crate::services::preferences::PartialPreferences;

/// Nested groups are replaced wholesale, except `mcp.serverEnabled`, which is
/// kept from disk: only `persist_server_enabled` writes it (ADR-0040). The
/// `keyboardShortcutsVersion` stamp is kept from disk the same way.
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
        // Clamped again here: a `PartialPreferences` built in Rust never went
        // through `deserialize_partial`.
        sidebar_width: updates
            .sidebar_width
            .map(|w| clamp_sidebar_width(f64::from(w)))
            .unwrap_or(current.sidebar_width),
        enable_scroll_sync: updates
            .enable_scroll_sync
            .unwrap_or(current.enable_scroll_sync),
        recent_files: updates.recent_files.unwrap_or(current.recent_files),
        window_state: updates.window_state.unwrap_or(current.window_state),
        keyboard_shortcuts: updates
            .keyboard_shortcuts
            .unwrap_or(current.keyboard_shortcuts),
        // Kept from disk: only the loader's migration moves it, and
        // `PartialPreferences` has no such field (ADR-0114 Decision 9).
        keyboard_shortcuts_version: current.keyboard_shortcuts_version,
        shortcut_migration_conflicts: current.shortcut_migration_conflicts,
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
