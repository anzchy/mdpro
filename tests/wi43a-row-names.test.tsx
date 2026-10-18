/**
 * WI-4.3a: one row markup across the eight panels, and every control named by
 * its row title.
 *
 * - Table-driven over `ROWS`: the control's accessible name is exactly the row's
 *   `h4` text, through `aria-labelledby` on that `h4`'s id.
 * - Per panel: every `.settings-row` is `.settings-row-content` ›
 *   (`.settings-row-label` › `h4[id]` + optional `p`) + `.settings-row-control`,
 *   and the table lists every row, so a new row cannot escape the name check.
 * - The Font Size stepper, named by its title, still announces its value as its
 *   description.
 * - Source inspection: no `strong` row title, no `settings-row-description` and
 *   no `<label htmlFor>` wrapper remain in the panels.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { LOADED, PANEL_IDS, ROWS, firstTitle, installBoundary, renderPanel } from "./support/settingsRowSites";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PANEL_FILES = [
  "components/common/settings/AdvancedSettings.tsx",
  "components/common/settings/AppearanceSettings.tsx",
  "components/common/settings/EditorSettings.tsx",
  "components/common/settings/ExportSettings.tsx",
  "components/common/settings/GeneralSettings.tsx",
  "components/common/settings/ImageSettings.tsx",
  "components/common/settings/MarkdownSettings.tsx",
  "components/common/IntegrationsSettings.tsx",
  "components/common/McpToggleRow.tsx",
];
const read = (rel: string) => readFileSync(join(__dirname, "..", "src", rel), "utf8");

describe("WI-4.3a: every settings control is named by its row title", () => {
  it.each(ROWS.map((r) => [r.panel, r.title, r] as const))("%s › %s", async (_panel, title, row) => {
    await renderPanel(row.panel, installBoundary(), firstTitle(row.panel));
    const heading = screen.getByRole("heading", { level: 4, name: title });
    const control = screen.getByRole(row.role, { name: title });
    expect(heading.id).not.toBe("");
    expect(control.getAttribute("aria-labelledby")?.split(" ")).toContain(heading.id);
    expect(heading.closest(".settings-row")).toBe(control.closest(".settings-row"));
  });
});

describe("WI-4.3a: one row markup in every panel", () => {
  it.each(PANEL_IDS)("%s", async (panel) => {
    const { container } = await renderPanel(panel, installBoundary(), firstTitle(panel));
    const rows = [...container.querySelectorAll(".settings-row")];
    expect(rows).toHaveLength(ROWS.filter((r) => r.panel === panel).length);
    for (const row of rows) {
      const content = row.querySelector(":scope > .settings-row-content");
      expect(content).not.toBeNull();
      expect(content?.querySelector(":scope > .settings-row-label > h4[id]")).not.toBeNull();
      expect(content?.querySelector(":scope > .settings-row-control")).not.toBeNull();
      expect(row.querySelector("strong, label h4, .settings-row-description")).toBeNull();
    }
  });
});

describe("WI-4.3a: the Font Size stepper", () => {
  it("is named by its row title and keeps its value as its description", async () => {
    await renderPanel("editor", installBoundary(), firstTitle("editor"));
    const stepper = screen.getByRole("group", { name: "Font Size" });
    expect(stepper).toHaveAccessibleDescription(`${LOADED.editor.fontSize}px`);
  });
});

describe("WI-4.3a source inspection", () => {
  it.each(PANEL_FILES)("%s has no strong title, settings-row-description or label wrapper", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/<strong\b/);
    expect(src).not.toContain("settings-row-description");
    expect(src).not.toMatch(/<label\s+htmlFor/);
  });
});
