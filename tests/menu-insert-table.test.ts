/**
 * Purpose: keep Format → Insert Table's command-table description, native
 * builder wiring and frontend action observable across the M4 extraction.
 * The native key equivalent itself remains a macOS device check.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { dispatchMenuAction } from "../src/hooks/menuActionTable";
import { useTableInsertStore } from "../src/stores/tableInsertStore";

const ROOT = path.resolve(__dirname, "..");
const source = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf-8");
const layout = JSON.parse(source("src-tauri/src/menu_layout.json"));
const menuRs = source("src-tauri/src/menu.rs");
const formatRs = source("src-tauri/src/menu_format.rs");
const paragraphRs = source("src-tauri/src/menu_paragraph.rs");
const appTsx = source("src/App.tsx");
const shortcutDocs = source("docs/guide/keyboard-shortcuts.md");

afterEach(() => {
  useTableInsertStore.getState().clearPending();
  vi.restoreAllMocks();
});

describe("Format → Insert Table", () => {
  it("retains the v1 item, id, mode and key in the generated layout", () => {
    const row = layout.rows.find((entry: { id: string }) => entry.id === "paragraph.table");
    expect(row.menuId).toBe("menu.format.insert_table");
    expect(row.menu.macos).toEqual(["Format", "Insert Table"]);
    expect(row.key.macos.defaults.v1).toBe("Cmd+Option+T");
    expect(row.availability.macos.v1).toBe("W");
    // The Rust behavior case `m4_wi2_insert_table_descriptor...` checks the
    // same row after applying the snapshot and mode. These source checks pin
    // the native builder and route it consumes.
    expect(menuRs).toMatch(/const\s+MENU_FORMAT_INSERT_TABLE:\s*&str\s*=\s*"menu\.format\.insert_table"/);
    expect(paragraphRs).toMatch(/MENU_FORMAT_INSERT_TABLE[\s\S]*"Insert Table"[\s\S]*"CmdOrCtrl\+Alt\+T"/);
    expect(formatRs).toMatch(/SubmenuBuilder::new\(app,\s*"Format"\)[\s\S]*format_insert_table/);
    expect(menuRs).toMatch(/MENU_FORMAT_INSERT_TABLE\s*=>\s*emit_menu_action\(app,\s*"paragraph\.table",\s*None\)/);
  });

  it("opens exactly one real pending table insert and logs its control id", () => {
    const insert = vi.fn();
    const selected: string[] = [];
    dispatchMenuAction(
      { action: "paragraph.table" },
      { onInsertTable: () => useTableInsertStore.getState().requestInsert(insert) },
      (controlId) => {
        selected.push(controlId);
        return "m4-table-action";
      },
    );
    const pending = useTableInsertStore.getState().pendingCallback;
    expect(typeof pending).toBe("function");
    pending?.(2, 3);
    expect(insert).toHaveBeenCalledExactlyOnceWith(2, 3);
    expect(selected).toEqual(["menu.format.insert_table"]);
    // App's handler supplies the same store request to the real listener.
    expect(appTsx).toMatch(/useMenuEvents\(\{[\s\S]*onInsertTable:[\s\S]*\}\)/);
    const hook = source("src/hooks/useMenuEvents.ts");
    expect(hook).not.toMatch(/\]\s*,?\s*\[\s*handlers\.\w+|\},\s*\[\s*(?:\s*handlers\.\w+\s*,?)+\s*\]/);
  });

  it("documents the current v1 shortcut under Format", () => {
    expect(shortcutDocs).toMatch(/Cmd\s*\+\s*Option\s*\+\s*T[\s\S]{0,80}Insert Table/i);
  });
});
