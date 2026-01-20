use serde::{Deserialize, Serialize};

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
    #[serde(default = "default_clear_format")]
    pub format_clear_format: String,

    // View operations
    #[serde(default = "default_toggle_sidebar")]
    pub view_toggle_sidebar: String,
    #[serde(default = "default_cycle_view_mode")]
    pub view_cycle_view_mode: String,
    #[serde(default = "default_toggle_fullscreen")]
    pub view_toggle_fullscreen: String,
    #[serde(default = "default_switch_documents")]
    pub view_switch_documents: String,
}

// Default shortcut values (Typora macOS conventions)
fn default_new() -> String { "Cmd+N".to_string() }
fn default_new_window() -> String { "Cmd+Shift+N".to_string() }
fn default_open() -> String { "Cmd+O".to_string() }
fn default_open_quickly() -> String { "Cmd+Shift+O".to_string() }
fn default_save() -> String { "Cmd+S".to_string() }
fn default_save_as() -> String { "Cmd+Shift+S".to_string() }
fn default_close() -> String { "Cmd+W".to_string() }
fn default_preferences() -> String { "Cmd+,".to_string() }

fn default_copy_as_markdown() -> String { "Cmd+Shift+C".to_string() }
fn default_paste_as_plain_text() -> String { "Cmd+Shift+V".to_string() }
fn default_select_line() -> String { "Cmd+L".to_string() }
fn default_select_word() -> String { "Cmd+D".to_string() }
fn default_delete_word() -> String { "Cmd+Shift+D".to_string() }
fn default_jump_to_top() -> String { "Cmd+Up".to_string() }
fn default_jump_to_bottom() -> String { "Cmd+Down".to_string() }
fn default_find() -> String { "Cmd+F".to_string() }
fn default_find_next() -> String { "Cmd+G".to_string() }
fn default_find_previous() -> String { "Cmd+Shift+G".to_string() }
fn default_replace() -> String { "Cmd+H".to_string() }

fn default_heading1() -> String { "Cmd+1".to_string() }
fn default_heading2() -> String { "Cmd+2".to_string() }
fn default_heading3() -> String { "Cmd+3".to_string() }
fn default_heading4() -> String { "Cmd+4".to_string() }
fn default_heading5() -> String { "Cmd+5".to_string() }
fn default_heading6() -> String { "Cmd+6".to_string() }
fn default_paragraph() -> String { "Cmd+0".to_string() }
fn default_increase_heading() -> String { "Cmd+=".to_string() }
fn default_decrease_heading() -> String { "Cmd+-".to_string() }
fn default_table() -> String { "Cmd+Option+T".to_string() }
fn default_code_fences() -> String { "Cmd+Option+C".to_string() }
fn default_math_block() -> String { "Cmd+Option+B".to_string() }
fn default_quote() -> String { "Cmd+Option+Q".to_string() }
fn default_ordered_list() -> String { "Cmd+Option+O".to_string() }
fn default_unordered_list() -> String { "Cmd+Option+U".to_string() }
fn default_indent() -> String { "Cmd+]".to_string() }
fn default_outdent() -> String { "Cmd+[".to_string() }

fn default_strong() -> String { "Cmd+B".to_string() }
fn default_emphasis() -> String { "Cmd+I".to_string() }
fn default_underline() -> String { "Cmd+U".to_string() }
fn default_code() -> String { "Cmd+Shift+`".to_string() }
fn default_strike() -> String { "Ctrl+Shift+`".to_string() }
fn default_hyperlink() -> String { "Cmd+K".to_string() }
fn default_image() -> String { "Cmd+Ctrl+I".to_string() }
fn default_clear_format() -> String { "Cmd+\\".to_string() }

fn default_toggle_sidebar() -> String { "Cmd+Shift+L".to_string() }
fn default_cycle_view_mode() -> String { "Cmd+/".to_string() }
fn default_toggle_fullscreen() -> String { "Cmd+Option+F".to_string() }
fn default_switch_documents() -> String { "Cmd+`".to_string() }
fn default_last_view_mode() -> ViewMode { ViewMode::Split }

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

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme_mode: ThemeMode::System,
            auto_save_interval: 30,
            default_view_mode: ViewMode::Split,
            last_view_mode: ViewMode::Split,
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
        }
    }
}
