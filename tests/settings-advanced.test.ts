// @vitest-environment node
/**
 * Tests for AdvancedSettings component (WI-8 fixes).
 *
 * Strategy: source inspection for key correctness guarantees.
 *
 * Covers:
 *   1. isLogLevel type guard prevents invalid enum values.
 *   2. Both controls write through one queued useSettingsWriter, so neither
 *      sends the other's stale value (PR #508 F508-1; behaviour in wi43b-overlap-logging).
 *   3. The store moves only on a confirmed write (onConfirm), never optimistically.
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

  it("re-seeds the writer from the store until it writes, so a late hydrate is not missed (PR #508 N2)", () => {
    expect(src).toContain("if (!writer.busy()) writer.load({ enabled: storeEnabled, level: storeLevel })");
  });

  it("writes through the queued writer with setLoggingSettings", () => {
    expect(src).toContain("useSettingsWriter<LogSettings>");
    expect(src).toContain("save: (next) => loggingService.setLoggingSettings(next)");
  });

  it("moves the store only on a confirmed write (no premature optimistic update)", () => {
    const confirmIdx = src.indexOf("onConfirm: (confirmed) =>");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(src.indexOf("setEnabled(confirmed.enabled)")).toBeGreaterThan(confirmIdx);
    expect(src.indexOf("setLevel(confirmed.level)")).toBeGreaterThan(confirmIdx);
    expect(src).not.toContain("setEnabled(next)");
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
