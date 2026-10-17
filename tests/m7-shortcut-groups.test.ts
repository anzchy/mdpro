// @vitest-environment node
/**
 * M7: Settings › Keyboard Shortcuts derives its groups and rows from the
 * command table (plan § 6 M7, D3, D14; DESIGN.md "Native menu bar and
 * Keyboard Shortcuts page").
 *
 * The fixed-row rule is the user's prototype verdict, 2026-10-17
 * (prototype/m7-fixed-rows): 「A: every fixed row with a key」. Every fixed
 * row that has a key on the platform appears exactly once, in its D14 group;
 * a fixed row with no key there does not appear.
 */
import { describe, expect, it } from "vitest";
import { COMMAND_TABLE, rowById } from "../src/commands/commandTable";
import type { CommandRow, Platform } from "../src/commands/commandTable.types";
import {
  FIELD_LABELS,
  SHORTCUT_GROUPS,
  entryLabel,
  groupOf,
  isShownEntry,
  shortcutSections,
} from "../src/components/common/settings/shortcuts/shortcutGroups";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const VERSIONS = [1, 2] as const;
const ver = (v: number) => (v >= 2 ? "v2" : "v1");

const PREFIX_GROUP: Record<string, string> = {
  file: "File",
  edit: "Edit",
  paragraph: "Paragraph",
  format: "Format",
  view: "View",
  table: "Table",
  app: "mdpro",
  window: "Window",
  theme: "Theme",
  help: "Help",
};

function expectedGroup(row: CommandRow, p: Platform): string {
  if (row.id === "app.quit" && p !== "macos") return "File";
  return PREFIX_GROUP[row.id.split(".")[0] ?? ""] ?? "?";
}

function placements(p: Platform, v: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of shortcutSections(p, v)) {
    for (const e of s.entries) out.set(e.row.id, [...(out.get(e.row.id) ?? []), s.name]);
  }
  return out;
}

describe("M7 groups: every configurable entry, once, in its D14 group", () => {
  it("g1 each of the 58 configurable rows appears exactly once on every platform and version", () => {
    const configurable = COMMAND_TABLE.filter((r) => r.prefField !== undefined);
    expect(configurable).toHaveLength(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS).length);
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const placed = placements(p, v);
        for (const r of configurable) {
          expect({ p, v, id: r.id, groups: placed.get(r.id) }).toEqual({ p, v, id: r.id, groups: [expectedGroup(r, p)] });
        }
      }
    }
  });

  it("g2 D14: Export HTML in File, Highlight in Format, Undo / Redo in Edit, table keys in Table", () => {
    for (const p of PLATFORMS) {
      const placed = placements(p, 1);
      expect(placed.get("file.exportHtml")).toEqual(["File"]);
      expect(placed.get("format.highlight")).toEqual(["Format"]);
      expect(placed.get("edit.undo")).toEqual(["Edit"]);
      expect(placed.get("edit.redo")).toEqual(["Edit"]);
      expect(placed.get("table.deleteColumn")).toEqual(["Table"]);
    }
  });

  it("g3 Exit belongs to File off-Mac and Quit to the mdpro group on macOS", () => {
    const quit = rowById("app.quit") as CommandRow;
    expect(groupOf(quit, "macos")).toBe("mdpro");
    expect(groupOf(quit, "windows")).toBe("File");
    expect(groupOf(quit, "linux")).toBe("File");
  });

  it("g4 every command-table row maps to a known group", () => {
    for (const p of PLATFORMS) {
      for (const r of COMMAND_TABLE) expect(SHORTCUT_GROUPS).toContain(groupOf(r, p));
    }
  });

  it("g5 sections come in group order, rows in table order, and no section is empty", () => {
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const sections = shortcutSections(p, v);
        const names = sections.map((s) => s.name);
        const order = names.map((n) => SHORTCUT_GROUPS.indexOf(n));
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        for (const s of sections) {
          expect(s.entries.length).toBeGreaterThan(0);
          const idx = s.entries.map((e) => COMMAND_TABLE.indexOf(e.row));
          expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        }
      }
    }
    expect(shortcutSections("macos", 1).map((s) => s.name)).toEqual([
      "File", "Edit", "Paragraph", "Format", "View", "Table", "mdpro", "Window",
    ]);
    expect(shortcutSections("windows", 1).map((s) => s.name)).toEqual([
      "File", "Edit", "Paragraph", "Format", "View", "Table", "Window",
    ]);
  });
});

describe("M7 fixed rows, variant A (user verdict 「A: every fixed row with a key」)", () => {
  it("a1 every fixed row with a key on the platform appears exactly once in its group; one with no key does not appear", () => {
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const placed = placements(p, v);
        for (const r of COMMAND_TABLE.filter((x) => x.prefField === undefined)) {
          const key = r.key[p].defaults[ver(v)];
          const want = key === null ? undefined : [expectedGroup(r, p)];
          expect({ p, v, id: r.id, groups: placed.get(r.id) }).toEqual({ p, v, id: r.id, groups: want });
          expect(isShownEntry(r, p, v)).toBe(key !== null);
        }
      }
    }
  });

  it("a2 macOS v1 shows the 12 fixed rows by their menu names", () => {
    const fixedLabels = shortcutSections("macos", 1)
      .flatMap((s) => s.entries)
      .filter((e) => e.row.prefField === undefined)
      .map((e) => e.label);
    expect(fixedLabels).toEqual([
      "Undo", "Redo", "Cut", "Copy", "Paste", "Select All", "Enter Full Screen",
      "Quit mdpro", "Hide mdpro", "Hide Others", "Minimize", "Close Window",
    ]);
  });

  it("a3 Windows v1 shows 8 fixed rows, and no Exit row while Exit has no key", () => {
    const fixedLabels = shortcutSections("windows", 1)
      .flatMap((s) => s.entries)
      .filter((e) => e.row.prefField === undefined)
      .map((e) => e.label);
    expect(fixedLabels).toEqual(["Undo", "Redo", "Cut", "Copy", "Paste", "Select All", "Minimize", "Close Window"]);
    expect(placements("windows", 1).has("app.quit")).toBe(false);
  });

  it("a4 v2 drops the fixed rows that lose their key (Hide mdpro, macOS Close Window)", () => {
    const placed = placements("macos", 2);
    expect(placed.has("app.hide")).toBe(false);
    expect(placed.has("window.closeWindow")).toBe(false);
    expect(placed.get("app.hideOthers")).toEqual(["mdpro"]);
  });
});

describe("M7 labels", () => {
  it("l1 every configurable field has a label, and today's 49 keep theirs", () => {
    for (const f of Object.keys(DEFAULT_KEYBOARD_SHORTCUTS)) {
      expect(FIELD_LABELS[f as keyof typeof FIELD_LABELS], f).toMatch(/\S/);
    }
    expect(FIELD_LABELS.formatStrong).toBe("Bold");
    expect(FIELD_LABELS.viewWysiwyg).toBe("WYSIWYG");
    expect(FIELD_LABELS.paragraphCodeFences).toBe("Code Fences");
  });

  it("l2 the 9 fields the page lacked get readable names", () => {
    expect([
      FIELD_LABELS.fileOpenQuickly,
      FIELD_LABELS.fileExportHtml,
      FIELD_LABELS.formatHighlight,
      FIELD_LABELS.tableInsertRowAbove,
      FIELD_LABELS.tableInsertRowBelow,
      FIELD_LABELS.tableInsertColumnLeft,
      FIELD_LABELS.tableInsertColumnRight,
      FIELD_LABELS.tableDeleteRow,
      FIELD_LABELS.tableDeleteColumn,
    ]).toEqual([
      "Open Quickly", "Export HTML", "Highlight", "Insert Row Above", "Insert Row Below",
      "Insert Column Left", "Insert Column Right", "Delete Row", "Delete Column",
    ]);
  });

  it("l3 a fixed row takes its menu item's name on the platform, without a trailing ellipsis", () => {
    expect(entryLabel(rowById("app.quit") as CommandRow, "macos")).toBe("Quit mdpro");
    expect(entryLabel(rowById("app.quit") as CommandRow, "windows")).toBe("Exit");
    expect(entryLabel(rowById("app.stopWaitingQuit") as CommandRow, "macos")).toBe("Stop Waiting and Quit");
    expect(entryLabel(rowById("edit.undo") as CommandRow, "windows")).toBe("Undo");
  });
});
