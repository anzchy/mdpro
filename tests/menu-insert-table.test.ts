/**
 * @module menu-insert-table.test
 * Purpose: Verify the native menu item Format → Insert Table is wired
 * end-to-end: menu.rs declares it with the right accelerator, dispatches
 * a paragraph.table action; useMenuEvents handles the action and
 * forwards to the same insert-table flow that the ⌘⌥T shortcut uses.
 *
 * Strategy: source inspection across menu.rs, useMenuEvents.ts, App.tsx,
 * and the user-facing shortcut docs. Mirrors the per-three-files sync
 * pattern enforced by .claude/rules/41-keyboard-shortcuts.md.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const menuRs = fs.readFileSync(
  path.join(ROOT, "src-tauri/src/menu.rs"),
  "utf-8",
);
const useMenuEvents = fs.readFileSync(
  path.join(ROOT, "src/hooks/useMenuEvents.ts"),
  "utf-8",
);
const appTsx = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf-8");
const shortcutDocs = fs.readFileSync(
  path.join(ROOT, "docs/guide/keyboard-shortcuts.md"),
  "utf-8",
);

describe("menu.rs — Format > Insert Table item", () => {
  it("declares the MENU_FORMAT_INSERT_TABLE constant", () => {
    expect(menuRs).toMatch(
      /const\s+MENU_FORMAT_INSERT_TABLE:\s*&str\s*=\s*"menu\.format\.insert_table"/,
    );
  });

  it("builds the menu item with label \"Insert Table\" and accelerator CmdOrCtrl+Alt+T", () => {
    expect(menuRs).toMatch(
      /MENU_FORMAT_INSERT_TABLE[\s\S]*"Insert Table"[\s\S]*"CmdOrCtrl\+Alt\+T"/,
    );
  });

  it("adds the item to the Format submenu", () => {
    expect(menuRs).toMatch(
      /SubmenuBuilder::new\(app,\s*"Format"\)[\s\S]*format_insert_table/,
    );
  });

  it("dispatches paragraph.table action when the menu item fires", () => {
    expect(menuRs).toMatch(
      /MENU_FORMAT_INSERT_TABLE\s*=>\s*emit_menu_action\(app,\s*"paragraph\.table",\s*None\)/,
    );
  });
});

describe("useMenuEvents — paragraph.table handler", () => {
  it("declares an onInsertTable handler in MenuHandlers", () => {
    expect(useMenuEvents).toMatch(/onInsertTable\?:/);
  });

  it("handles the paragraph.table action and forwards to onInsertTable", () => {
    expect(useMenuEvents).toMatch(
      /case\s+"paragraph\.table":[\s\S]{0,200}handlers\.onInsertTable/,
    );
  });

  it("logs the menu select for the action", () => {
    expect(useMenuEvents).toMatch(
      /logMenuSelect\("menu\.format\.insert_table"\)/,
    );
  });

  it("includes onInsertTable in the useEffect dependency list", () => {
    expect(useMenuEvents).toMatch(/handlers\.onInsertTable[\s,]/);
  });
});

describe("App.tsx — wires onInsertTable into useMenuEvents", () => {
  it("passes an onInsertTable callback to useMenuEvents", () => {
    // Both useKeyboardShortcuts and useMenuEvents must trigger the same
    // tableInsertStore.requestInsert flow so the menu item and ⌘⌥T are
    // truly interchangeable.
    expect(appTsx).toMatch(
      /useMenuEvents\(\{[\s\S]*onInsertTable:[\s\S]*\}\)/,
    );
  });
});

describe("user docs — keyboard-shortcuts.md", () => {
  it("documents Cmd + Option + T → Insert Table under Format", () => {
    expect(shortcutDocs).toMatch(/Cmd\s*\+\s*Option\s*\+\s*T[\s\S]{0,80}Insert Table/i);
  });
});
