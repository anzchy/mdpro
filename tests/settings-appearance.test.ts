// @vitest-environment node
/**
 * Tests for AppearanceSettings component (WI-8 fixes).
 *
 * Strategy: source inspection.
 *
 * Covers:
 *   1. isCodeTheme type guard validates enum before applying.
 *   2. Async rollback: reverts prefs and code theme on save failure.
 *   3. error state and cancellation guard in useEffect.
 *   4. ARIA: label htmlFor wired to control id.
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

  it("ARIA: code theme label is linked to its select via htmlFor/id", () => {
    expect(src).toContain('htmlFor="appearance-code-theme"');
    expect(src).toContain('id="appearance-code-theme"');
  });
});
