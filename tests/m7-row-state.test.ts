// @vitest-environment node
/**
 * M7: the state of one Settings › Keyboard Shortcuts row (DESIGN.md "Native
 * menu bar and Keyboard Shortcuts page"; plan § 6 M7), Reset's defaults per
 * version (a6's `resetDefaults(platform, version)`, which M1b's v2 fix
 * builds on), and the recorder's bare F1–F12 (D11: F6).
 *
 * Pending is saved ≠ applied, read from the run's applied snapshot and never
 * from unsaved edits (ADR-0114 Decision 4). Before M1b nothing is suppressed
 * at startup, so the suppressed-duplicate case is M1b's.
 */
import { describe, expect, it } from "vitest";
import { rowById, rowByPrefField } from "../src/commands/commandTable";
import type { CommandRow, Platform } from "../src/commands/commandTable.types";
import { resetDefaults } from "../src/components/common/settings/shortcuts/resetDefaults";
import { rowStateOf, type RowStateInput } from "../src/components/common/settings/shortcuts/rowState";
import type { AppliedBinding } from "../src/types/keyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcuts } from "../src/types/preferences";
import { recordedShortcut } from "../src/utils/platformLabels";

const NONE = new Set<keyof KeyboardShortcuts>();

function input(row: CommandRow, over: Partial<RowStateInput> = {}): RowStateInput {
  return {
    row,
    platform: "macos",
    version: 1,
    local: { ...DEFAULT_KEYBOARD_SHORTCUTS },
    saved: { ...DEFAULT_KEYBOARD_SHORTCUTS },
    applied: null,
    conflicts: NONE,
    ...over,
  };
}

const field = (f: keyof KeyboardShortcuts) => rowByPrefField(f) as CommandRow;
const id = (i: string) => rowById(i) as CommandRow;
const bound = (chord: string): AppliedBinding => ({ state: "bound", chord });

describe("M7 row states", () => {
  it("s1 availability none is 'unavailable', on every platform and version it holds", () => {
    expect(rowStateOf(input(field("fileSaveAs")))).toEqual({ kind: "unavailable" });
    expect(rowStateOf(input(field("fileOpenQuickly"), { version: 2, platform: "windows" }))).toEqual({ kind: "unavailable" });
  });

  it("s2 Replace is unavailable at v1 and an ordinary Source-only row at v2 (D13)", () => {
    expect(rowStateOf(input(field("editReplace")))).toEqual({ kind: "unavailable" });
    expect(rowStateOf(input(field("editReplace"), { version: 2 }))).toMatchObject({
      kind: "configurable",
      value: "Cmd+H",
      capability: "Source only",
    });
  });

  it("s3 W and S rows carry their capability line; both-mode rows carry none", () => {
    expect(rowStateOf(input(field("formatStrong")))).toMatchObject({ kind: "configurable", capability: "WYSIWYG only" });
    expect(rowStateOf(input(field("editFind")))).toMatchObject({ kind: "configurable", capability: "Source only" });
    expect(rowStateOf(input(field("fileSave")))).toMatchObject({ kind: "configurable", capability: null });
  });

  it("s4 a row's nativeBehaviour text replaces the capability line", () => {
    const base = field("editFind");
    const row: CommandRow = { ...base, nativeBehaviour: "WYSIWYG: browser find bar" };
    expect(rowStateOf(input(row, { platform: "windows" }))).toMatchObject({
      kind: "configurable",
      capability: "WYSIWYG: browser find bar",
    });
  });

  it("s5 a fixed row with a key is 'fixed' with that key; one with no key has no row", () => {
    expect(rowStateOf(input(id("edit.undo")))).toEqual({ kind: "fixed", key: "Cmd+Z", secondaries: [] });
    expect(rowStateOf(input(id("edit.redo"), { platform: "windows" }))).toEqual({ kind: "fixed", key: "Ctrl+Y", secondaries: [] });
    expect(rowStateOf(input(id("app.about")))).toBeNull();
    expect(rowStateOf(input(id("app.hide"), { version: 2 }))).toBeNull();
  });

  it("s6 a configurable row whose default is <system> is 'system' (Jump to Top / Bottom at v2)", () => {
    expect(rowStateOf(input(field("editJumpToTop"), { version: 2 }))).toEqual({ kind: "system", secondaries: [] });
    expect(rowStateOf(input(field("editJumpToBottom"), { version: 2 }))).toEqual({ kind: "system", secondaries: [] });
    expect(rowStateOf(input(field("editJumpToTop")))).toMatchObject({ kind: "configurable", value: "Cmd+Up" });
  });

  it("s7 fixed second keys come from the table: F6 on the view toggle, F3 / Shift+F3 on Find Next / Previous (v2)", () => {
    expect(rowStateOf(input(field("viewCycleViewMode"), { version: 2 }))).toMatchObject({ secondaries: ["F6"] });
    expect(rowStateOf(input(field("editFindNext"), { version: 2 }))).toMatchObject({ secondaries: ["F3"] });
    expect(rowStateOf(input(field("editFindPrevious"), { version: 2 }))).toMatchObject({ secondaries: ["Shift+F3"] });
    expect(rowStateOf(input(field("viewCycleViewMode")))).toMatchObject({ secondaries: [] });
  });

  it("s8 the row's value is the local edit, and a conflict flags only the named field", () => {
    const local = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileNew: "Cmd+Z" };
    const conflicts = new Set<keyof KeyboardShortcuts>(["fileNew"]);
    expect(rowStateOf(input(field("fileNew"), { local, conflicts }))).toMatchObject({ value: "Cmd+Z", conflict: true });
    expect(rowStateOf(input(field("fileSave"), { local, conflicts }))).toMatchObject({ conflict: false });
  });
});

describe("M7 pending: saved ≠ applied (ADR-0114 Decision 4)", () => {
  const applied = (over: Partial<Record<keyof KeyboardShortcuts, AppliedBinding>>) => ({
    ...Object.fromEntries(Object.entries(DEFAULT_KEYBOARD_SHORTCUTS).map(([f, c]) => [f, bound(c)])),
    ...over,
  });

  it("p1 a saved value the run does not use shows the active key and the one after restart", () => {
    const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Shift+K" };
    expect(rowStateOf(input(field("fileSave"), { saved, applied: applied({}) }))).toMatchObject({
      pending: { active: "Cmd+S", afterRestart: "Cmd+Shift+K" },
    });
  });

  it("p2 equal saved and applied values, including the states, are not pending", () => {
    const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileNew: "<unassigned>", fileOpen: "" };
    const a = applied({ fileNew: { state: "unassigned" } });
    expect(rowStateOf(input(field("fileSave"), { saved, applied: a }))).toMatchObject({ pending: null });
    expect(rowStateOf(input(field("fileNew"), { saved, applied: a }))).toMatchObject({ pending: null });
    expect(rowStateOf(input(field("fileOpen"), { saved, applied: a }))).toMatchObject({ pending: null });
  });

  it("p3 a chord written another way is the same chord", () => {
    const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileNewWindow: "Shift+Cmd+N" };
    expect(rowStateOf(input(field("fileNewWindow"), { saved, applied: applied({}) }))).toMatchObject({ pending: null });
  });

  it("p4 an unsaved edit neither creates nor clears pending", () => {
    const local = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Shift+K" };
    expect(rowStateOf(input(field("fileSave"), { local, applied: applied({}) }))).toMatchObject({ pending: null });
    const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Shift+K" };
    const back = { ...DEFAULT_KEYBOARD_SHORTCUTS };
    expect(rowStateOf(input(field("fileSave"), { saved, local: back, applied: applied({}) }))).toMatchObject({
      value: "Cmd+S",
      pending: { active: "Cmd+S", afterRestart: "Cmd+Shift+K" },
    });
  });

  it("p5 no applied snapshot means no pending line", () => {
    const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Shift+K" };
    expect(rowStateOf(input(field("fileSave"), { saved, applied: null }))).toMatchObject({ pending: null });
  });

  it("p6 a system binding against a saved chord is pending, shown as the state", () => {
    const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, editJumpToTop: "Cmd+Up" };
    expect(rowStateOf(input(field("editJumpToTop"), { saved, applied: applied({ editJumpToTop: { state: "system" } }) }))).toMatchObject({
      pending: { active: "<system>", afterRestart: "Cmd+Up" },
    });
  });
});

describe("M7 resetDefaults(platform, version)", () => {
  const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];

  it("d1 v1 is today's defaults on every platform", () => {
    for (const p of PLATFORMS) expect(resetDefaults(p, 1)).toEqual(DEFAULT_KEYBOARD_SHORTCUTS);
  });

  it("d2 v2 is the table's v2 per platform, states included", () => {
    const mac = resetDefaults("macos", 2);
    expect(mac.fileOpenQuickly).toBe("<unassigned>");
    expect(mac.editDeleteWord).toBe("<unassigned>");
    expect(mac.editJumpToTop).toBe("<system>");
    expect(mac.paragraphQuote).toBe("Cmd+Shift+B");
    const win = resetDefaults("windows", 2);
    expect(win.viewSource).toBe("<unassigned>");
    expect(win.paragraphQuote).toBe("Cmd+Shift+Q");
    expect(win.viewToggleFullscreen).toBe("F11");
    expect(Object.keys(win).sort()).toEqual(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS).sort());
  });
});

describe("M7 recorder: F1–F12 record alone (D11)", () => {
  const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("f1 bare F1, F6 and F12 record on both platforms", () => {
    for (const isMac of [true, false]) {
      expect(recordedShortcut(key("F1"), isMac)).toBe("F1");
      expect(recordedShortcut(key("F6"), isMac)).toBe("F6");
      expect(recordedShortcut(key("F12"), isMac)).toBe("F12");
    }
  });

  it("f2 a modified F key records as before; F13, F0 and other bare keys keep waiting", () => {
    expect(recordedShortcut(key("F3", { shiftKey: true }), true)).toBe("Shift+F3");
    for (const isMac of [true, false]) {
      expect(recordedShortcut(key("F13"), isMac)).toBeNull();
      expect(recordedShortcut(key("F0"), isMac)).toBeNull();
      expect(recordedShortcut(key("f"), isMac)).toBeNull();
      expect(recordedShortcut(key("Tab"), isMac)).toBeNull();
    }
  });
});
