// @vitest-environment node
/**
 * @module typora-keymap-table-nav.test
 * Purpose: Verify Tab / Shift-Tab / Escape keymap entries for table-cell
 * navigation in WYSIWYG. Spec from
 * docs/plans/20260502-plan-table-crud.md WI-1.4.
 *
 * Critical regressions covered:
 *   - Tab inside a fenced code block still inserts a tab character
 *     (preserves d170f9c — codeBlockIndent must remain reachable).
 *   - Tab during IME composition is a no-op (CJK input safety).
 *   - Tab on the last cell of the last row appends a new row.
 *
 * Strategy: source inspection (mirrors tests/typora-keymap-missing-bindings.test.ts).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TYPORA_KEYMAP_CONFIG } from "../src/plugins/milkdown/typoraKeymapPlugin";

const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(
  path.join(ROOT, "src/plugins/milkdown/typoraKeymapPlugin.ts"),
  "utf-8",
);

describe("typoraKeymapPlugin — table navigation entries", () => {
  it("registers tableTab, tableShiftTab, tableExit entries", () => {
    expect(TYPORA_KEYMAP_CONFIG.tableTab).toBeDefined();
    expect(TYPORA_KEYMAP_CONFIG.tableShiftTab).toBeDefined();
    expect(TYPORA_KEYMAP_CONFIG.tableExit).toBeDefined();
  });

  it("tableTab binds Tab; tableShiftTab binds Shift-Tab; tableExit binds Escape", () => {
    expect(TYPORA_KEYMAP_CONFIG.tableTab.shortcuts).toBe("Tab");
    expect(TYPORA_KEYMAP_CONFIG.tableShiftTab.shortcuts).toBe("Shift-Tab");
    expect(TYPORA_KEYMAP_CONFIG.tableExit.shortcuts).toBe("Escape");
  });

  it("table entries are registered BEFORE codeBlockIndent in the config (table-first order)", () => {
    // Record key order matters: ProseMirror keymap chains commands per shortcut
    // and the first to return `true` wins. Table entries must come first so
    // table-cell Tab fires before code-block Tab; table commands return false
    // outside tables, so code-block Tab still works inside fences.
    const keys = Object.keys(TYPORA_KEYMAP_CONFIG);
    const tableTabIdx = keys.indexOf("tableTab");
    const codeBlockIndentIdx = keys.indexOf("codeBlockIndent");
    expect(tableTabIdx).toBeGreaterThanOrEqual(0);
    expect(codeBlockIndentIdx).toBeGreaterThanOrEqual(0);
    expect(tableTabIdx).toBeLessThan(codeBlockIndentIdx);
  });
});

describe("typoraKeymapPlugin — table command source structure", () => {
  it("imports goToNextTableCellCommand, goToPrevTableCellCommand, addRowAfterCommand, exitTable from gfm", () => {
    expect(src).toMatch(/goToNextTableCellCommand/);
    expect(src).toMatch(/goToPrevTableCellCommand/);
    expect(src).toMatch(/addRowAfterCommand/);
    expect(src).toMatch(/\bexitTable\b/);
    expect(src).toMatch(/from\s+["']@milkdown\/kit\/preset\/gfm["']/);
  });

  it("uses the @milkdown/kit/prose/tables re-export, NOT direct prosemirror-tables", () => {
    // Per rule R10 in the table-CRUD plan: prosemirror-tables is transitive,
    // not a direct dep. Use Milkdown's re-export to stay safe under strict
    // pnpm hoisting.
    expect(src).toMatch(/@milkdown\/kit\/prose\/tables/);
    expect(src).not.toMatch(/from\s+["']prosemirror-tables["']/);
  });

  it("guards Tab during IME composition (view.composing)", () => {
    // CJK users: Tab during composition must NOT consume the key (IME owns it)
    expect(src).toMatch(/composing/);
  });

  it("guards Tab when cursor is inside a fenced code block (preserves d170f9c)", () => {
    // The table-tab handler must return false when in a code block so the
    // codeBlockIndent handler downstream can do its job.
    expect(src).toMatch(/code_block/);
  });

  it("appends a row when Tab fires on the last cell (composes addRowAfterCommand + goToNextTableCellCommand)", () => {
    // The fallback path is the critical-gap regression: Tab on the last cell
    // of the last row inserts a new row and moves into it (Typora behavior).
    expect(src).toMatch(/addRowAfterCommand[\s\S]{0,200}goToNextTableCellCommand/);
  });
});
