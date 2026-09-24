/**
 * Base `UserPreferences` fixture for the preference write-path suite.
 *
 * Purpose: give every case in the preference write-path matrix the same
 * starting value that `get_preferences` would return, built from the **real**
 * `DEFAULT_*_CONFIG` exports of `src/types/preferences` plus a small set of
 * explicit, deliberately distinguishable overrides.
 *
 * It is typed as `UserPreferences` (not `Partial`, not a structural literal) so
 * that adding or renaming a field in `src/types/preferences.ts` is a **compile
 * error here** rather than a fixture that silently drifts away from the shape
 * the app actually passes across the IPC boundary.
 *
 * This is not a mock. It is a value.
 *
 * NOTE (matrix § 0.6): a green preference suite does **not** mean preferences
 * persist in the shipping app today. `isTauriEnv()` in
 * `src/services/preferencesService.ts` tests for `__TAURI__`, which Tauri v2
 * does not inject, so the real `set_preferences` transport is unreachable. This
 * fixture models the value the backend contract says it returns, not evidence
 * that the transport runs.
 *
 * @module tests/support/preferenceFixtures
 */

import type {
  ExportConfig,
  ImageConfig,
  UserPreferences,
} from "../../src/types/preferences";
import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_AUTO_SAVE_CONFIG,
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_EXPORT_CONFIG,
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_MARKDOWN_CONFIG,
  DEFAULT_MCP_CONFIG,
  DEFAULT_TAB_BAR_CONFIG,
} from "../../src/types/preferences";

/**
 * The base preference value. Scalars carry values distinguishable from the
 * type-level defaults so that a fold bug cannot accidentally produce the right
 * answer; group objects come from the real `DEFAULT_*_CONFIG` exports.
 */
export const BASE_PREFERENCES: UserPreferences = {
  themeMode: "system",
  autoSaveInterval: 30,
  defaultViewMode: "wysiwyg",
  lastViewMode: "source",
  showSidebar: true,
  enableScrollSync: true,
  recentFiles: ["/base/one.md", "/base/two.md"],
  windowState: {
    width: 1280,
    height: 800,
    x: 40,
    y: 60,
    isMaximized: false,
  },
  keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS },
  logging: { enabled: true, level: "info" },
  windowStates: {
    "/base/one.md": { x: 10, y: 20, width: 900, height: 700 },
  },
  mcp: { ...DEFAULT_MCP_CONFIG },
  editor: { ...DEFAULT_EDITOR_CONFIG },
  markdown: { ...DEFAULT_MARKDOWN_CONFIG },
  appearance: { ...DEFAULT_APPEARANCE_CONFIG },
  image: { ...DEFAULT_IMAGE_CONFIG },
  export: { ...DEFAULT_EXPORT_CONFIG },
  autoSave: { ...DEFAULT_AUTO_SAVE_CONFIG },
  tabBar: { ...DEFAULT_TAB_BAR_CONFIG },
};

/**
 * A fresh deep copy of {@link BASE_PREFERENCES} with top-level overrides
 * applied. Every case gets its own object graph, so no case can mutate the
 * value another case starts from.
 */
export function makePreferences(
  overrides: Partial<UserPreferences> = {},
): UserPreferences {
  const clone = JSON.parse(JSON.stringify(BASE_PREFERENCES)) as UserPreferences;
  return { ...clone, ...JSON.parse(JSON.stringify(overrides)) };
}

// ---------------------------------------------------------------------------
// Named group values used by the fold cases (F-A, F-B, F-B', F-C) and by the
// WI-1 / WI-2 component cases. Complete groups: every leaf of the interface is
// present, which is what the backend's whole-group replace requires.
// ---------------------------------------------------------------------------

/** The stored export group most cases start from. */
export const EXPORT_OLD: ExportConfig = {
  defaultFolder: "/old",
  htmlIncludeStyles: false,
};

/** First distinguishable replacement export group. */
export const EXPORT_E1: ExportConfig = {
  defaultFolder: "/new",
  htmlIncludeStyles: true,
};

/** Second distinguishable replacement export group. */
export const EXPORT_E2: ExportConfig = {
  defaultFolder: "/picked",
  htmlIncludeStyles: false,
};

/** The stored image group most cases start from. */
export const IMAGE_OLD: ImageConfig = {
  assetFolder: "./assets",
  copyExternalImages: true,
  showPastePreview: true,
  maxDimension: null,
};

/** First distinguishable replacement image group. */
export const IMAGE_I1: ImageConfig = {
  assetFolder: "./images",
  copyExternalImages: false,
  showPastePreview: false,
  maxDimension: 1600,
};

/** Second distinguishable replacement image group. */
export const IMAGE_I2: ImageConfig = {
  assetFolder: "./media",
  copyExternalImages: true,
  showPastePreview: false,
  maxDimension: 800,
};
