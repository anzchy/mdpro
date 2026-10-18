/**
 * WI-4.3b: the settings pages that load preferences, and one save site per
 * page, for the states table (DESIGN.md § States › Settings).
 *
 * Builds on `settingsRowSites.installBoundary`, which spies on the service
 * boundary; the cases here re-point those spies at a pending or rejected read
 * or a rejected write.
 */
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { AppearanceSettings } from "../../src/components/common/settings/AppearanceSettings";
import { EditorSettings } from "../../src/components/common/settings/EditorSettings";
import { ExportSettings } from "../../src/components/common/settings/ExportSettings";
import { GeneralSettings } from "../../src/components/common/settings/GeneralSettings";
import { ImageSettings } from "../../src/components/common/settings/ImageSettings";
import { KeyboardShortcutsSettings } from "../../src/components/common/settings/KeyboardShortcutsSettings";
import { MarkdownSettings } from "../../src/components/common/settings/MarkdownSettings";
import { preferencesService } from "../../src/services/preferencesService";

/** The one line every page shows when its preferences read fails. */
export const LOAD_FAILED = "Failed to load preferences. Please close and reopen settings.";

/** A rejection text that must never reach the screen (rule 30 rule 3). */
export const SECRET = "EACCES: permission denied, open '/Users/someone/.mdpro/config.json'";

export type StatePage = "general" | "editor" | "markdown" | "image" | "export" | "appearance" | "shortcuts";

export const LOAD_PAGES: readonly StatePage[] = [
  "general", "editor", "markdown", "image", "export", "appearance", "shortcuts",
];

const PANELS: Record<Exclude<StatePage, "shortcuts">, ComponentType> = {
  general: GeneralSettings,
  editor: EditorSettings,
  markdown: MarkdownSettings,
  image: ImageSettings,
  export: ExportSettings,
  appearance: AppearanceSettings,
};

/** Shortcuts also reads the applied snapshot; without one it shows no pending lines. */
export function stubAppliedShortcuts(): void {
  vi.spyOn(preferencesService, "getAppliedShortcuts").mockRejectedValue(new Error("no snapshot"));
}

export function renderStatePage(page: StatePage, onClose: () => void = () => {}) {
  return page === "shortcuts"
    ? render(createElement(KeyboardShortcutsSettings, { onClose }))
    : render(createElement(PANELS[page]));
}

/**
 * One control per page whose rejected write must roll back. `next` is the
 * value a select is changed to; `saved` is the value it must return to (for a
 * switch, its saved `aria-checked`).
 */
export const SAVE_SITES: readonly {
  page: StatePage;
  role: "switch" | "combobox";
  name: string;
  next?: string;
  saved: string;
}[] = [
  { page: "general", role: "combobox", name: "Default View Mode", next: "source", saved: "wysiwyg" },
  { page: "editor", role: "combobox", name: "Line Height", next: "18", saved: "16" },
  { page: "appearance", role: "combobox", name: "Code Block Theme", next: "oneDark", saved: "default" },
  { page: "markdown", role: "switch", name: "Auto-pair Brackets & Quotes", saved: "false" },
  { page: "image", role: "switch", name: "Copy Images to Folder on Paste", saved: "false" },
  { page: "export", role: "switch", name: "Include Styles in HTML Export", saved: "false" },
];
