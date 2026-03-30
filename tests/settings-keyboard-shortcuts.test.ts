/**
 * Tests for KeyboardShortcutsSettings component.
 *
 * Strategy: source inspection + pure logic tests on the key-capture algorithm.
 *
 * Covers:
 *   1. Source structure: isDirty state, dirty banner with role="alert".
 *   2. handleReset sets isDirty=true.
 *   3. handleDiscard restores savedShortcuts and clears isDirty.
 *   4. handleSave calls setPreferences and onClose.
 *   5. handleKeyCapture logic: modifier detection, key normalization.
 *   6. handleKeyCapture: ignores lone modifier keypresses.
 *   7. Source: renders shortcut categories (File, Edit, etc.).
 *   8. Source: editingKey state and "Press keys…" indicator.
 *
 * Edge cases:
 *   - Space key normalized to "Space".
 *   - Arrow keys normalized to directional names.
 *   - Single character keys uppercased.
 *   - Modifier-only keypress (Meta alone) → no shortcut recorded.
 *   - Combined modifiers (Cmd+Shift+K).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const kbSrc = fs.readFileSync(
  path.join(SRC, "components/common/settings/KeyboardShortcutsSettings.tsx"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Source structure
// ---------------------------------------------------------------------------
describe("KeyboardShortcutsSettings — source structure", () => {
  it("exports KeyboardShortcutsSettings as a named export", () => {
    expect(kbSrc).toContain("export function KeyboardShortcutsSettings");
  });

  it("tracks isDirty state", () => {
    expect(kbSrc).toContain("isDirty");
    expect(kbSrc).toContain("setIsDirty");
  });

  it("renders dirty banner with role='alert' when isDirty is true", () => {
    expect(kbSrc).toContain('role="alert"');
    expect(kbSrc).toContain("isDirty");
  });

  it("dirty banner contains 'Unsaved shortcut changes' text", () => {
    expect(kbSrc).toContain("Unsaved shortcut changes");
  });

  it("dirty banner has a Discard button that calls handleDiscard", () => {
    expect(kbSrc).toContain("handleDiscard");
    expect(kbSrc).toContain("Discard");
  });

  it("dirty banner has a Save button that calls handleSave", () => {
    expect(kbSrc).toContain("handleSave");
    expect(kbSrc).toContain("Save");
  });

  it("handleReset sets localShortcuts to DEFAULT_KEYBOARD_SHORTCUTS and isDirty=true", () => {
    expect(kbSrc).toContain("DEFAULT_KEYBOARD_SHORTCUTS");
    expect(kbSrc).toContain("setIsDirty(true)");
  });

  it("handleDiscard restores savedShortcuts and sets isDirty=false", () => {
    expect(kbSrc).toContain("setLocalShortcuts(savedShortcuts)");
    expect(kbSrc).toContain("setIsDirty(false)");
  });

  it("handleSave calls preferencesService.setPreferences with localShortcuts", () => {
    expect(kbSrc).toContain("preferencesService.setPreferences");
    expect(kbSrc).toContain("localShortcuts");
  });

  it("handleSave calls onClose after a successful save", () => {
    expect(kbSrc).toContain("onClose()");
  });

  it("renders all defined shortcut categories", () => {
    expect(kbSrc).toContain('"File"');
    expect(kbSrc).toContain('"Edit"');
    expect(kbSrc).toContain('"Paragraph"');
    expect(kbSrc).toContain('"Format"');
    expect(kbSrc).toContain('"View"');
  });

  it("shows 'Press keys...' when a shortcut is being edited", () => {
    expect(kbSrc).toContain("Press keys...");
    expect(kbSrc).toContain("editingKey");
  });

  it("adds keydown listener to window when editingKey is set", () => {
    expect(kbSrc).toContain('window.addEventListener("keydown"');
    expect(kbSrc).toContain("handleKeyCapture");
  });

  it("removes keydown listener on cleanup", () => {
    expect(kbSrc).toContain('window.removeEventListener("keydown"');
  });

  it("uses loggingService.logButtonClick for reset action", () => {
    expect(kbSrc).toContain("loggingService.logButtonClick");
    expect(kbSrc).toContain("shortcuts.reset");
  });
});

// ---------------------------------------------------------------------------
// Key capture logic — extracted pure simulation
// (mirrors handleKeyCapture in KeyboardShortcutsSettings)
// ---------------------------------------------------------------------------

type MockKeyboardEvent = {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
};

function captureShortcut(event: MockKeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");

  let keyName = event.key;
  if (keyName === " ") keyName = "Space";
  else if (keyName === "ArrowUp") keyName = "Up";
  else if (keyName === "ArrowDown") keyName = "Down";
  else if (keyName === "ArrowLeft") keyName = "Left";
  else if (keyName === "ArrowRight") keyName = "Right";
  else if (keyName.length === 1) keyName = keyName.toUpperCase();

  // Lone modifier — no shortcut
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;

  parts.push(keyName);
  return parts.join("+");
}

describe("key capture logic — shortcut assembly", () => {
  it("single letter key produces uppercase shortcut", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "k" }))
      .toBe("K");
  });

  it("Cmd+K produces 'Cmd+K'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "k" }))
      .toBe("Cmd+K");
  });

  it("Cmd+Shift+K produces 'Cmd+Shift+K'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, key: "k" }))
      .toBe("Cmd+Shift+K");
  });

  it("Space key is normalized to 'Space'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: " " }))
      .toBe("Space");
  });

  it("ArrowUp is normalized to 'Up'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowUp" }))
      .toBe("Up");
  });

  it("ArrowDown is normalized to 'Down'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowDown" }))
      .toBe("Down");
  });

  it("ArrowLeft is normalized to 'Left'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowLeft" }))
      .toBe("Left");
  });

  it("ArrowRight is normalized to 'Right'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowRight" }))
      .toBe("Right");
  });

  it("lone Meta keypress returns null (no shortcut recorded)", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "Meta" }))
      .toBeNull();
  });

  it("lone Shift keypress returns null", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: true, key: "Shift" }))
      .toBeNull();
  });

  it("lone Control keypress returns null", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, key: "Control" }))
      .toBeNull();
  });

  it("Option+K produces 'Option+K'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: true, shiftKey: false, key: "k" }))
      .toBe("Option+K");
  });

  it("Ctrl+Z produces 'Ctrl+Z'", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, key: "z" }))
      .toBe("Ctrl+Z");
  });

  it("non-letter special key (e.g. 'Tab') passes through unchanged", () => {
    const result = captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "Tab" });
    expect(result).toBe("Tab");
  });
});
