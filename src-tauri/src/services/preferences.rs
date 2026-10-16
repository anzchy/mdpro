use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::models::sidebar_width::clamp_sidebar_width;
use crate::models::{
    AppearanceConfig, AutoSaveConfig, EditorConfig, ExportConfig, ImageConfig, KeyboardShortcuts,
    LogEntryPayload, LogLevel, LogSettings, LogStatus, MarkdownConfig, McpConfig, TabBarConfig,
    ThemeMode, UserPreferences, ViewMode, WindowGeometry, WindowState,
};
use crate::services::logger;
use crate::services::preferences_migration::{
    migrate_loaded, MigrationOutcome, MigrationPlan, PRODUCTION_PLAN,
};
use crate::services::prefs_guard::{reentry_check, GuardError, PrefsGuard};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialPreferences {
    pub theme_mode: Option<ThemeMode>,
    pub auto_save_interval: Option<u32>,
    pub default_view_mode: Option<ViewMode>,
    pub last_view_mode: Option<ViewMode>,
    pub show_sidebar: Option<bool>,
    #[serde(
        default,
        deserialize_with = "crate::models::sidebar_width::deserialize_partial"
    )]
    pub sidebar_width: Option<u32>,
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
    IoError {
        message: String,
    },
    ParseError {
        message: String,
    },
    /// The public [`load_preferences`] was called on a thread that already
    /// holds a [`PrefsGuard`]; waiting would deadlock on its own lock. A unit
    /// variant, so it serialises as the bare string `"ReentrantLoad"` and
    /// carries no path or OS text across IPC.
    ReentrantLoad,
}

/// Global mutex that serialises every load → update → save of
/// `~/.mdpro/config.json`, so concurrent writers cannot silently overwrite
/// each other's changes.
///
/// Held through a [`PrefsGuard`], which marks its thread. Six callers hold it
/// across the whole cycle and load with [`load_preferences_locked`]:
/// `set_preferences` and `save_window_state` (`commands/preferences.rs`),
/// `apply_logging_settings` (`commands/logging.rs`), `save_window_geometry`
/// (`commands/window.rs`), `read_stored_geometry_in`
/// (`services/window_restore.rs`) and `persist_server_enabled`
/// (`services/preferences_mcp.rs`). The public [`load_preferences`] takes it
/// for the read alone. `services/mcp_launch.rs` and
/// `services/mcp_controller/switch.rs` take it raw for raw-byte reads (see
/// `services/prefs_guard.rs`).
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

/// Reads `~/.mdpro/config.json` under the preferences lock.
///
/// Takes a [`PrefsGuard`] for the read and calls [`load_preferences_locked`].
/// On a thread that already holds a guard it does not wait on itself: it logs
/// one `preferences.load` Fail record (`error: "ReentrantLoad"`, no path),
/// fires a `debug_assert!`, and in release builds returns
/// [`PreferencesError::ReentrantLoad`]. A caller that holds the guard across a
/// load → update → save calls [`load_preferences_locked`] instead.
pub fn load_preferences() -> Result<UserPreferences, PreferencesError> {
    // Logged before the assertion, so the record exists in debug builds too.
    let check = reentry_check();
    if check.is_err() {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "preferences.load".to_string(),
            status: LogStatus::Fail,
            action_id: Some(uuid::Uuid::new_v4().to_string()),
            context: None,
            duration_ms: None,
            error: Some("ReentrantLoad".to_string()),
        });
    }
    debug_assert!(
        check.is_ok(),
        "load_preferences() on a thread that holds a PrefsGuard; use load_preferences_locked"
    );
    check?;
    let guard = PrefsGuard::acquire().map_err(|e| match e {
        GuardError::Poisoned => PreferencesError::IoError {
            message: "preferences lock poisoned".to_string(),
        },
        GuardError::Reentrant => PreferencesError::ReentrantLoad,
    })?;
    load_preferences_locked(&guard)
}

/// Reads `~/.mdpro/config.json` under the caller's guard, materialising
/// defaults on first run.
///
/// The `&PrefsGuard` parameter is the proof the lock is held; the caller keeps
/// it across its update and save (ADR-0005, GS-1).
///
/// Runs the production shortcut migration ([`load_preferences_locked_with`]);
/// with M1a's empty map and CURRENT = 1 it never moves or writes a document.
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
pub fn load_preferences_locked(
    guard: &PrefsGuard<'_>,
) -> Result<UserPreferences, PreferencesError> {
    load_preferences_locked_with(guard, &PRODUCTION_PLAN).map(|(prefs, _)| prefs)
}

/// [`load_preferences_locked`] with the migration plan as a parameter, so the
/// write-back is testable with a non-empty map while the shipped one is empty.
///
/// After the D-b repair it runs the plan through `migrate_loaded`
/// (`services/preferences_migration.rs`): repair first, so a `""` migrates as
/// the default it stands for. A missing file materialises the defaults, which
/// are already at CURRENT, and is not migrated.
pub(crate) fn load_preferences_locked_with(
    guard: &PrefsGuard<'_>,
    plan: &MigrationPlan,
) -> Result<(UserPreferences, MigrationOutcome), PreferencesError> {
    let path = config_path()?;
    if !path.exists() {
        let defaults = UserPreferences::default();
        save_preferences(&defaults)?;
        return Ok((defaults, MigrationOutcome::Unchanged));
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
    Ok(migrate_loaded(guard, preferences, plan))
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
#[path = "preferences_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "preferences_wi5_tests.rs"]
mod preferences_wi5_tests;

#[cfg(test)]
#[path = "preferences_fold_contract_tests.rs"]
mod preferences_fold_contract_tests;

#[cfg(test)]
#[path = "preferences_mcp_merge_tests.rs"]
mod preferences_mcp_merge_tests;
