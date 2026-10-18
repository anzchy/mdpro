// @vitest-environment node
/**
 * Tests for AppearanceSettings component (WI-8 fixes).
 *
 * Strategy: source inspection.
 *
 * Covers:
 *   1. isCodeTheme type guard validates enum before applying.
 *   2. Async rollback: reverts prefs and code theme on save failure.
 *   3. load-failure flag and cancellation guard in useEffect.
 *   4. ARIA: row title (h4 id) wired to the control by aria-labelledby (WI-4.3a).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const src = fs.readFileSync(
  path.join(SRC, "components/common/settings/AppearanceSettings.tsx"),
  "utf-8",
);

describe("AppearanceSettings — source structure", () => {
  it("exports AppearanceSettings as a named export", () => {
    expect(src).toContain("export function AppearanceSettings");
  });

  it("has an isCodeTheme type guard", () => {
    expect(src).toContain("function isCodeTheme");
    expect(src).toContain("is CodeTheme");
  });

  it("guards handleCodeThemeChange with isCodeTheme before applying", () => {
    expect(src).toContain("isCodeTheme(rawValue)");
  });

  it("rolls back prefs and code theme on save failure", () => {
    expect(src).toContain("setPrefs(prev)");
    expect(src).toContain("applyCodeTheme(prev.codeTheme)");
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

  it("ARIA: code theme select is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="appearance-code-theme-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="appearance-code-theme-label"/);
    expect(src).toContain('id="appearance-code-theme"');
  });
});
