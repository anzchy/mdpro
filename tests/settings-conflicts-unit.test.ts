// @vitest-environment node
/**
 * M1A-WI-10: `findSettingsConflicts`, the check that refuses Settings' Save
 * (matrix § M1A-WI-10, SD13, SD14, R1-12, R2-3; user ruling 2026-10-16
 * 「A: custom only (Recommended)」).
 *
 * Refused: a conflict involving a custom value. Allowed: default vs
 * default, default vs editor-owned, custom vs an unavailable row's default.
 *
 * M7: Settings now shows every field, so SD14's hidden set and its
 * non-blocking notices are gone; the 9 fields it hid refuse like the rest.
 *
 * The oracle for the relation sweep is `resolveBindings` (WI-8), read
 * directly; nothing here is mocked.
 */
import { describe, expect, it } from "vitest";
import { ownerOf, resolveBindings } from "../src/commands/bindingConflicts";
import type { Resolution } from "../src/commands/bindingConflicts.types";
import { normaliseStored } from "../src/commands/chord";
import { COMMAND_TABLE } from "../src/commands/commandTable";
import type { OwnershipContext, Platform } from "../src/commands/commandTable.types";
import * as settingsConflicts from "../src/commands/settingsConflicts";
import {
  findSettingsConflicts,
  settingsConflictLines,
  type SettingsConflicts,
} from "../src/commands/settingsConflicts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { FIELDS, POOL } from "./support/bindingSweep";
import { V2_DEFAULTS } from "./support/bindingV2Defaults";

const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const CONTEXTS: readonly OwnershipContext[] = [
  "editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus",
];

/** The 9 fields SD14 hid until M7 gave them rows. Literal, not read from src/. */
const HIDDEN: readonly string[] = [
  "fileOpenQuickly", "fileExportHtml", "formatHighlight",
  "tableInsertRowAbove", "tableInsertRowBelow", "tableInsertColumnLeft",
  "tableInsertColumnRight", "tableDeleteRow", "tableDeleteColumn",
];

const v2Defaults = (p: Platform): Record<string, string> =>
  Object.fromEntries(Object.entries(V2_DEFAULTS).map(([f, [mac, off]]) => [f, p === "macos" ? mac : off]));

const keysOf = (r: SettingsConflicts) => [...r.refusing.keys()].map(String).sort();

describe("M7 no hidden set: every field is shown", () => {
  it("exports no hidden set, and a result carries only refusing conflicts", () => {
    expect(settingsConflicts).not.toHaveProperty("SETTINGS_HIDDEN_FIELDS");
    expect(FIELDS.length).toBe(58);
    for (const f of HIDDEN) expect(FIELDS).toContain(f);
    expect(Object.keys(findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+J", fileExportHtml: "Cmd+J" }))).toEqual(["refusing"]);
  });
});

describe("M1A-WI-10 named Settings outcomes (u1–u20)", () => {
  it("u1–u3 v1 defaults on every platform: nothing refused", () => {
    for (const p of PLATFORMS) {
      const r = findSettingsConflicts(p, 1, {});
      expect(r.refusing.size, p).toBe(0);
    }
  });

  it("u2 off-Mac v1 data collisions (Image/Italic, Source/H2, Strike/Code) are default vs default: allowed", () => {
    // Guard: the collisions really are in the v1 data off-Mac (normal forms
    // equal), so the empty result is not vacuous.
    const norm = (f: keyof typeof DEFAULT_KEYBOARD_SHORTCUTS) => normaliseStored(DEFAULT_KEYBOARD_SHORTCUTS[f], "windows");
    expect(norm("formatImage")).toBe(norm("formatEmphasis"));
    expect(norm("viewSource")).toBe(norm("paragraphHeading2"));
    expect(norm("formatImage")).not.toBeNull();
    const r = findSettingsConflicts("windows", 1, {});
    expect(r.refusing.size).toBe(0);
  });

  it("u4 / u16 macOS: Toggle Sidebar vs the editor's Mod-Shift-l and ⌘W held by Close and Close Window are allowed", () => {
    expect(ownerOf("macos", 1, {}, "editorW", "Cmd+W")).toBe("window.closeWindow");
    const r = findSettingsConflicts("macos", 1, {});
    expect(r.refusing.size).toBe(0);
  });

  it("u5 Save = ⌘Z is refused as hard, naming Undo", () => {
    const r = findSettingsConflicts("macos", 1, { fileSave: "Cmd+Z" });
    expect(keysOf(r)).toEqual(["fileSave"]);
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "hard", with: ["edit.undo"], names: ["Undo"], value: "Cmd+Z" });
  });

  it("u6 a new duplicate of two customs refuses both rows, each naming the other", () => {
    const r = findSettingsConflicts("macos", 1, { fileNew: "Cmd+J", fileSave: "Cmd+J" });
    expect(keysOf(r)).toEqual(["fileNew", "fileSave"]);
    expect(r.refusing.get("fileNew")).toMatchObject({ kind: "duplicate", with: ["file.save"], names: ["Save"] });
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "duplicate", with: ["file.new"], names: ["New"] });
  });

  it("u7 Save = ⌘N (New's available default) is refused as takesDefault, naming New (pinned, F4)", () => {
    const r = findSettingsConflicts("macos", 1, { fileSave: "Cmd+N" });
    expect(keysOf(r)).toEqual(["fileSave"]);
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "takesDefault", with: ["file.new"], names: ["New"] });
  });

  it("u8 Save = ⌘K is refused as hard, naming Hyperlink (Milkdown Mod-k implements it)", () => {
    const r = findSettingsConflicts("macos", 1, { fileSave: "Cmd+K" });
    expect(keysOf(r)).toEqual(["fileSave"]);
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "hard", with: ["format.hyperlink"], names: ["Hyperlink"] });
  });

  it("u9 Save = ⇧⌘S, the default of unavailable Save As, is allowed (Decision 5)", () => {
    expect(resolveBindings("macos", 1, {}).fileSaveAs).toMatchObject({ kind: "suppressed", reason: "unavailable" });
    const r = findSettingsConflicts("macos", 1, { fileSave: "Cmd+Shift+S" });
    expect(r.refusing.size).toBe(0);
  });

  it("u10 an unparseable value and <unassigned> refuse nothing", () => {
    for (const v of ["Cmd++", "<unassigned>"]) {
      const r = findSettingsConflicts("macos", 1, { fileSave: v });
      expect(r.refusing.size, v).toBe(0);
    }
  });

  it("u11 swapping New and Save is allowed", () => {
    const r = findSettingsConflicts("macos", 1, { fileNew: "Cmd+S", fileSave: "Cmd+N" });
    expect(r.refusing.size).toBe(0);
  });

  it("u12 the same custom on a W-only and an S-only row is allowed (no shared context)", () => {
    const r = findSettingsConflicts("macos", 1, { formatStrong: "Cmd+J", paragraphIncreaseHeading: "Cmd+J" });
    expect(r.refusing.size).toBe(0);
  });

  it("u13 v2: Save = ⇧⌘T takes Table's v2 default and is refused as takesDefault", () => {
    const r = findSettingsConflicts("macos", 2, { ...v2Defaults("macos"), fileSave: "Cmd+Shift+T" }, { paragraphTable: "Table" });
    expect(keysOf(r)).toEqual(["fileSave"]);
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "takesDefault", with: ["paragraph.table"], names: ["Table"] });
  });

  it("u14 the same local read as v1: Save and Table are a custom duplicate (the version matters)", () => {
    const r = findSettingsConflicts("macos", 1, { ...v2Defaults("macos"), fileSave: "Cmd+Shift+T" });
    // Matrix u14 lists only fileSave / paragraphTable. On this data the v2
    // values read as v1 customs also put Increase / Decrease Heading on
    // CodeMirror's fold keys and Highlight on the lint panel key; all are
    // refused (Highlight was a notice until M7 showed it). Pinned as the
    // data has it.
    expect(keysOf(r)).toEqual(["fileSave", "formatHighlight", "paragraphDecreaseHeading", "paragraphIncreaseHeading", "paragraphTable"]);
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "duplicate", with: ["paragraph.table"] });
    expect(r.refusing.get("paragraphTable")).toMatchObject({ kind: "duplicate", with: ["file.save"] });
    expect(r.refusing.get("paragraphIncreaseHeading")?.kind).toBe("hard");
    expect(r.refusing.get("formatHighlight")?.kind).toBe("hard");
  });

  it("u15 Windows: Save = Ctrl+N normalises to New's default and is refused as takesDefault", () => {
    const r = findSettingsConflicts("windows", 1, { fileSave: "Ctrl+N" });
    expect(keysOf(r)).toEqual(["fileSave"]);
    expect(r.refusing.get("fileSave")).toMatchObject({ kind: "takesDefault", with: ["file.new"], names: ["New"] });
  });

  it("u17 hidden vs visible duplicate is refused on both sides, naming Save and Highlight", () => {
    const r = findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+J", fileSave: "Cmd+J" });
    expect(keysOf(r)).toEqual(["fileSave", "formatHighlight"]);
    expect(r.refusing.get("fileSave")?.names.join()).toMatch(/Highlight/);
    expect(r.refusing.get("formatHighlight")?.names).toEqual(["Save"]);
  });

  it("u18 (M7) a duplicate between two formerly hidden fields is refused on both sides", () => {
    const r = findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+J", fileExportHtml: "Cmd+J" });
    expect(keysOf(r)).toEqual(["fileExportHtml", "formatHighlight"]);
    expect(r.refusing.get("formatHighlight")).toMatchObject({ kind: "duplicate", names: ["Export HTML"], value: "Cmd+J" });
    // No panel labels passed here, so Highlight is named by its menu item.
    expect(r.refusing.get("fileExportHtml")).toMatchObject({ kind: "duplicate", names: ["Highlight Selection"] });
  });

  it("u19 (M7) Highlight on a hard owner's key is refused, naming Undo", () => {
    const r = findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+Z" });
    expect(keysOf(r)).toEqual(["formatHighlight"]);
    expect(r.refusing.get("formatHighlight")).toMatchObject({ kind: "hard", names: ["Undo"] });
  });

  it("u20 (M7) Highlight taking Export HTML's default is refused as takesDefault", () => {
    const r = findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+Shift+E" });
    expect(keysOf(r)).toEqual(["formatHighlight"]);
    expect(r.refusing.get("formatHighlight")).toMatchObject({ kind: "takesDefault", with: ["file.exportHtml"] });
  });

  it("a hidden custom taking a shown default is refused (hidden vs visible through a yield)", () => {
    const r = findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+N" });
    expect(keysOf(r)).toEqual(["formatHighlight"]);
    expect(r.refusing.get("formatHighlight")).toMatchObject({ kind: "takesDefault", with: ["file.new"] });
  });

  it("the panel's labels name shown fields; table labels name the rest", () => {
    const r = findSettingsConflicts("macos", 1, { fileSave: "Cmd+N" }, { fileNew: "New File" });
    expect(r.refusing.get("fileSave")?.names).toEqual(["New File"]);
  });

  it("is deterministic: the same input gives deep-equal results", () => {
    const local = { fileNew: "Cmd+J", fileSave: "Cmd+J", formatHighlight: "Cmd+Z" };
    const a = findSettingsConflicts("macos", 1, local);
    const b = findSettingsConflicts("macos", 1, { ...local });
    expect([...a.refusing.entries()]).toEqual([...b.refusing.entries()]);
  });
});

describe("M1A-WI-10 banner lines (SD13)", () => {
  it("hard: '{A} conflicts with {B}, not active'", () => {
    const lines = settingsConflictLines(findSettingsConflicts("macos", 1, { fileSave: "Cmd+Z" }), "macos");
    expect(lines).toEqual({ alerts: ["Save conflicts with Undo, not active"] });
  });

  it("duplicate: one line per chord, '{chord}: {A} conflicts with {B}'", () => {
    const lines = settingsConflictLines(findSettingsConflicts("macos", 1, { fileNew: "Cmd+J", fileSave: "Cmd+J" }), "macos");
    expect(lines.alerts).toEqual(["Cmd+J: New conflicts with Save"]);
  });

  it("takesDefault: '{chord}: {A} would take {B}'s key', with the platform's chord label", () => {
    const mac = settingsConflictLines(findSettingsConflicts("macos", 1, { fileSave: "Cmd+N" }), "macos");
    expect(mac.alerts).toEqual(["Cmd+N: Save would take New's key"]);
    const win = settingsConflictLines(findSettingsConflicts("windows", 1, { fileSave: "Cmd+N" }), "windows");
    expect(win.alerts).toEqual(["Ctrl+N: Save would take New's key"]);
  });

  it("(M7) two formerly hidden fields on one chord give one duplicate alert and no 'not shown' line", () => {
    const lines = settingsConflictLines(findSettingsConflicts("macos", 1, { formatHighlight: "Cmd+J", fileExportHtml: "Cmd+J" }), "macos");
    expect(lines).toEqual({ alerts: ["Cmd+J: Export HTML conflicts with Highlight Selection"] });
  });
});

// ---- The relation (S4): refusing ⇔ a custom-involving conflict with a shown side ----

const fieldOfId = new Map(COMMAND_TABLE.flatMap((r) => (r.prefField === undefined ? [] : [[r.id, String(r.prefField)] as const])));

interface Expected {
  refusing: string[];
  via: Set<string>;
}

/** The oracle: read off `resolveBindings` alone. */
function expected(p: Platform, v: number, local: Record<string, string>): Expected {
  const res: Record<string, Resolution> = resolveBindings(p, v, local);
  const refusing = new Set<string>();
  const via = new Set<string>();
  for (const [field, r] of Object.entries(res)) {
    if (r.kind !== "suppressed") continue;
    const flag = r.flagged && r.reason !== "unparseable";
    const yieldTo = r.reason === "yieldedToCustom";
    if (!flag && !yieldTo) continue;
    const others = r.conflictsWith.flatMap((id) => (fieldOfId.has(id) ? [fieldOfId.get(id) as string] : []));
    const sides = [field, ...others];
    via.add(flag ? "refused-flag" : "refused-yield");
    if (sides.some((f) => HIDDEN.includes(f))) via.add("refused-formerly-hidden");
    if (sides.every((f) => HIDDEN.includes(f))) via.add("refused-formerly-hidden-only");
    if (flag) refusing.add(field);
    else for (const f of others) refusing.add(f);
  }
  return { refusing: [...refusing].sort(), via };
}

describe("M1A-WI-10 law: refused iff a conflict involves a custom value (S4; M7: every side is shown)", () => {
  const SWEEP_POOL = [...POOL, "Cmd+Shift+E"];

  it("holds over 58 fields × 20 values × 3 platforms × v1/v2, plus every hidden pair on Cmd+J", () => {
    expect(SWEEP_POOL).toHaveLength(20);
    const partitions = new Map<string, number>();
    const bump = (k: string) => partitions.set(k, (partitions.get(k) ?? 0) + 1);
    let n = 0;
    const check = (p: Platform, v: number, local: Record<string, string>) => {
      n += 1;
      const want = expected(p, v, local);
      const got = findSettingsConflicts(p, v, local);
      const label = `${p}@${v} ${JSON.stringify(local)}`;
      expect(keysOf(got), label).toEqual(want.refusing);
      for (const k of want.via) bump(k);
      if (want.refusing.length === 0) bump("empty");
    };
    for (const p of PLATFORMS)
      for (const v of [1, 2]) {
        const base = v === 2 ? v2Defaults(p) : {};
        for (const field of FIELDS) for (const value of SWEEP_POOL) check(p, v, { ...base, [field]: value });
        for (let i = 0; i < HIDDEN.length; i += 1)
          for (let j = i + 1; j < HIDDEN.length; j += 1)
            check(p, v, { ...base, [HIDDEN[i] as string]: "Cmd+J", [HIDDEN[j] as string]: "Cmd+J" });
      }
    expect(n).toBe(6960 + 216);
    for (const k of ["refused-flag", "refused-yield", "refused-formerly-hidden", "refused-formerly-hidden-only", "empty"])
      expect(partitions.get(k) ?? 0, k).toBeGreaterThan(0);
  });

  it("free chords used by the component tests are unowned in all 7 contexts (macOS v1 / v2, Windows v1)", () => {
    for (const c of ["Cmd+J", "Cmd+Shift+J", "Cmd+Option+J"])
      for (const ctx of CONTEXTS) {
        expect(ownerOf("macos", 1, {}, ctx, c), `${c} ${ctx}`).toBeNull();
        expect(ownerOf("macos", 2, v2Defaults("macos"), ctx, c), `${c} ${ctx} v2`).toBeNull();
      }
    for (const ctx of CONTEXTS) expect(ownerOf("windows", 1, {}, ctx, "Cmd+J"), ctx).toBeNull();
  });
});
