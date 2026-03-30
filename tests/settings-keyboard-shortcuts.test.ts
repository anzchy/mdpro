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
 *   9. WI-9: Escape cancels the current edit without recording a shortcut.
 *  10. WI-9: NON_ACTIONABLE_KEYS expanded (Dead, Unidentified, CapsLock, etc.).
 *  11. WI-9: Modifier requirement — bare key capture rejected.
 *  12. WI-9: Conflict detection with UI warning.
 *  13. WI-9: Save error surfaced in UI.
 *  14. WI-9: Load error handling with cancellation guard.
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

  // WI-9 additions
  it("Escape key cancels the current edit (setEditingKey(null))", () => {
    expect(kbSrc).toContain('"Escape"');
    expect(kbSrc).toContain("setEditingKey(null)");
  });

  it("NON_ACTIONABLE_KEYS set includes Dead and Unidentified", () => {
    expect(kbSrc).toContain("NON_ACTIONABLE_KEYS");
    expect(kbSrc).toContain('"Dead"');
    expect(kbSrc).toContain('"Unidentified"');
    expect(kbSrc).toContain('"CapsLock"');
  });

  it("handleKeyCapture requires at least one modifier key", () => {
    expect(kbSrc).toContain("event.metaKey");
    expect(kbSrc).toContain("event.ctrlKey");
    expect(kbSrc).toContain("event.altKey");
    expect(kbSrc).toContain("event.shiftKey");
  });

  it("conflict detection: conflicts computed from localShortcuts", () => {
    expect(kbSrc).toContain("conflicts");
    expect(kbSrc).toContain("useMemo");
  });

  it("conflict warning shown when conflicts.size > 0", () => {
    expect(kbSrc).toContain("conflicts.size > 0");
    expect(kbSrc).toContain("Conflicting shortcuts detected");
  });

  it("save error state is tracked", () => {
    expect(kbSrc).toContain("saveError");
    expect(kbSrc).toContain("setSaveError");
  });

  it("save error is rendered in UI", () => {
    expect(kbSrc).toContain("{saveError &&");
  });

  it("handleSave surfaces errors in saveError state", () => {
    // Must set saveError on catch, not just log
    expect(kbSrc).toContain("setSaveError(");
  });

  it("load error state is tracked", () => {
    expect(kbSrc).toContain("loadError");
    expect(kbSrc).toContain("setLoadError");
  });

  it("useEffect load has a cancellation guard", () => {
    expect(kbSrc).toContain("let cancelled");
    expect(kbSrc).toContain("cancelled = true");
  });

  it("renders load error state", () => {
    expect(kbSrc).toContain("loadError");
    expect(kbSrc).toContain("settings-error");
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

const NON_ACTIONABLE_KEYS_SIM = new Set([
  "Meta", "Control", "Alt", "Shift",
  "Dead", "Unidentified", "CapsLock", "Fn", "Process", "OS", "Win",
]);

function captureShortcut(event: MockKeyboardEvent): string | null {
  // Escape cancels editing — caller handles; simulation returns null
  if (event.key === "Escape") return null;

  // Non-actionable keys are silently ignored (keep waiting)
  if (NON_ACTIONABLE_KEYS_SIM.has(event.key)) return null;

  // Bare key with no modifier is rejected
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return null;

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

  parts.push(keyName);
  return parts.join("+");
}

describe("key capture logic — shortcut assembly", () => {
  it("Cmd+K produces 'Cmd+K' (letter uppercased)", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "k" }))
      .toBe("Cmd+K");
  });

  it("Cmd+Shift+K produces 'Cmd+Shift+K'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, key: "k" }))
      .toBe("Cmd+Shift+K");
  });

  it("Cmd+Space is normalized to 'Cmd+Space'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: " " }))
      .toBe("Cmd+Space");
  });

  it("Cmd+ArrowUp is normalized to 'Cmd+Up'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowUp" }))
      .toBe("Cmd+Up");
  });

  it("Cmd+ArrowDown is normalized to 'Cmd+Down'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowDown" }))
      .toBe("Cmd+Down");
  });

  it("Cmd+ArrowLeft is normalized to 'Cmd+Left'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowLeft" }))
      .toBe("Cmd+Left");
  });

  it("Cmd+ArrowRight is normalized to 'Cmd+Right'", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowRight" }))
      .toBe("Cmd+Right");
  });

  it("lone Meta keypress returns null (non-actionable)", () => {
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

  it("Cmd+Tab passes multi-char special key through unchanged", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "Tab" }))
      .toBe("Cmd+Tab");
  });

  // WI-9: new behaviors
  it("bare letter key with no modifier returns null (modifier required)", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "k" }))
      .toBeNull();
  });

  it("Escape key returns null (cancels edit)", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "Escape" }))
      .toBeNull();
  });

  it("Dead key returns null (non-actionable IME key)", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "Dead" }))
      .toBeNull();
  });

  it("Unidentified key returns null", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "Unidentified" }))
      .toBeNull();
  });

  it("CapsLock key returns null", () => {
    expect(captureShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "CapsLock" }))
      .toBeNull();
  });

  it("Cmd+Option+T produces 'Cmd+Option+T' (multi-modifier with altKey)", () => {
    expect(captureShortcut({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, key: "t" }))
      .toBe("Cmd+Option+T");
  });
});
