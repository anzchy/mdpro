// @vitest-environment node
/**
 * M1A-WI-4: the command table (src/commands/), data only and inert.
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-4 and R1-11.
 * The v2 table and the availability table are written out literally from
 * docs/plans/20261015-plan-menu-reorganisation.md § 5.3.2 / R1-11, never derived.
 */
import { describe, expect, it } from "vitest";
import {
  COMMAND_TABLE,
  availabilityContexts,
  routeLogOwner,
  rowById,
  rowByPrefField,
} from "../src/commands/commandTable";
import type {
  Availability,
  OwnershipContext,
  Platform,
  Route,
} from "../src/commands/commandTable.types";
import { DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcuts } from "../src/types/preferences";

type Field = keyof KeyboardShortcuts;
const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const FIELDS = Object.keys(DEFAULT_KEYBOARD_SHORTCUTS) as Field[];
const VERSIONS = ["v1", "v2"] as const;

const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];
const W_ONLY: readonly OwnershipContext[] = ["editorW", "tableW"];
const S_ONLY: readonly OwnershipContext[] = ["editorS", "tableS"];
const TABLE: readonly OwnershipContext[] = ["tableW", "tableS"];
const ALL: readonly OwnershipContext[] = [...BOTH, "modal", "recorder", "nativeFocus"];

const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort();
const configurableRows = () => COMMAND_TABLE.filter((r) => r.prefField !== undefined);
const fixedRows = () => COMMAND_TABLE.filter((r) => r.prefField === undefined);

describe("COMMAND_TABLE prefField bijection", () => {
  it("maps each of the 58 KeyboardShortcuts fields to exactly one row", () => {
    const fields = configurableRows().map((r) => r.prefField as Field);
    expect(FIELDS).toHaveLength(58);
    expect(fields).toHaveLength(58);
    expect(new Set(fields).size).toBe(58);
    expect(sorted(fields)).toEqual(sorted(FIELDS));
    for (const f of FIELDS) expect(rowByPrefField(f)?.prefField).toBe(f);
  });

  it("gives every configurable row a configurable key, and every fixed row no prefField", () => {
    const bad: string[] = [];
    for (const r of COMMAND_TABLE) {
      for (const p of PLATFORMS) {
        const configurable = r.key[p].kind === "configurable";
        if (configurable !== (r.prefField !== undefined)) bad.push(`${r.id}/${p}`);
      }
    }
    expect(bad).toEqual([]);
    expect(fixedRows().length).toBeGreaterThan(0);
  });
});

describe("v1 defaults equal today's DEFAULT_KEYBOARD_SHORTCUTS", () => {
  it("holds for every configurable row × platform (174 checks)", () => {
    const mismatches: string[] = [];
    let checks = 0;
    for (const r of configurableRows()) {
      for (const p of PLATFORMS) {
        const k = r.key[p];
        checks += 1;
        const want = r.id === "format.image" && p !== "macos"
          ? "<unassigned>" : DEFAULT_KEYBOARD_SHORTCUTS[r.prefField as Field];
        if (k.kind !== "configurable" || k.defaults.v1 !== want) {
          mismatches.push(`${r.id}/${p}: ${String(k.defaults.v1)} != ${want}`);
        }
      }
    }
    expect(checks).toBe(174);
    expect(mismatches).toEqual([]);
  });
});

/** § 5.3.2 v2 defaults: [macos, windows]; Linux = Windows. */
const V2: Record<Field, readonly [string, string]> = {
  fileNew: ["Cmd+N", "Cmd+N"],
  fileNewWindow: ["Cmd+Shift+N", "Cmd+Shift+N"],
  fileOpen: ["Cmd+O", "Cmd+O"],
  fileOpenQuickly: ["<unassigned>", "<unassigned>"],
  fileSave: ["Cmd+S", "Cmd+S"],
  fileSaveAs: ["Cmd+Shift+S", "Cmd+Shift+S"],
  fileClose: ["Cmd+W", "Cmd+W"],
  filePreferences: ["Cmd+,", "Cmd+,"],
  fileExportHtml: ["Cmd+Shift+E", "Cmd+Shift+E"],
  editCopyAsMarkdown: ["Cmd+Shift+C", "Cmd+Shift+C"],
  editPasteAsPlainText: ["Cmd+Shift+V", "Cmd+Shift+V"],
  editSelectLine: ["Cmd+L", "Cmd+L"],
  editSelectWord: ["Cmd+D", "Cmd+D"],
  editDeleteWord: ["<unassigned>", "<unassigned>"],
  editJumpToTop: ["<system>", "<system>"],
  editJumpToBottom: ["<system>", "<system>"],
  editFind: ["Cmd+F", "Cmd+F"],
  editFindNext: ["Cmd+G", "Cmd+G"],
  editFindPrevious: ["Cmd+Shift+G", "Cmd+Shift+G"],
  editReplace: ["Cmd+H", "Cmd+H"],
  paragraphHeading1: ["Cmd+1", "Cmd+1"],
  paragraphHeading2: ["Cmd+2", "Cmd+2"],
  paragraphHeading3: ["Cmd+3", "Cmd+3"],
  paragraphHeading4: ["Cmd+4", "Cmd+4"],
  paragraphHeading5: ["Cmd+5", "Cmd+5"],
  paragraphHeading6: ["Cmd+6", "Cmd+6"],
  paragraphParagraph: ["Cmd+Shift+0", "Cmd+Shift+0"],
  paragraphIncreaseHeading: ["Cmd+Option+]", "Cmd+Option+]"],
  paragraphDecreaseHeading: ["Cmd+Option+[", "Cmd+Option+["],
  paragraphTable: ["Cmd+Shift+T", "Cmd+Shift+T"],
  paragraphCodeFences: ["Cmd+Option+C", "Cmd+Shift+K"],
  paragraphMathBlock: ["Cmd+Option+Shift+M", "Cmd+Option+Shift+M"],
  paragraphQuote: ["Cmd+Shift+B", "Cmd+Shift+Q"],
  paragraphOrderedList: ["Cmd+Option+O", "Cmd+Shift+["],
  paragraphUnorderedList: ["Cmd+Option+U", "Cmd+Shift+]"],
  paragraphIndent: ["Cmd+]", "Cmd+]"],
  paragraphOutdent: ["Cmd+[", "Cmd+["],
  formatStrong: ["Cmd+B", "Cmd+B"],
  formatEmphasis: ["Cmd+I", "Cmd+I"],
  formatUnderline: ["Cmd+U", "Cmd+U"],
  formatCode: ["Cmd+Shift+`", "Cmd+Shift+`"],
  formatStrike: ["Cmd+Shift+X", "Cmd+Shift+X"],
  formatHyperlink: ["Cmd+K", "Cmd+K"],
  formatImage: ["Cmd+Shift+I", "<unassigned>"],
  formatHighlight: ["Cmd+Shift+M", "Cmd+Shift+M"],
  formatClearFormat: ["Cmd+\\", "Cmd+\\"],
  viewSource: ["Ctrl+2", "<unassigned>"],
  viewWysiwyg: ["Ctrl+4", "<unassigned>"],
  viewToggleSidebar: ["Cmd+Shift+L", "Cmd+Shift+L"],
  viewCycleViewMode: ["Cmd+/", "Cmd+/"],
  viewToggleFullscreen: ["<system>", "F11"],
  viewSwitchDocuments: ["Ctrl+Tab", "Cmd+Tab"],
  tableInsertRowAbove: ["Cmd+Option+Up", "Cmd+Option+Up"],
  tableInsertRowBelow: ["Cmd+Option+Down", "Cmd+Option+Down"],
  tableInsertColumnLeft: ["Cmd+Option+Left", "Cmd+Option+Left"],
  tableInsertColumnRight: ["Cmd+Option+Right", "Cmd+Option+Right"],
  tableDeleteRow: ["Cmd+Option+Backspace", "Cmd+Option+Backspace"],
  tableDeleteColumn: ["Cmd+Option+Shift+Backspace", "Cmd+Option+Shift+Backspace"],
};
const v2For = (f: Field, p: Platform): string => (p === "macos" ? V2[f][0] : V2[f][1]);

describe("v2 defaults equal the literal § 5.3.2 table", () => {
  it("covers exactly the 58 fields", () => {
    expect(sorted(Object.keys(V2))).toEqual(sorted(FIELDS));
  });

  it("matches every row × platform", () => {
    const mismatches: string[] = [];
    for (const f of FIELDS) {
      for (const p of PLATFORMS) {
        const k = rowByPrefField(f)?.key[p];
        if (k?.kind !== "configurable" || k.defaults.v2 !== v2For(f, p)) {
          mismatches.push(`${f}/${p}: ${String(k?.defaults.v2)} != ${v2For(f, p)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("changes 15 fields on macOS and 20 off-Mac", () => {
    const changed = (p: Platform) =>
      FIELDS.filter((f) => {
        const k = rowByPrefField(f)?.key[p];
        return k !== undefined && k.defaults.v1 !== k.defaults.v2;
      });
    expect(changed("macos")).toHaveLength(15);
    expect(changed("windows")).toHaveLength(19);
    expect(changed("linux")).toEqual(changed("windows"));
  });
});

describe("fixed and native rows carry Decision 9's v2 state", () => {
  const def = (id: string, p: Platform) => rowById(id)?.key[p].defaults;

  it("Hide and Close Window lose their macOS key; off-Mac Redo keeps Ctrl+Y; Exit has none", () => {
    expect(def("app.hide", "macos")).toEqual({ v1: "Cmd+H", v2: null });
    expect(def("window.closeWindow", "macos")).toEqual({ v1: "Cmd+W", v2: null });
    expect(def("edit.redo", "windows")?.v2).toBe("Ctrl+Y");
    expect(def("edit.redo", "linux")?.v2).toBe("Ctrl+Y");
    expect(def("app.quit", "windows")?.v2).toBeNull();
    expect(def("app.quit", "linux")?.v2).toBeNull();
    for (const id of ["app.hide", "window.closeWindow", "edit.redo", "app.quit"]) {
      expect(rowById(id)?.key.macos.kind).toBe("fixed");
    }
  });

  it("has the v2 secondaries F6, F3 and Shift+F3 on every platform, and no others", () => {
    const want: Record<string, readonly string[]> = {
      "view.cycleViewMode": ["F6"],
      "edit.findNext": ["F3"],
      "edit.findPrevious": ["Shift+F3"],
    };
    const got: Record<string, string[]> = {};
    for (const r of COMMAND_TABLE) {
      for (const p of PLATFORMS) {
        expect(r.key[p].secondaries.v1).toEqual([]);
        for (const s of r.key[p].secondaries.v2) (got[`${r.id}/${p}`] ??= []).push(s);
      }
    }
    const expected: Record<string, string[]> = {};
    for (const [id, keys] of Object.entries(want)) {
      for (const p of PLATFORMS) expected[`${id}/${p}`] = [...keys];
    }
    expect(got).toEqual(expected);
  });
});

describe("named failure modes of the data", () => {
  it("has unique ids and unique menuIds", () => {
    const ids = COMMAND_TABLE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const menuIds = COMMAND_TABLE.flatMap((r) => (r.menuId === undefined ? [] : [r.menuId]));
    expect(menuIds.length).toBeGreaterThan(10);
    expect(new Set(menuIds).size).toBe(menuIds.length);
    for (const id of ids) expect(rowById(id)?.id).toBe(id);
  });

  it("uses rust-hide only on macOS, and no row uses it yet (F10)", () => {
    const uses = COMMAND_TABLE.flatMap((r) =>
      PLATFORMS.filter((p) => r.route[p] === "rust-hide").map((p) => `${r.id}/${p}`),
    );
    expect(uses.filter((u) => !u.endsWith("/macos"))).toEqual([]);
    expect(uses).toHaveLength(0);
  });

  it("gives every availability-none row route unavailable or a configurable key", () => {
    const bad: string[] = [];
    for (const r of COMMAND_TABLE) {
      for (const p of PLATFORMS) {
        for (const v of VERSIONS) {
          const none = r.availability[p][v] === "none";
          if (none && r.route[p] !== "unavailable" && r.key[p].kind !== "configurable") {
            bad.push(`${r.id}/${p}/${v}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives Linux the Windows menu, key, availability and route on every row", () => {
    const diffs = COMMAND_TABLE.filter(
      (r) =>
        JSON.stringify([r.menu.linux, r.key.linux, r.availability.linux, r.route.linux]) !==
        JSON.stringify([r.menu.windows, r.key.windows, r.availability.windows, r.route.windows]),
    ).map((r) => r.id);
    expect(diffs).toEqual([]);
  });

  it("never spells a Win, Meta or Super token", () => {
    const bad: string[] = [];
    for (const r of COMMAND_TABLE) {
      for (const p of PLATFORMS) {
        const k = r.key[p];
        const strings = [k.defaults.v1, k.defaults.v2, ...k.secondaries.v1, ...k.secondaries.v2];
        for (const s of strings) {
          if (s !== null && s.split("+").some((t) => ["Win", "Meta", "Super"].includes(t))) {
            bad.push(`${r.id}/${p}: ${s}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("has valid, non-empty, duplicate-free contexts on every row", () => {
    for (const r of COMMAND_TABLE) {
      expect(r.contexts.length).toBeGreaterThan(0);
      expect(new Set(r.contexts).size).toBe(r.contexts.length);
      for (const c of r.contexts) expect(ALL).toContain(c);
    }
  });
});

describe("routeLogOwner and availabilityContexts", () => {
  const ROUTES = ["frontend", "native", "rust-quit", "rust-hide", "unavailable"] as const satisfies
    readonly Route[];
  // Fails to type-check if a Route literal is missing from ROUTES.
  const everyRouteListed: [Exclude<Route, (typeof ROUTES)[number]>] extends [never] ? true : false =
    true;

  it("maps every Route literal per SD12", () => {
    expect(everyRouteListed).toBe(true);
    expect(ROUTES.map((r) => [r, routeLogOwner(r)])).toEqual([
      ["frontend", "frontend"],
      ["native", "native"],
      ["rust-quit", "rust"],
      ["rust-hide", "rust"],
      ["unavailable", "frontend"],
    ]);
  });

  it("maps every Availability literal to its contexts", () => {
    const AVAIL = ["both", "W", "S", "none"] as const satisfies readonly Availability[];
    const everyAvailListed: [Exclude<Availability, (typeof AVAIL)[number]>] extends [never]
      ? true
      : false = true;
    expect(everyAvailListed).toBe(true);
    expect(sorted(availabilityContexts("both"))).toEqual(sorted(BOTH));
    expect(sorted(availabilityContexts("W"))).toEqual(sorted(W_ONLY));
    expect(sorted(availabilityContexts("S"))).toEqual(sorted(S_ONLY));
    expect(availabilityContexts("none")).toEqual([]);
  });
});

/** R1-11: [v1, v2] availability (all platforms) and contexts, per field. */
const AVAILABILITY: Record<Field, readonly [Availability, Availability, readonly OwnershipContext[]]> = {
  fileNew: ["both", "both", BOTH],
  fileNewWindow: ["both", "both", BOTH],
  fileOpen: ["both", "both", BOTH],
  fileSave: ["both", "both", BOTH],
  fileClose: ["both", "both", BOTH],
  filePreferences: ["both", "both", BOTH],
  viewSource: ["both", "both", BOTH],
  viewWysiwyg: ["both", "both", BOTH],
  viewToggleSidebar: ["both", "both", BOTH],
  viewCycleViewMode: ["both", "both", BOTH],
  paragraphHeading1: ["both", "both", BOTH],
  paragraphHeading2: ["both", "both", BOTH],
  paragraphHeading3: ["both", "both", BOTH],
  paragraphHeading4: ["both", "both", BOTH],
  paragraphHeading5: ["both", "both", BOTH],
  paragraphHeading6: ["both", "both", BOTH],
  paragraphParagraph: ["both", "both", BOTH],
  paragraphIndent: ["both", "both", BOTH],
  paragraphOutdent: ["both", "both", BOTH],
  formatHyperlink: ["both", "both", BOTH],
  editJumpToTop: ["both", "both", BOTH],
  editJumpToBottom: ["both", "both", BOTH],
  paragraphTable: ["W", "W", W_ONLY],
  paragraphCodeFences: ["both", "both", BOTH],
  formatStrong: ["both", "both", BOTH],
  formatEmphasis: ["both", "both", BOTH],
  formatCode: ["both", "both", BOTH],
  formatStrike: ["both", "both", BOTH],
  paragraphIncreaseHeading: ["both", "both", BOTH],
  paragraphDecreaseHeading: ["both", "both", BOTH],
  editSelectWord: ["both", "both", BOTH],
  editFind: ["S", "S", S_ONLY],
  editFindNext: ["S", "S", S_ONLY],
  editFindPrevious: ["S", "S", S_ONLY],
  fileSaveAs: ["none", "none", BOTH],
  viewToggleFullscreen: ["none", "none", BOTH],
  paragraphMathBlock: ["S", "S", S_ONLY],
  paragraphOrderedList: ["S", "both", BOTH],
  paragraphUnorderedList: ["S", "both", BOTH],
  formatUnderline: ["both", "both", BOTH],
  formatImage: ["both", "both", BOTH],
  formatClearFormat: ["W", "W", BOTH],
  editCopyAsMarkdown: ["none", "none", BOTH],
  editPasteAsPlainText: ["none", "none", BOTH],
  editSelectLine: ["both", "both", BOTH],
  editDeleteWord: ["S", "S", BOTH],
  viewSwitchDocuments: ["none", "none", BOTH],
  paragraphQuote: ["none", "both", BOTH],
  editReplace: ["none", "S", BOTH],
  fileExportHtml: ["both", "both", BOTH],
  formatHighlight: ["both", "both", BOTH],
  fileOpenQuickly: ["none", "none", BOTH],
  tableInsertRowAbove: ["both", "both", TABLE],
  tableInsertRowBelow: ["both", "both", TABLE],
  tableInsertColumnLeft: ["both", "both", TABLE],
  tableInsertColumnRight: ["both", "both", TABLE],
  tableDeleteRow: ["both", "both", TABLE],
  tableDeleteColumn: ["both", "both", TABLE],
};

describe("R1-11: availability and contexts per row × platform × version", () => {
  it("covers exactly the 58 fields", () => {
    expect(sorted(Object.keys(AVAILABILITY))).toEqual(sorted(FIELDS));
  });

  it("matches the literal table", () => {
    const mismatches: string[] = [];
    for (const f of FIELDS) {
      const r = rowByPrefField(f);
      const [v1, v2, contexts] = AVAILABILITY[f];
      for (const p of PLATFORMS) {
        const got = r?.availability[p];
        const nowAvailable = f === "fileSaveAs" || f === "viewSwitchDocuments"
          || (f === "viewToggleFullscreen" && p !== "macos");
        const expectedV1 = nowAvailable ? "both" : v1;
        const expectedV2 = nowAvailable ? "both" : v2;
        if (got?.v1 !== expectedV1 || got.v2 !== expectedV2) {
          mismatches.push(`${f}/${p}: ${got?.v1}/${got?.v2} != ${v1}/${v2}`);
        }
      }
      if (JSON.stringify(sorted(r?.contexts ?? [])) !== JSON.stringify(sorted(contexts))) {
        mismatches.push(`${f}: contexts ${String(r?.contexts)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("gives fixed and native rows every context", () => {
    for (const r of fixedRows()) expect(sorted(r.contexts)).toEqual(sorted(ALL));
  });
});
