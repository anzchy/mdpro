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
    /// Enable scroll sync between editor and preview
    pub enable_scroll_sync: bool,
    /// Recently opened files (max 10)
    pub recent_files: Vec<String>,
    /// Window dimensions on last close
    pub window_state: WindowState,
    /// Custom keyboard shortcuts (action -> shortcut)
    #[serde(default)]
    pub keyboard_shortcuts: KeyboardShortcuts,

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

/// Window geometry for per-file window position/size persistence
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub last_accessed: i64,
}

/// Keyboard shortcut definitions
/// Maps action names to key combinations
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

// Default shortcut values (Typora macOS conventions)
fn default_new() -> String {
    "Cmd+N".to_string()
}
fn default_new_window() -> String {
    "Cmd+Shift+N".to_string()
}
fn default_open() -> String {
    "Cmd+O".to_string()
}
fn default_open_quickly() -> String {
    "Cmd+Shift+O".to_string()
}
fn default_save() -> String {
    "Cmd+S".to_string()
}
fn default_save_as() -> String {
    "Cmd+Shift+S".to_string()
}
fn default_close() -> String {
    "Cmd+W".to_string()
}
fn default_preferences() -> String {
    "Cmd+,".to_string()
}

fn default_copy_as_markdown() -> String {
    "Cmd+Shift+C".to_string()
}
fn default_paste_as_plain_text() -> String {
    "Cmd+Shift+V".to_string()
}
fn default_select_line() -> String {
    "Cmd+L".to_string()
}
fn default_select_word() -> String {
    "Cmd+D".to_string()
}
fn default_delete_word() -> String {
    "Cmd+Shift+D".to_string()
}
fn default_jump_to_top() -> String {
    "Cmd+Up".to_string()
}
fn default_jump_to_bottom() -> String {
    "Cmd+Down".to_string()
}
fn default_find() -> String {
    "Cmd+F".to_string()
}
fn default_find_next() -> String {
    "Cmd+G".to_string()
}
fn default_find_previous() -> String {
    "Cmd+Shift+G".to_string()
}
fn default_replace() -> String {
    "Cmd+H".to_string()
}

fn default_heading1() -> String {
    "Cmd+1".to_string()
}
fn default_heading2() -> String {
    "Cmd+2".to_string()
}
fn default_heading3() -> String {
    "Cmd+3".to_string()
}
fn default_heading4() -> String {
    "Cmd+4".to_string()
}
fn default_heading5() -> String {
    "Cmd+5".to_string()
}
fn default_heading6() -> String {
    "Cmd+6".to_string()
}
fn default_paragraph() -> String {
    "Cmd+0".to_string()
}
fn default_increase_heading() -> String {
    "Cmd+=".to_string()
}
fn default_decrease_heading() -> String {
    "Cmd+-".to_string()
}
fn default_table() -> String {
    "Cmd+Option+T".to_string()
}
fn default_code_fences() -> String {
    "Cmd+Option+C".to_string()
}
fn default_math_block() -> String {
    "Cmd+Option+B".to_string()
}
fn default_quote() -> String {
    "Cmd+Option+Q".to_string()
}
fn default_ordered_list() -> String {
    "Cmd+Option+O".to_string()
}
fn default_unordered_list() -> String {
    "Cmd+Option+U".to_string()
}
fn default_indent() -> String {
    "Cmd+]".to_string()
}
fn default_outdent() -> String {
    "Cmd+[".to_string()
}

fn default_strong() -> String {
    "Cmd+B".to_string()
}
fn default_emphasis() -> String {
    "Cmd+I".to_string()
}
fn default_underline() -> String {
    "Cmd+U".to_string()
}
fn default_code() -> String {
    "Cmd+Shift+`".to_string()
}
fn default_strike() -> String {
    "Ctrl+Shift+`".to_string()
}
fn default_hyperlink() -> String {
    "Cmd+K".to_string()
}
fn default_image() -> String {
    "Cmd+Ctrl+I".to_string()
}
fn default_highlight() -> String {
    "Cmd+Shift+H".to_string()
}
fn default_clear_format() -> String {
    "Cmd+\\".to_string()
}
fn default_export_html() -> String {
    "Cmd+Shift+E".to_string()
}

fn default_toggle_sidebar() -> String {
    "Cmd+Shift+L".to_string()
}
fn default_cycle_view_mode() -> String {
    "Cmd+/".to_string()
}
fn default_toggle_fullscreen() -> String {
    "Cmd+Option+F".to_string()
}
fn default_switch_documents() -> String {
    "Cmd+`".to_string()
}
fn default_last_view_mode() -> ViewMode {
    ViewMode::Wysiwyg
}

// Table action shortcuts — direction mnemonic via Cmd+Option+arrows.
fn default_table_insert_row_above() -> String {
    "Cmd+Option+Up".to_string()
}
fn default_table_insert_row_below() -> String {
    "Cmd+Option+Down".to_string()
}
fn default_table_insert_column_left() -> String {
    "Cmd+Option+Left".to_string()
}
fn default_table_insert_column_right() -> String {
    "Cmd+Option+Right".to_string()
}
fn default_table_delete_row() -> String {
    "Cmd+Option+Backspace".to_string()
}
fn default_table_delete_column() -> String {
    "Cmd+Option+Shift+Backspace".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ViewMode {
    Split,
    EditorOnly,
    PreviewOnly,
    Wysiwyg,
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
}

fn default_auto_pair() -> bool {
    true
}

impl Default for MarkdownConfig {
    fn default() -> Self {
        Self {
            auto_pair: default_auto_pair(),
        }
    }
}

/// Appearance configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    /// Code block syntax highlight theme (source mode only)
    #[serde(default)]
    pub code_theme: CodeTheme,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            code_theme: CodeTheme::default(),
        }
    }
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    /// Whether MCP server is enabled — opt-in only; defaults to false
    #[serde(default)]
    pub enabled: bool,
    /// Auto-start MCP server when app launches — opt-in only; defaults to false
    #[serde(default)]
    pub start_on_launch: bool,
    /// Auto-approve AI edits without confirmation (when focused)
    #[serde(default)]
    pub auto_approve_edits: bool,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
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

impl Default for ViewMode {
    fn default() -> Self {
        ViewMode::Wysiwyg
    }
}
