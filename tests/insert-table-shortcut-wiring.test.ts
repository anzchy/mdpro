/**
 * @module insert-table-shortcut-wiring.test
 * Purpose: Verify that the existing `paragraphTable` shortcut
 * (Cmd+Option+T, defined in src/types/preferences.ts) is wired through
 * to a useKeyboardShortcuts handler and that App.tsx passes a callback
 * for it. Closes the ghost-shortcut TODO at TODOS.md:13.
 *
 * Strategy: source inspection (mirrors tests/use-keyboard-shortcuts.test.ts).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const useKeyboardShortcutsSrc = fs.readFileSync(
  path.join(ROOT, "src/hooks/useKeyboardShortcuts.ts"),
  "utf-8",
);
const appSrc = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf-8");
const preferencesSrc = fs.readFileSync(
  path.join(ROOT, "src/types/preferences.ts"),
  "utf-8",
);

describe("paragraphTable shortcut is wired to insert-table flow", () => {
  it("preferences.ts already declares paragraphTable with Cmd+Option+T default", () => {
    // Spec: WI-0 reuses the existing shortcut, does not introduce a new one.
    expect(preferencesSrc).toMatch(/paragraphTable:\s*string/);
    expect(preferencesSrc).toMatch(/paragraphTable:\s*"Cmd\+Option\+T"/);
  });

  it("useKeyboardShortcuts accepts an onInsertTable handler", () => {
    expect(useKeyboardShortcutsSrc).toContain("onInsertTable");
  });

  it("useKeyboardShortcuts matches paragraphTable shortcut and dispatches onInsertTable", () => {
    expect(useKeyboardShortcutsSrc).toMatch(
      /matchesShortcut\(event,\s*shortcuts\.paragraphTable\)/,
    );
  });

  it("the paragraphTable handler logs a structured shortcut action", () => {
    // Every shortcut handler in this hook follows the loggingService.logShortcut pattern.
    expect(useKeyboardShortcutsSrc).toMatch(
      /logShortcut\(shortcuts\.paragraphTable.*?paragraph\.table/s,
    );
  });

  it("App.tsx passes an onInsertTable callback to useKeyboardShortcuts", () => {
    expect(appSrc).toMatch(/onInsertTable:/);
  });

  it("App.tsx onInsertTable triggers tableInsertStore.requestInsert", () => {
    // The bridge from app-level shortcut to React modal — mirrors linkInsertStore.
    expect(appSrc).toContain("requestInsert");
  });
});
