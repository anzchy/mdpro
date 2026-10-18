// @vitest-environment node
/**
 * Tests for MarkdownSettings component (WI-6 fixes).
 *
 * Strategy: source inspection.
 *
 * Covers:
 *   1. load-failure flag and cancellation guard in useEffect.
 *   2. Writes go through useSettingsWriter, which reverts prefs on failure.
 *   3. applyAutoPair runs for every shown change of autoPair, a rollback included.
 *   4. ARIA: row title (h4 id) wired to the control by aria-labelledby (WI-4.3a).
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

  it("handleChange writes through useSettingsWriter (PR #508)", () => {
    expect(src).toContain("useSettingsWriter<MarkdownConfig>");
  });

  it("the writer re-applies applyAutoPair on rollback (PR #508)", () => {
    expect(src).toContain("applyAutoPair(value as boolean)");
  });

  it("ARIA: auto-pair switch is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="md-auto-pair-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="md-auto-pair-label"/);
    expect(src).toContain('id="md-auto-pair"');
  });
});
