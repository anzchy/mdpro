import type { ViewMode } from "./editor";
import type { LogSettings } from "./logging";

export interface UserPreferences {
  /** Theme mode preference */
  themeMode: "light" | "dark" | "system";

  /** Auto-save interval in seconds */
  autoSaveInterval: number;

  /** Default view mode on startup */
  defaultViewMode: ViewMode;

  /** Last view mode used before app close */
  lastViewMode: ViewMode;

  /** Show sidebar on startup */
  showSidebar: boolean;

  /** Sidebar width in CSS px, 180–480, clamped on read (D189, ADR-0088) */
  sidebarWidth: number;

  /** Enable scroll sync */
  enableScrollSync: boolean;

  /** Recently opened file paths */
  recentFiles: string[];

  /** Window state */
  windowState: WindowState;

  /** Custom keyboard shortcuts */
  keyboardShortcuts: KeyboardShortcuts;

  /** Logging settings */
  logging: LogSettings;

  /** Per-file window states for position/size persistence */
  windowStates: Record<string, WindowGeometry>;

  /** MCP Server configuration */
  mcp: McpConfig;

  /** Editor typography and behavior settings */
  editor: EditorConfig;

  /** Markdown behavior settings */
  markdown: MarkdownConfig;

  /** Appearance settings */
  appearance: AppearanceConfig;

  /** Image handling settings */
  image: ImageConfig;

  /** Export configuration */
  export: ExportConfig;

  /** Auto-save configuration (nested model) */
  autoSave: AutoSaveConfig;

  /** Tab bar configuration */
  tabBar: TabBarConfig;
}

export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized: boolean;
}

/** Per-file window geometry for position/size persistence */
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  lastAccessed?: number;
}

/** Keyboard shortcut definitions matching Typora conventions */
export interface KeyboardShortcuts {
  // File operations
  fileNew: string;
  fileNewWindow: string;
  fileOpen: string;
  /**
   * Mirrors Rust's `default_open_quickly()`. Added by ADR-0031 step 4 so the
   * two `KeyboardShortcuts` shapes agree. Deliberately absent from
   * `SHORTCUT_CATEGORIES`: nothing consumes it yet, and listing an inert
   * rebind control would manufacture another "setting that does nothing".
   */
  fileOpenQuickly: string;
  fileSave: string;
  fileSaveAs: string;
  fileClose: string;
  filePreferences: string;

  // Edit operations
  editCopyAsMarkdown: string;
  editPasteAsPlainText: string;
  editSelectLine: string;
  editSelectWord: string;
  editDeleteWord: string;
  editJumpToTop: string;
  editJumpToBottom: string;
  editFind: string;
  editFindNext: string;
  editFindPrevious: string;
  editReplace: string;

  // Paragraph operations
  paragraphHeading1: string;
  paragraphHeading2: string;
  paragraphHeading3: string;
  paragraphHeading4: string;
  paragraphHeading5: string;
  paragraphHeading6: string;
  paragraphParagraph: string;
  paragraphIncreaseHeading: string;
  paragraphDecreaseHeading: string;
  paragraphTable: string;
  paragraphCodeFences: string;
  paragraphMathBlock: string;
  paragraphQuote: string;
  paragraphOrderedList: string;
  paragraphUnorderedList: string;
  paragraphIndent: string;
  paragraphOutdent: string;

  // Format operations
  formatStrong: string;
  formatEmphasis: string;
  formatUnderline: string;
  formatCode: string;
  formatStrike: string;
  formatHyperlink: string;
  formatImage: string;
  formatHighlight: string;
  formatClearFormat: string;

  // File export operations
  fileExportHtml: string;

  // View operations
  viewSource: string;
  viewWysiwyg: string;
  viewToggleSidebar: string;
  viewCycleViewMode: string;
  viewToggleFullscreen: string;
  viewSwitchDocuments: string;

  // Table action shortcuts (Phase 1.5 follow-up — direction mnemonic
  // via Cmd+Option+arrows; Backspace variants for delete).
  tableInsertRowAbove: string;
  tableInsertRowBelow: string;
  tableInsertColumnLeft: string;
  tableInsertColumnRight: string;
  tableDeleteRow: string;
  tableDeleteColumn: string;
}

/** Default keyboard shortcuts (Typora macOS conventions) */
export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  // File operations
  fileNew: "Cmd+N",
  fileNewWindow: "Cmd+Shift+N",
  fileOpen: "Cmd+O",
  fileOpenQuickly: "Cmd+Shift+O",
  fileSave: "Cmd+S",
  fileSaveAs: "Cmd+Shift+S",
  fileClose: "Cmd+W",
  filePreferences: "Cmd+,",

  // Edit operations
  editCopyAsMarkdown: "Cmd+Shift+C",
  editPasteAsPlainText: "Cmd+Shift+V",
  editSelectLine: "Cmd+L",
  editSelectWord: "Cmd+D",
  editDeleteWord: "Cmd+Shift+D",
  editJumpToTop: "Cmd+Up",
  editJumpToBottom: "Cmd+Down",
  editFind: "Cmd+F",
  editFindNext: "Cmd+G",
  editFindPrevious: "Cmd+Shift+G",
  editReplace: "Cmd+H",

  // Paragraph operations
  paragraphHeading1: "Cmd+1",
  paragraphHeading2: "Cmd+2",
  paragraphHeading3: "Cmd+3",
  paragraphHeading4: "Cmd+4",
  paragraphHeading5: "Cmd+5",
  paragraphHeading6: "Cmd+6",
  paragraphParagraph: "Cmd+0",
  paragraphIncreaseHeading: "Cmd+=",
  paragraphDecreaseHeading: "Cmd+-",
  paragraphTable: "Cmd+Option+T",
  paragraphCodeFences: "Cmd+Option+C",
  paragraphMathBlock: "Cmd+Option+B",
  paragraphQuote: "Cmd+Option+Q",
  paragraphOrderedList: "Cmd+Option+O",
  paragraphUnorderedList: "Cmd+Option+U",
  paragraphIndent: "Cmd+]",
  paragraphOutdent: "Cmd+[",

  // Format operations
  formatStrong: "Cmd+B",
  formatEmphasis: "Cmd+I",
  formatUnderline: "Cmd+U",
  formatCode: "Cmd+Shift+`",
  formatStrike: "Ctrl+Shift+`",
  formatHyperlink: "Cmd+K",
  formatImage: "Cmd+Ctrl+I",
  formatHighlight: "Cmd+Shift+H",
  formatClearFormat: "Cmd+\\",

  // File export operations
  fileExportHtml: "Cmd+Shift+E",

  // View operations
  viewSource: "Ctrl+2",
  viewWysiwyg: "Ctrl+4",
  viewToggleSidebar: "Cmd+Shift+L",
  viewCycleViewMode: "Cmd+/",
  viewToggleFullscreen: "Cmd+Option+F",
  viewSwitchDocuments: "Cmd+`",

  // Table actions (direction-mnemonic via Cmd+Option+arrows). The
  // shortcut only fires when the cursor is inside a table; otherwise
  // it falls through to the editor's default arrow behavior.
  tableInsertRowAbove: "Cmd+Option+Up",
  tableInsertRowBelow: "Cmd+Option+Down",
  tableInsertColumnLeft: "Cmd+Option+Left",
  tableInsertColumnRight: "Cmd+Option+Right",
  tableDeleteRow: "Cmd+Option+Backspace",
  tableDeleteColumn: "Cmd+Option+Shift+Backspace",
};

/**
 * MCP Server configuration. Mirrors Rust `models::preferences::McpConfig`.
 * The legacy `enabled` key is retired (ADR-0039) and must not come back.
 */
export interface McpConfig {
  /**
   * Whether the MCP HTTP server runs. Read at launch, and changed live only
   * through `mcp_set_server_enabled` (ADR-0040) — a generic `set_preferences`
   * write keeps the value on disk. Defaults to `true` — a missing value keeps
   * the always-on behaviour.
   */
  serverEnabled: boolean;
  /** Auto-start MCP server when app launches (not read by anything yet — D25) */
  startOnLaunch: boolean;
  /** Auto-approve AI edits without confirmation (when focused) */
  autoApproveEdits: boolean;
}

/**
 * Default MCP configuration — the server is on by default (ADR-0039); must
 * equal Rust `McpConfig::default()`, pinned by `$defaultMcpConfig` in
 * `tests/fixtures/preferences-contract.json`.
 */
export const DEFAULT_MCP_CONFIG: McpConfig = {
  serverEnabled: true,
  startOnLaunch: false,
  autoApproveEdits: false,
};

/** MCP client types */
export type McpClient = "claude_desktop" | "claude_code" | "codex_cli" | "gemini_cli";

/** MCP installation status for a single client */
export interface McpInstallation {
  client: McpClient;
  installed: boolean;
  configPath: string;
}

/** Editor typography and behavior configuration */
export interface EditorConfig {
  /** Font family preset: "system" | "serif" | "mono" */
  fontFamily: "system" | "serif" | "mono";
  /** Font size in px (12–24) */
  fontSize: number;
  /** Line height × 10 (16 = 1.6) */
  lineHeightX10: number;
  /** Content width preset */
  contentWidth: ContentWidth;
  /** Tab size (2 or 4) */
  tabSize: 2 | 4;
  /** Word wrap enabled */
  wordWrap: boolean;
}

export type ContentWidth = "narrow" | "medium" | "wide" | "full";

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  fontFamily: "system",
  fontSize: 16,
  lineHeightX10: 16,
  contentWidth: "medium",
  tabSize: 4,
  wordWrap: true,
};

/** Markdown behavior configuration (CodeMirror-only in v1) */
export interface MarkdownConfig {
  /** Auto-pair brackets and quotes */
  autoPair: boolean;
  /**
   * Auto-format GFM tables on save (Phase 3 WI-3.2). Off by default —
   * pretty-printing produces noisy diffs in version-controlled files.
   * When on, save reformats every table in the document via
   * `tableFormatter.formatAllTables` before writing to disk.
   */
  autoReformatTablesOnSave: boolean;
}

export const DEFAULT_MARKDOWN_CONFIG: MarkdownConfig = {
  autoPair: true,
  autoReformatTablesOnSave: false,
};

/** Appearance configuration */
export interface AppearanceConfig {
  /** Code block syntax highlight theme (source mode only) */
  codeTheme: CodeTheme;
}

export type CodeTheme = "default" | "oneDark";

export const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  codeTheme: "default",
};

/** Export configuration */
export interface ExportConfig {
  /** Default export folder (absolute path; "" = prompt on first export) */
  defaultFolder: string;
  /** Whether to include styles in HTML export */
  htmlIncludeStyles: boolean;
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  defaultFolder: "",
  htmlIncludeStyles: true,
};

/** Image handling configuration */
export interface ImageConfig {
  /** Default folder for uploaded images (relative to document) */
  assetFolder: string;
  /** Whether to copy external images to asset folder */
  copyExternalImages: boolean;
  /** Whether to show preview before paste */
  showPastePreview: boolean;
  /** Maximum dimension for auto-resize (null = no limit) */
  maxDimension: number | null;
}

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  assetFolder: "./assets",
  copyExternalImages: true,
  showPastePreview: true,
  maxDimension: null,
};

/** Auto-save configuration (mirrors Rust AutoSaveConfig) */
export interface AutoSaveConfig {
  /** Whether auto-save is enabled */
  enabled: boolean;
  /** Auto-save interval in milliseconds */
  intervalMs: number;
  /** Debounce delay before saving after typing stops */
  debounceMs: number;
  /** Whether to save on window blur */
  saveOnBlur: boolean;
}

export const DEFAULT_AUTO_SAVE_CONFIG: AutoSaveConfig = {
  enabled: true,
  intervalMs: 15000,
  debounceMs: 1500,
  saveOnBlur: true,
};

/** Tab bar configuration (mirrors Rust TabBarConfig) */
export interface TabBarConfig {
  position: "top" | "bottom";
  maxVisibleTabs: number;
  showCloseOnHover: boolean;
  closeFocusBehavior: "mru" | "right" | "left";
}

export const DEFAULT_TAB_BAR_CONFIG: TabBarConfig = {
  position: "top",
  maxVisibleTabs: 10,
  showCloseOnHover: true,
  closeFocusBehavior: "mru",
};
