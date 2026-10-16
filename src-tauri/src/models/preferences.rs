use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::LogSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    /// Theme mode preference
    pub theme_mode: ThemeMode,
    /// Auto-save interval in seconds (default: 30)
    pub auto_save_interval: u32,
    /// Default view mode on startup
    pub default_view_mode: ViewMode,
    /// Last view mode used before app close
    #[serde(default = "default_last_view_mode")]
    pub last_view_mode: ViewMode,
    /// Show sidebar on startup
    pub show_sidebar: bool,
    /// Sidebar width in CSS px, 180–480, clamped on read (D189, ADR-0088)
    #[serde(
        default = "crate::models::sidebar_width::default_sidebar_width",
        deserialize_with = "crate::models::sidebar_width::deserialize_stored"
    )]
    pub sidebar_width: u32,
    /// Enable scroll sync between editor and preview
    pub enable_scroll_sync: bool,
    /// Recently opened files (max 10)
    pub recent_files: Vec<String>,
    /// Window dimensions on last close
    pub window_state: WindowState,
    /// Custom keyboard shortcuts (action -> shortcut)
    #[serde(default)]
    pub keyboard_shortcuts: KeyboardShortcuts,
    /// The shortcut-defaults version the stored bindings were last migrated
    /// to (ADR-0114 Decision 9). Read leniently; only the loader's migration
    /// moves it, never `set_preferences`.
    #[serde(
        default = "keyboard_shortcuts_version::default_keyboard_shortcuts_version",
        deserialize_with = "keyboard_shortcuts_version::deserialize_stored_version"
    )]
    pub keyboard_shortcuts_version: u32,

    /// Logging settings (enabled + minimum level)
    #[serde(default)]
    pub logging: LogSettings,

    /// Per-file window states for position/size persistence
    #[serde(default)]
    pub window_states: HashMap<String, WindowGeometry>,

    /// Auto-save configuration
    #[serde(default)]
    pub auto_save: AutoSaveConfig,

    /// Tab bar configuration
    #[serde(default)]
    pub tab_bar: TabBarConfig,

    /// Image configuration
    #[serde(default)]
    pub image: ImageConfig,

    /// MCP Server configuration
    #[serde(default)]
    pub mcp: McpConfig,

    /// Editor typography and behavior settings
    #[serde(default)]
    pub editor: EditorConfig,

    /// Markdown behavior settings (CodeMirror-only in v1)
    #[serde(default)]
    pub markdown: MarkdownConfig,

    /// Appearance settings (code theme, etc.)
    #[serde(default)]
    pub appearance: AppearanceConfig,

    /// Export configuration
    #[serde(default)]
    pub export: ExportConfig,
}

/// Window geometry for per-file window position/size persistence.
///
/// **Reference frame (ADR-0031 step 2, decision D-c).** `x` / `y` are the
/// window's **outer** top-left corner and `width` / `height` are its **inner**
/// (client-area) size — the frame `Window::setPosition` and `Window::setSize`
/// apply on restore, and the frame `outerPosition()` / `innerSize()` report on
/// save. Both numbers are stored in **logical points**, not physical pixels:
/// `src/hooks/useWindowCloseGuard.ts` divides by `scaleFactor()` before
/// writing, and `create_window` / `App.tsx` apply them as logical. Records
/// written before WI-3 hold physical pixels and are therefore 2x inflated on a
/// Retina display; `clamp_geometry` is what keeps those openable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub last_accessed: i64,
}

#[path = "keyboard_shortcut_defaults.rs"]
mod keyboard_shortcut_defaults;
#[path = "keyboard_shortcuts.rs"]
mod keyboard_shortcuts;
#[path = "keyboard_shortcuts_version.rs"]
mod keyboard_shortcuts_version;
pub use keyboard_shortcuts::{KeyboardShortcuts, SYSTEM_BINDING, UNASSIGNED_BINDING};
pub use keyboard_shortcuts_version::CURRENT_KEYBOARD_SHORTCUTS_VERSION;

fn default_last_view_mode() -> ViewMode {
    ViewMode::Wysiwyg
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

/// Editor view mode, shared verbatim with the TypeScript `ViewMode` union in
/// `src/types/preferences.ts`. The wire forms are kebab-case and are an IPC
/// contract: changing one without the other silently voids whole payloads.
///
/// `Split`, `EditorOnly` and `PreviewOnly` are legacy values kept because
/// `src/utils/viewModeUtils.ts` still migrates them on read and existing
/// `config.json` files hold them. `Source` and `Wysiwyg` are the two live
/// modes.
///
/// The variant set is deliberately **closed** — no `#[serde(other)]`. An
/// unrecognised value must be reported, not silently coerced (ADR-0031 step 4).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ViewMode {
    Split,
    EditorOnly,
    PreviewOnly,
    #[default]
    Wysiwyg,
    Source,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_maximized: bool,
}

/// Auto-save configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSaveConfig {
    /// Whether auto-save is enabled
    #[serde(default = "default_auto_save_enabled")]
    pub enabled: bool,
    /// Auto-save interval in milliseconds (5000, 15000, 60000)
    #[serde(default = "default_auto_save_interval_ms")]
    pub interval_ms: u32,
    /// Debounce delay before saving after typing stops
    #[serde(default = "default_auto_save_debounce_ms")]
    pub debounce_ms: u32,
    /// Whether to save on window blur
    #[serde(default = "default_auto_save_save_on_blur")]
    pub save_on_blur: bool,
}

fn default_auto_save_enabled() -> bool {
    true
}
fn default_auto_save_interval_ms() -> u32 {
    15000
}
fn default_auto_save_debounce_ms() -> u32 {
    1500
}
fn default_auto_save_save_on_blur() -> bool {
    true
}

impl Default for AutoSaveConfig {
    fn default() -> Self {
        Self {
            enabled: default_auto_save_enabled(),
            interval_ms: default_auto_save_interval_ms(),
            debounce_ms: default_auto_save_debounce_ms(),
            save_on_blur: default_auto_save_save_on_blur(),
        }
    }
}

/// Tab bar configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabBarConfig {
    /// Position of tab bar (top or bottom)
    #[serde(default)]
    pub position: TabBarPosition,
    /// Maximum number of visible tabs before scrolling
    #[serde(default = "default_max_visible_tabs")]
    pub max_visible_tabs: u32,
    /// Whether to show close button on hover only
    #[serde(default = "default_show_close_on_hover")]
    pub show_close_on_hover: bool,
    /// Focus behavior when closing active tab
    #[serde(default)]
    pub close_focus_behavior: CloseFocusBehavior,
}

fn default_max_visible_tabs() -> u32 {
    10
}
fn default_show_close_on_hover() -> bool {
    true
}

impl Default for TabBarConfig {
    fn default() -> Self {
        Self {
            position: TabBarPosition::Top,
            max_visible_tabs: default_max_visible_tabs(),
            show_close_on_hover: default_show_close_on_hover(),
            close_focus_behavior: CloseFocusBehavior::Mru,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TabBarPosition {
    #[default]
    Top,
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CloseFocusBehavior {
    /// Most recently used tab
    #[default]
    Mru,
    /// Tab to the right
    Right,
    /// Tab to the left
    Left,
}

/// Image configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageConfig {
    /// Default folder for uploaded images (relative to document)
    pub asset_folder: String,
    /// Whether to copy external images to asset folder
    pub copy_external_images: bool,
    /// Whether to show preview before paste
    pub show_paste_preview: bool,
    /// Maximum dimension for auto-resize (None = no limit)
    pub max_dimension: Option<u32>,
}

impl Default for ImageConfig {
    fn default() -> Self {
        Self {
            asset_folder: "./assets".to_string(),
            copy_external_images: true,
            show_paste_preview: true,
            max_dimension: None,
        }
    }
}

/// Editor typography and behavior configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    /// Font family preset: "system" | "serif" | "mono"
    #[serde(default = "default_font_family")]
    pub font_family: String,
    /// Font size in px (12–24)
    #[serde(default = "default_font_size")]
    pub font_size: u8,
    /// Line height × 10 (so 16 = 1.6); stored as int to avoid float precision issues
    #[serde(default = "default_line_height_x10")]
    pub line_height_x10: u8,
    /// Content width preset
    #[serde(default)]
    pub content_width: ContentWidth,
    /// Tab size in spaces (2 or 4)
    #[serde(default = "default_tab_size")]
    pub tab_size: u8,
    /// Word wrap enabled
    #[serde(default = "default_word_wrap")]
    pub word_wrap: bool,
}

fn default_font_family() -> String {
    "system".to_string()
}
fn default_font_size() -> u8 {
    16
}
fn default_line_height_x10() -> u8 {
    16
}
fn default_tab_size() -> u8 {
    4
}
fn default_word_wrap() -> bool {
    true
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_family: default_font_family(),
            font_size: default_font_size(),
            line_height_x10: default_line_height_x10(),
            content_width: ContentWidth::default(),
            tab_size: default_tab_size(),
            word_wrap: default_word_wrap(),
        }
    }
}

/// Content width preset for the editor
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ContentWidth {
    #[serde(rename = "narrow")]
    Narrow, // 600px
    #[default]
    #[serde(rename = "medium")]
    Medium, // 780px
    #[serde(rename = "wide")]
    Wide, // 900px
    #[serde(rename = "full")]
    Full, // 100%
}

/// Markdown behavior configuration (CodeMirror-only in v1)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownConfig {
    /// Auto-pair brackets and quotes (closeBrackets extension)
    #[serde(default = "default_auto_pair")]
    pub auto_pair: bool,
    /// Reformat GFM tables into aligned columns when the document is saved.
    /// Opt-in: defaults to `false` (ADR-0031 step 4 / D23).
    #[serde(default)]
    pub auto_reformat_tables_on_save: bool,
}

fn default_auto_pair() -> bool {
    true
}

impl Default for MarkdownConfig {
    fn default() -> Self {
        Self {
            auto_pair: default_auto_pair(),
            auto_reformat_tables_on_save: false,
        }
    }
}

/// Appearance configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    /// Code block syntax highlight theme (source mode only)
    #[serde(default)]
    pub code_theme: CodeTheme,
}

/// Export configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    /// Default export folder (absolute path; "" = prompt on first export)
    #[serde(default)]
    pub default_folder: String,
    /// Whether to include styles in HTML export
    #[serde(default = "default_html_include_styles")]
    pub html_include_styles: bool,
}

fn default_html_include_styles() -> bool {
    true
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            default_folder: String::new(),
            html_include_styles: default_html_include_styles(),
        }
    }
}

/// Code highlight theme for source mode
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CodeTheme {
    #[default]
    #[serde(rename = "default")]
    Default,
    #[serde(rename = "oneDark")]
    OneDark,
}

/// MCP Server configuration
///
/// The legacy `enabled` key is retired (ADR-0039): it is not a field, so a
/// materialised `"enabled": false` left in an existing `config.json` is
/// ignored on read (no `deny_unknown_fields`, ADR-0031) and dropped on Rust's
/// next full write. It is deliberately **not** a serde alias of
/// `server_enabled` — that would honour the `false` no user ever chose.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    /// Whether the MCP HTTP server is started at launch (`serverEnabled`).
    /// Defaults to `true` both when the key is absent and in `Default`, so a
    /// missing value keeps today's always-on behaviour (ADR-0039). Read once
    /// at launch; a change takes effect after a restart.
    #[serde(default = "default_true")]
    pub server_enabled: bool,
    /// Auto-start MCP server when app launches — defaults to false. Not read
    /// by anything yet (INERT, D25); redundant under ADR-0039's launch gate.
    #[serde(default)]
    pub start_on_launch: bool,
    /// Auto-approve AI edits without confirmation (when focused)
    #[serde(default)]
    pub auto_approve_edits: bool,
}

fn default_true() -> bool {
    true
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            server_enabled: default_true(),
            start_on_launch: false,
            auto_approve_edits: false,
        }
    }
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme_mode: ThemeMode::System,
            auto_save_interval: 30,
            default_view_mode: ViewMode::Wysiwyg,
            last_view_mode: ViewMode::Wysiwyg,
            show_sidebar: true,
            sidebar_width: crate::models::sidebar_width::SIDEBAR_WIDTH_DEFAULT,
            enable_scroll_sync: true,
            recent_files: Vec::new(),
            window_state: WindowState {
                width: 1200,
                height: 800,
                x: 100,
                y: 100,
                is_maximized: false,
            },
            keyboard_shortcuts: KeyboardShortcuts::default(),
            keyboard_shortcuts_version: CURRENT_KEYBOARD_SHORTCUTS_VERSION,
            logging: LogSettings::default(),
            window_states: HashMap::new(),
            auto_save: AutoSaveConfig::default(),
            tab_bar: TabBarConfig::default(),
            image: ImageConfig::default(),
            mcp: McpConfig::default(),
            editor: EditorConfig::default(),
            markdown: MarkdownConfig::default(),
            appearance: AppearanceConfig::default(),
            export: ExportConfig::default(),
        }
    }
}

#[cfg(test)]
#[path = "preferences_wi6_tests.rs"]
mod preferences_wi6_tests;

#[cfg(test)]
#[path = "preferences_wi7_tests.rs"]
mod preferences_wi7_tests;

#[cfg(test)]
#[path = "preferences_wi8_tests.rs"]
mod preferences_wi8_tests;

#[cfg(test)]
#[path = "preferences_retirement.rs"]
mod preferences_retirement;

#[cfg(test)]
#[path = "preferences_mcp_tests.rs"]
mod preferences_mcp_tests;

#[cfg(test)]
#[path = "preferences_retirement_tests.rs"]
mod preferences_retirement_tests;

#[cfg(test)]
#[path = "preferences_verify_preset_tests.rs"]
mod preferences_verify_preset_tests;
