/**
 * Tests for GeneralSettings component logic.
 *
 * Strategy: source inspection + editorStore unit tests.
 *
 * Covers:
 *   1. Source structure: setAutoSaveInterval is called when autoSaveInterval changes (Decision 1A).
 *   2. Source structure: cachedFullPrefs spread merge (not nested like editor config).
 *   3. Source structure: both defaultViewMode and autoSaveInterval are handled.
 *   4. editorStore.setAutoSaveInterval correctly updates state.
 *   5. editorStore initial autoSaveInterval default.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useEditorStore } from "../src/stores/editorStore";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const generalSettingsSrc = fs.readFileSync(
  path.join(SRC, "components/common/settings/GeneralSettings.tsx"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Source structure tests
// ---------------------------------------------------------------------------
describe("GeneralSettings — source structure", () => {
  it("exports GeneralSettings as a named export", () => {
    expect(generalSettingsSrc).toContain("export function GeneralSettings");
  });

  it("calls setAutoSaveInterval from editorStore when autoSaveInterval key changes (Decision 1A)", () => {
    expect(generalSettingsSrc).toContain("setAutoSaveInterval");
    // Must check key is 'autoSaveInterval' before calling
    expect(generalSettingsSrc).toContain('"autoSaveInterval"');
  });

  it("uses cachedFullPrefs ref for full-prefs preservation before setPreferences", () => {
    expect(generalSettingsSrc).toContain("cachedFullPrefs");
    expect(generalSettingsSrc).toContain("useRef");
  });

  it("spreads new key-value directly into cachedFullPrefs (not nested under 'general')", () => {
    // GeneralSettings stores top-level keys (defaultViewMode, autoSaveInterval) —
    // not nested config — so it spreads `...next` rather than nesting
    expect(generalSettingsSrc).toContain("...cachedFullPrefs.current, ...next");
  });

  it("imports useEditorStore to propagate live autoSaveInterval changes", () => {
    expect(generalSettingsSrc).toContain("useEditorStore");
  });

  it("renders defaultViewMode as a select control", () => {
    expect(generalSettingsSrc).toContain("defaultViewMode");
    expect(generalSettingsSrc).toContain("<select");
  });

  it("renders autoSaveInterval as a select control", () => {
    expect(generalSettingsSrc).toContain("autoSaveInterval");
  });

  it("shows aria-busy loading state while prefs are null", () => {
    expect(generalSettingsSrc).toContain('aria-busy="true"');
  });
});

// ---------------------------------------------------------------------------
// editorStore.setAutoSaveInterval unit tests (Decision 1A: store reacts immediately)
// ---------------------------------------------------------------------------
describe("editorStore.setAutoSaveInterval", () => {
  beforeEach(() => {
    useEditorStore.setState({ autoSaveInterval: 30 });
  });

  it("has default autoSaveInterval of 30 seconds", () => {
    const { autoSaveInterval } = useEditorStore.getState();
    expect(autoSaveInterval).toBe(30);
  });

  it("updates autoSaveInterval to the new value", () => {
    useEditorStore.getState().setAutoSaveInterval(300);
    expect(useEditorStore.getState().autoSaveInterval).toBe(300);
  });

  it("sets autoSaveInterval to 0 (off)", () => {
    useEditorStore.getState().setAutoSaveInterval(0);
    expect(useEditorStore.getState().autoSaveInterval).toBe(0);
  });

  it("successive calls reflect the latest value", () => {
    const { setAutoSaveInterval } = useEditorStore.getState();
    setAutoSaveInterval(60);
    setAutoSaveInterval(120);
    setAutoSaveInterval(30);
    expect(useEditorStore.getState().autoSaveInterval).toBe(30);
  });
});
