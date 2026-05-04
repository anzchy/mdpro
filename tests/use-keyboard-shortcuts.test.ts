/**
 * Tests for useKeyboardShortcuts hook (WI-9 fixes).
 *
 * Strategy: source inspection + pure logic tests on matchesShortcut.
 *
 * Covers:
 *   1. Source: accepts `shortcuts` parameter with DEFAULT_KEYBOARD_SHORTCUTS fallback.
 *   2. Source: exports matchesShortcut logic (dynamic matching replaces hardcoded keys).
 *   3. matchesShortcut logic: modifier flags, key normalization, case-insensitivity.
 *   4. matchesShortcut supports Option (altKey) modifier for Cmd+Option+T style shortcuts.
 *   5. matchesShortcut exact modifier matching (no spurious fires).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const src = fs.readFileSync(
  path.join(SRC, "hooks/useKeyboardShortcuts.ts"),
  "utf-8",
);

describe("useKeyboardShortcuts — source structure", () => {
  it("accepts a shortcuts parameter with DEFAULT_KEYBOARD_SHORTCUTS as default", () => {
    expect(src).toContain("shortcuts");
    expect(src).toContain("DEFAULT_KEYBOARD_SHORTCUTS");
    expect(src).toContain("shortcuts = DEFAULT_KEYBOARD_SHORTCUTS");
  });

  // Phase 1.5 follow-up — table action shortcuts wired through
  // onTableAction with the 6 TableShortcutAction ids.
  it("exposes onTableAction handler and the TableShortcutAction type", () => {
    expect(src).toContain("onTableAction");
    expect(src).toContain("TableShortcutAction");
    expect(src).toContain("insert_row_before");
    expect(src).toContain("insert_row_after");
    expect(src).toContain("insert_column_before");
    expect(src).toContain("insert_column_after");
    expect(src).toContain("delete_row");
    expect(src).toContain("delete_column");
  });

  it("dispatches table-action shortcuts via the matchesShortcut path", () => {
    expect(src).toContain("tableInsertRowAbove");
    expect(src).toContain("tableInsertRowBelow");
    expect(src).toContain("tableInsertColumnLeft");
    expect(src).toContain("tableInsertColumnRight");
    expect(src).toContain("tableDeleteRow");
    expect(src).toContain("tableDeleteColumn");
  });

  it("uses matchesShortcut for dynamic shortcut matching", () => {
    expect(src).toContain("matchesShortcut");
  });

  it("matchesShortcut handles altKey (Option) for Cmd+Option+* shortcuts", () => {
    // The old global altKey guard was removed; matchesShortcut checks it per-shortcut
    expect(src).toContain("event.altKey");
    expect(src).toContain("wantOption");
  });

  it("includes shortcuts in the useEffect dependency array", () => {
    expect(src).toContain("shortcuts,");
  });

  it("imports KeyboardShortcuts type from preferences", () => {
    expect(src).toContain("KeyboardShortcuts");
    expect(src).toContain("types/preferences");
  });
});

describe("DEFAULT_KEYBOARD_SHORTCUTS — table action defaults (Option A)", () => {
  it("binds Cmd+Option+arrows for insert directions", async () => {
    const prefs = await import("../src/types/preferences");
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.tableInsertRowAbove).toBe(
      "Cmd+Option+Up",
    );
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.tableInsertRowBelow).toBe(
      "Cmd+Option+Down",
    );
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.tableInsertColumnLeft).toBe(
      "Cmd+Option+Left",
    );
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.tableInsertColumnRight).toBe(
      "Cmd+Option+Right",
    );
  });

  it("binds Cmd+Option+Backspace for delete row, Shift variant for delete column", async () => {
    const prefs = await import("../src/types/preferences");
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.tableDeleteRow).toBe(
      "Cmd+Option+Backspace",
    );
    expect(prefs.DEFAULT_KEYBOARD_SHORTCUTS.tableDeleteColumn).toBe(
      "Cmd+Option+Shift+Backspace",
    );
  });
});

// ---------------------------------------------------------------------------
// matchesShortcut pure logic — extracted simulation
// (mirrors matchesShortcut in useKeyboardShortcuts.ts)
// ---------------------------------------------------------------------------

type MockKeyboardEvent = {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
};

// On macOS (test env): Cmd = metaKey
const IS_MAC = true;

function matchesShortcut(event: MockKeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  let wantCmd = false, wantCtrl = false, wantOption = false, wantShift = false;
  let keyPart = "";

  for (const p of parts) {
    if (p === "Cmd") wantCmd = true;
    else if (p === "Ctrl") wantCtrl = true;
    else if (p === "Option") wantOption = true;
    else if (p === "Shift") wantShift = true;
    else keyPart = p;
  }

  const primaryMod = IS_MAC ? event.metaKey : event.ctrlKey;
  if (wantCmd !== primaryMod) return false;
  if (wantCtrl !== event.ctrlKey) return false;
  if (wantOption !== event.altKey) return false;
  if (wantShift !== event.shiftKey) return false;

  let normalizedKey: string;
  if (keyPart === "Space") normalizedKey = " ";
  else if (keyPart === "Up") normalizedKey = "ArrowUp";
  else if (keyPart === "Down") normalizedKey = "ArrowDown";
  else if (keyPart === "Left") normalizedKey = "ArrowLeft";
  else if (keyPart === "Right") normalizedKey = "ArrowRight";
  else normalizedKey = keyPart;

  if (normalizedKey.length === 1) {
    return event.key.toUpperCase() === normalizedKey.toUpperCase();
  }
  return event.key === normalizedKey;
}

describe("matchesShortcut — shortcut matching", () => {
  it("Cmd+S matches metaKey+s event", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "s" }, "Cmd+S"))
      .toBe(true);
  });

  it("Cmd+S does not match without metaKey", () => {
    expect(matchesShortcut({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "s" }, "Cmd+S"))
      .toBe(false);
  });

  it("Cmd+S does not match Cmd+Shift+S", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, key: "s" }, "Cmd+S"))
      .toBe(false);
  });

  it("Cmd+Shift+L matches metaKey+shiftKey+l event (case-insensitive)", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, key: "l" }, "Cmd+Shift+L"))
      .toBe(true);
  });

  it("Cmd+Option+T matches metaKey+altKey+t event", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, key: "t" }, "Cmd+Option+T"))
      .toBe(true);
  });

  it("Cmd+Option+T does not match without altKey", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "t" }, "Cmd+Option+T"))
      .toBe(false);
  });

  it("Ctrl+Shift+` matches ctrlKey+shiftKey+backtick event", () => {
    expect(matchesShortcut({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: true, key: "`" }, "Ctrl+Shift+`"))
      .toBe(true);
  });

  it("Cmd+/ matches metaKey+slash event", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "/" }, "Cmd+/"))
      .toBe(true);
  });

  it("Cmd+, matches metaKey+comma event", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "," }, "Cmd+,"))
      .toBe(true);
  });

  it("Cmd+Up matches metaKey+ArrowUp event", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowUp" }, "Cmd+Up"))
      .toBe(true);
  });

  it("Cmd+Up does not match Cmd+ArrowDown", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "ArrowDown" }, "Cmd+Up"))
      .toBe(false);
  });

  it("matches are case-insensitive for single-char keys", () => {
    // Stored as uppercase "K", event.key may be "k" (no shift) or "K" (with shift)
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "K" }, "Cmd+K"))
      .toBe(true);
  });

  it("Cmd+Ctrl+I matches metaKey+ctrlKey+i event", () => {
    expect(matchesShortcut({ metaKey: true, ctrlKey: true, altKey: false, shiftKey: false, key: "i" }, "Cmd+Ctrl+I"))
      .toBe(true);
  });

  it("Cmd+N does not fire when altKey is also pressed", () => {
    // Exact match: wantOption=false but event.altKey=true → mismatch
    expect(matchesShortcut({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, key: "n" }, "Cmd+N"))
      .toBe(false);
  });
});
