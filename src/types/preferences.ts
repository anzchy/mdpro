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
  formatClearFormat: string;

  // View operations
  viewToggleSidebar: string;
  viewCycleViewMode: string;
  viewToggleFullscreen: string;
  viewSwitchDocuments: string;
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
  formatClearFormat: "Cmd+\\",

  // View operations
  viewToggleSidebar: "Cmd+Shift+L",
  viewCycleViewMode: "Cmd+/",
  viewToggleFullscreen: "Cmd+Option+F",
  viewSwitchDocuments: "Cmd+`",
};

/** MCP Server configuration */
export interface McpConfig {
  /** Whether MCP server is enabled */
  enabled: boolean;
  /** Auto-start MCP server when app launches */
  startOnLaunch: boolean;
  /** Auto-approve AI edits without confirmation (when focused) */
  autoApproveEdits: boolean;
}

/** Default MCP configuration */
export const DEFAULT_MCP_CONFIG: McpConfig = {
  enabled: true,
  startOnLaunch: true,
  autoApproveEdits: false,
};

/** MCP client types */
export type McpClient = "claude_desktop" | "claude_code" | "codex_cli" | "gemini_cli";

/** MCP server status */
export interface McpStatus {
  running: boolean;
  port: number | null;
  binaryPath: string;
}

/** MCP installation status for a single client */
export interface McpInstallation {
  client: McpClient;
  installed: boolean;
  configPath: string;
}
