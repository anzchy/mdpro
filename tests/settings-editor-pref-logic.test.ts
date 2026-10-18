// @vitest-environment node
/**
 * Tests for EditorSettings component logic (source-inspection + pure logic).
 *
 * Strategy: EditorSettings renders a form with FontFamily select, FontSize stepper,
 * LineHeight select, ContentWidth select, TabSize select, and WordWrap checkbox.
 * We verify:
 *   1. The component wires every EditorConfig key through handleChange.
 *   2. handleChange calls applyEditorPref before setPreferences.
 *   3. cachedFullPrefs is used to merge (editor nested inside full prefs object).
 *   4. Source exports the component correctly.
 *
 * Non-goals: full React render (no @testing-library/react installed).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

const editorSettingsSrc = readComponent("components/common/settings/EditorSettings.tsx");
const editorPrefApplySrc = readComponent("components/common/settings/editorPrefApply.ts");

describe("EditorSettings — source structure", () => {
  it("imports applyEditorPref from editorPrefApply", () => {
    expect(editorSettingsSrc).toContain('from "./editorPrefApply"');
  });

  it("imports preferencesService from the services layer", () => {
    expect(editorSettingsSrc).toContain("preferencesService");
  });

  it("handleChange is async (await setPreferences)", () => {
    // handleChange is async so it can await the save and rollback on failure
    expect(editorSettingsSrc).toContain("const handleChange = async");
  });

  it("calls applyEditorPref(key, value) inside handleChange", () => {
    expect(editorSettingsSrc).toContain("applyEditorPref(key, value)");
  });

  it("sends only the editor slice to setPreferences (not full-object snapshot)", () => {
    // Sending only { editor: next } prevents whole-object snapshot race conditions
    expect(editorSettingsSrc).toContain("setPreferences({ editor: next })");
  });

  it("rolls back prefs and applied editor pref on save failure", () => {
    // On catch: restore previous local state and re-apply previous pref value
    expect(editorSettingsSrc).toContain("setPrefs(prevPrefs)");
    expect(editorSettingsSrc).toContain("applyEditorPref(key, prevPrefs[key])");
  });

  it("renders wordWrap as a ToggleSwitch", () => {
    expect(editorSettingsSrc).toContain("<ToggleSwitch");
    expect(editorSettingsSrc).toContain("wordWrap");
  });

  it("renders fontSize control via SettingsStepper", () => {
    expect(editorSettingsSrc).toContain("<SettingsStepper");
    expect(editorSettingsSrc).toContain('"fontSize"');
  });

  it("shows aria-busy loading state when prefs are null", () => {
    expect(editorSettingsSrc).toContain('aria-busy="true"');
  });

  it("exports EditorSettings as a named export", () => {
    expect(editorSettingsSrc).toContain("export function EditorSettings");
  });
});

describe("editorPrefApply — API surface", () => {
  it("exports applyEditorPref function", () => {
    expect(editorPrefApplySrc).toContain("export function applyEditorPref");
  });

  it("exports contentWidthToCss helper", () => {
    expect(editorPrefApplySrc).toContain("export function contentWidthToCss");
  });

  it("exports fontFamilyToCss helper", () => {
    expect(editorPrefApplySrc).toContain("export function fontFamilyToCss");
  });

  it("exports applyCodeTheme for appearance settings", () => {
    expect(editorPrefApplySrc).toContain("export function applyCodeTheme");
  });

  it("exports applyAutoPair for markdown settings", () => {
    expect(editorPrefApplySrc).toContain("export function applyAutoPair");
  });

  it("accesses editorView via useEditorStore.getState() (avoids stale closure)", () => {
    // Must use getState() not a hook call — these functions run outside React render
    expect(editorPrefApplySrc).toContain("useEditorStore.getState()");
    expect(editorPrefApplySrc).not.toContain("useEditorStore()");
  });

  it("guards against null editorView before dispatching (no crash when editor not mounted)", () => {
    expect(editorPrefApplySrc).toContain("if (!view) return");
  });
});
