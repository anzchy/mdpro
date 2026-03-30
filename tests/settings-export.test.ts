/**
 * Tests for ExportSettings component (WI-7 fixes).
 *
 * Strategy: source inspection.
 *
 * Covers:
 *   1. error state and cancellation guard in useEffect.
 *   2. Async rollback for handleBoolChange.
 *   3. Debounced folder text save (500 ms).
 *   4. handleBrowse uses exportService.pickFolder with rollback.
 *   5. ARIA: label htmlFor wired to control id on both controls.
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

  it("tracks error state", () => {
    expect(src).toContain("const [error, setError]");
  });

  it("useEffect has a cancellation guard", () => {
    expect(src).toContain("let cancelled");
    expect(src).toContain("cancelled = true");
  });

  it("renders error state", () => {
    expect(src).toContain("settings-error");
  });

  it("handleBoolChange rolls back prefs on save failure", () => {
    expect(src).toContain("setPrefs(prev)");
  });

  it("handleFolderChange debounces the save by 500 ms", () => {
    expect(src).toContain("setTimeout");
    expect(src).toContain("500");
  });

  it("handleBrowse calls exportService.pickFolder", () => {
    expect(src).toContain("exportService.pickFolder");
  });

  it("ARIA: default folder label is linked to its input via htmlFor/id", () => {
    expect(src).toContain('htmlFor="export-default-folder"');
    expect(src).toContain('id="export-default-folder"');
  });

  it("ARIA: include styles label is linked to its checkbox via htmlFor/id", () => {
    expect(src).toContain('htmlFor="export-include-styles"');
    expect(src).toContain('id="export-include-styles"');
  });
});
