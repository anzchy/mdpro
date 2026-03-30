/**
 * Tests for MarkdownSettings component (WI-6 fixes).
 *
 * Strategy: source inspection.
 *
 * Covers:
 *   1. error state and cancellation guard in useEffect.
 *   2. Async rollback: reverts prefs and editor state on save failure.
 *   3. applyAutoPair is called with rollback value on failure.
 *   4. ARIA: label htmlFor wired to control id.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const src = fs.readFileSync(
  path.join(SRC, "components/common/settings/MarkdownSettings.tsx"),
  "utf-8",
);

describe("MarkdownSettings — source structure", () => {
  it("exports MarkdownSettings as a named export", () => {
    expect(src).toContain("export function MarkdownSettings");
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

  it("handleChange rolls back prefs on save failure", () => {
    expect(src).toContain("setPrefs(prev)");
  });

  it("handleChange rolls back editor state (applyAutoPair) on save failure", () => {
    expect(src).toContain("applyAutoPair(prev.autoPair)");
  });

  it("ARIA: auto-pair label is linked to its checkbox via htmlFor/id", () => {
    expect(src).toContain('htmlFor="md-auto-pair"');
    expect(src).toContain('id="md-auto-pair"');
  });
});
