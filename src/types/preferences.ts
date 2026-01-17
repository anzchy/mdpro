import type { ViewMode } from "./editor";

export interface UserPreferences {
  /** Theme mode preference */
  themeMode: "light" | "dark" | "system";

  /** Auto-save interval in seconds */
  autoSaveInterval: number;

  /** Default view mode on startup */
  defaultViewMode: ViewMode;

  /** Show sidebar on startup */
  showSidebar: boolean;

  /** Enable scroll sync */
  enableScrollSync: boolean;

  /** Recently opened file paths */
  recentFiles: string[];

  /** Window state */
  windowState: WindowState;
}

export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized: boolean;
}
