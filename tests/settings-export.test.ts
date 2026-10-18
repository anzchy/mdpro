// @vitest-environment node
/**
 * Tests for ExportSettings component (WI-7 fixes).
 *
 * Strategy: source inspection.
 *
 * Covers:
 *   1. load-failure flag and cancellation guard in useEffect.
 *   2. Writes go through useSettingsWriter (one at a time, rollback to the confirmed value).
 *   3. Debounced folder text save (500 ms).
 *   4. handleBrowse uses exportService.pickFolder; its write rolls back like a switch.
 *   5. ARIA: row title (h4 id) wired to the control by aria-labelledby (WI-4.3a) on both controls.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const src = fs.readFileSync(
  path.join(SRC, "components/common/settings/ExportSettings.tsx"),
  "utf-8",
);

describe("ExportSettings — source structure", () => {
  it("exports ExportSettings as a named export", () => {
    expect(src).toContain("export function ExportSettings");
  });

  it("tracks a load failure as a flag, not raw text (WI-4.3b)", () => {
    expect(src).toContain("const [loadFailed, setLoadFailed]");
  });

  it("useEffect has a cancellation guard", () => {
    expect(src).toContain("let cancelled");
    expect(src).toContain("cancelled = true");
  });

  it("renders the shared load-failure line, not an inline error (WI-4.3b)", () => {
    expect(src).toContain("<SettingsLoadFailed />");
    // The box comes from SettingsPageState; the page renders none of its own.
    expect(src).not.toContain("settings-error");
  });

  it("writes through useSettingsWriter; the folder text write keeps typed text on failure (PR #508)", () => {
    expect(src).toContain("useSettingsWriter<ExportConfig>");
    expect(src).toContain("{ rollback: false }");
  });

  it("handleFolderChange debounces the save by 500 ms", () => {
    expect(src).toContain("setTimeout");
    expect(src).toContain("500");
  });

  it("handleBrowse calls exportService.pickFolder", () => {
    expect(src).toContain("exportService.pickFolder");
  });

  it("ARIA: default folder input is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="export-default-folder-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="export-default-folder-label"/);
    expect(src).toContain('id="export-default-folder"');
  });

  it("ARIA: include styles switch is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="export-include-styles-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="export-include-styles-label"/);
    expect(src).toContain('id="export-include-styles"');
  });
});
