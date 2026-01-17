export interface ThemeColors {
  /** Editor background */
  editorBg: string;

  /** Editor text color */
  editorText: string;

  /** Preview background */
  previewBg: string;

  /** Preview text color */
  previewText: string;

  /** Sidebar background */
  sidebarBg: string;

  /** Toolbar background */
  toolbarBg: string;

  /** Accent color (buttons, links) */
  accent: string;

  /** Border color */
  border: string;

  /** Selection highlight */
  selection: string;

  /** Code block background */
  codeBg: string;
}

export interface ThemeFonts {
  /** Editor font family */
  editorFont: string;

  /** Editor font size (px) */
  editorFontSize: number;

  /** Preview font family */
  previewFont: string;

  /** Preview font size (px) */
  previewFontSize: number;

  /** Code font family (monospace) */
  codeFont: string;

  /** Line height multiplier */
  lineHeight: number;
}

export interface Theme {
  /** Theme identifier */
  id: "light" | "dark";

  /** Display name */
  name: string;

  /** Color palette */
  colors: ThemeColors;

  /** Font settings */
  fonts: ThemeFonts;
}
