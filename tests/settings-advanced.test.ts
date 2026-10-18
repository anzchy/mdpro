// @vitest-environment node
/**
 * Tests for AdvancedSettings component (WI-8 fixes).
 *
 * Strategy: source inspection for key correctness guarantees.
 *
 * Covers:
 *   1. isLogLevel type guard prevents invalid enum values.
 *   2. Stale-closure race fixed: handlers call useLoggingStore.getState() for fresh values.
 *   3. Optimistic update order: setEnabled/setLevel called AFTER await succeeds.
 *   4. No inline save error: a failed write is signalled by the service toast (WI-4.3b).
 *   5. ARIA: row title (h4 id) wired to the control by aria-labelledby (WI-4.3a) on both controls.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const src = fs.readFileSync(
  path.join(SRC, "components/common/settings/AdvancedSettings.tsx"),
  "utf-8",
);

describe("AdvancedSettings — source structure", () => {
  it("exports AdvancedSettings as a named export", () => {
    expect(src).toContain("export function AdvancedSettings");
  });

  it("has an isLogLevel type guard", () => {
    expect(src).toContain("function isLogLevel");
    expect(src).toContain("is LogLevel");
  });

  it("uses useLoggingStore.getState() to avoid stale closures in toggle handler", () => {
    expect(src).toContain("useLoggingStore.getState()");
  });

  it("awaits setLoggingSettings before calling setEnabled (no premature optimistic update)", () => {
    // setEnabled must appear AFTER the await, not before
    const awaitIdx = src.indexOf("await loggingService.setLoggingSettings");
    const setEnabledIdx = src.indexOf("setEnabled(next)");
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(setEnabledIdx).toBeGreaterThan(awaitIdx);
  });

  it("awaits setLoggingSettings before calling setLevel", () => {
    const awaitIdx = src.lastIndexOf("await loggingService.setLoggingSettings");
    const setLevelIdx = src.indexOf("setLevel(rawValue)");
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(setLevelIdx).toBeGreaterThan(awaitIdx);
  });

  it("keeps no saveError state: the service toast signals a failed write (WI-4.3b)", () => {
    expect(src).not.toContain("saveError");
  });

  it("renders no inline save error (WI-4.3b)", () => {
    expect(src).not.toContain("settings-error");
  });

  it("ARIA: Enable Logging switch is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="adv-logging-enabled-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="adv-logging-enabled-label"/);
    expect(src).toContain('id="adv-logging-enabled"');
  });

  it("ARIA: Log Level select is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="adv-logging-level-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="adv-logging-level-label"/);
    expect(src).toContain('id="adv-logging-level"');
  });
});
