// @vitest-environment node
/**
 * Audit b186 F1(b): the conflict filter flags a K8 physical overlap. A =
 * mods+Shift+k1 (k1 one of the 21 K8 keys) and B = the same mods+k2, k2 ≠
 * k1, in intersecting contexts, where Shift+k1 types k2 on the US or German
 * layout: the hook gives that keypress to B, so A resolves
 * suppressed{physicalOverlap, [B], flagged} and B stays bound, when at least
 * one of them is custom. Settings refuses the pair and names both commands.
 * Stated limit: layouts outside the US/German table (French) are not flagged.
 *
 * Mock boundary: none (pure functions over the production tables).
 */
import { describe, expect, it } from "vitest";
import { resolveBindings } from "../src/commands/bindingConflicts";
import type { Resolution } from "../src/commands/bindingConflicts.types";
import type { Platform } from "../src/commands/commandTable.types";
import { SHIFTED_ON_LAYOUTS } from "../src/commands/physicalOverlap";
import { findSettingsConflicts, settingsConflictLines } from "../src/commands/settingsConflicts";

const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const VERSIONS = [1, 2] as const;

const overlap = (...ids: string[]): Resolution => ({
  kind: "suppressed",
  reason: "physicalOverlap",
  conflictsWith: ids,
  flagged: true,
});
const bound = (chord: string): Resolution => ({ kind: "bound", chord });
/** Who owns Cmd+Shift+` (German Shift+= types `): Code, and off-Mac at v1
 *  also Strikethrough, whose Ctrl+Shift+` collapses to the same chord. */
const backquote = (p: Platform, v: number): string[] =>
  v < 2 && p !== "macos" ? ["format.code", "format.strike"] : ["format.code"];

describe("F1 the US/German layout table", () => {
  it("has the 21 K8 keys with the shifted characters the K8 tests use", () => {
    expect(Object.fromEntries(SHIFTED_ON_LAYOUTS)).toEqual({
      "0": [")", "="], "1": ["!", "!"], "2": ["@", '"'], "3": ["#", "§"], "4": ["$", "$"],
      "5": ["%", "%"], "6": ["^", "&"], "7": ["&", "/"], "8": ["*", "("], "9": ["(", ")"],
      "`": ["~", "°"], "-": ["_", "?"], "=": ["+", "`"], "[": ["{", "Ü"], "]": ["}", "*"],
      "\\": ["|", "'"], ";": [":", "Ö"], "'": ['"', "Ä"], ",": ["<", ";"], ".": [">", ":"],
      "/": ["?", "_"],
    });
    expect(SHIFTED_ON_LAYOUTS.size).toBe(21);
  });
});

describe("F1 resolver flags the overlap (both versions, every platform)", () => {
  it("a Codex: custom New Cmd+Shift+0 vs custom Save Cmd+Shift+= → New suppressed, Save bound", () => {
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const r = resolveBindings(p, v, { fileNew: "Cmd+Shift+0", fileSave: "Cmd+Shift+=" });
        expect({ p, v, fileNew: r.fileNew, fileSave: r.fileSave }).toEqual({
          p, v, fileNew: overlap("file.save"), fileSave: overlap(...backquote(p, v)),
        });
      }
    }
  });

  it("b German: custom Open Cmd+Shift+/ vs custom Save Cmd+Shift+_ → Open suppressed, Save bound", () => {
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const r = resolveBindings(p, v, { fileOpen: "Cmd+Shift+/", fileSave: "Cmd+Shift+_" });
        expect({ p, v, fileOpen: r.fileOpen, fileSave: r.fileSave }).toEqual({
          p, v, fileOpen: overlap("file.save"), fileSave: bound("Cmd+Shift+_"),
        });
      }
    }
  });

  it("the flag follows the chords, not the fields: swapping the fields swaps the sides", () => {
    for (const p of PLATFORMS) {
      const r = resolveBindings(p, 1, { fileSave: "Cmd+Shift+0", fileNew: "Cmd+Shift+=" });
      expect({ p, fileSave: r.fileSave, fileNew: r.fileNew }).toEqual({
        p, fileSave: overlap("file.new"), fileNew: overlap(...backquote(p, 1)),
      });
    }
  });

  it("a v2 default A yields to a custom B: Paragraph Cmd+Shift+0 vs custom Save Cmd+Shift+=", () => {
    for (const p of PLATFORMS) {
      const r = resolveBindings(p, 2, { fileSave: "Cmd+Shift+=" });
      expect({ p, para: r.paragraphParagraph, save: r.fileSave }).toEqual({
        p, para: overlap("file.save"), save: overlap("format.code"),
      });
    }
  });
});

describe("F1 resolver leaves non-overlaps alone", () => {
  it("c French Shift+Period types / but is outside the table: NOT flagged (stated limit)", () => {
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const r = resolveBindings(p, v, { fileNew: "Cmd+Shift+.", fileClose: "Cmd+Shift+/" });
        expect({ p, v, n: r.fileNew, c: r.fileClose }).toEqual({
          p, v, n: bound("Cmd+Shift+."), c: bound("Cmd+Shift+/"),
        });
      }
    }
  });

  it("k2 that no table layout produces from k1 (Shift+0 never types 9): no flag", () => {
    for (const p of PLATFORMS) {
      const r = resolveBindings(p, 1, { fileNew: "Cmd+Shift+0", fileSave: "Cmd+Shift+9" });
      expect([r.fileNew, r.fileSave]).toEqual([bound("Cmd+Shift+0"), bound("Cmd+Shift+9")]);
    }
  });

  it("different modifier sets never overlap: B without Shift, B with Option", () => {
    for (const p of PLATFORMS) {
      const noShift = resolveBindings(p, 1, { fileNew: "Cmd+Option+Shift+0", fileSave: "Cmd+Option+=" });
      expect([noShift.fileNew, noShift.fileSave]).toEqual([bound("Cmd+Option+Shift+0"), bound("Cmd+Option+=")]);
      const option = resolveBindings(p, 1, { fileNew: "Cmd+Shift+0", fileSave: "Cmd+Option+Shift+=" });
      expect([option.fileNew, option.fileSave]).toEqual([bound("Cmd+Shift+0"), bound("Cmd+Option+Shift+=")]);
    }
  });

  it("defaults alone never resolve physicalOverlap (the data has no default-vs-default pair)", () => {
    for (const p of PLATFORMS) {
      for (const v of VERSIONS) {
        const hits = Object.entries(resolveBindings(p, v, {})).filter(
          ([, r]) => r.kind === "suppressed" && r.reason === "physicalOverlap",
        );
        expect({ p, v, hits }).toEqual({ p, v, hits: [] });
      }
    }
  });
});

describe("F1 every table pair is flagged when both sides bind alone (S4)", () => {
  it("for each k1 and each parseable k2 ≠ k1 it types: A suppressed for B, B bound", () => {
    const failures: string[] = [];
    let pairs = 0;
    for (const p of PLATFORMS) {
      for (const [k1, shifted] of SHIFTED_ON_LAYOUTS) {
        for (const k2 of new Set(shifted)) {
          if (k2 === k1 || k2.charCodeAt(0) > 0x7e || k2 === "+") continue;
          const a = `Cmd+Option+Shift+${k1}`;
          const b = `Cmd+Option+Shift+${k2}`;
          const aloneA = resolveBindings(p, 1, { fileNew: a }).fileNew;
          const aloneB = resolveBindings(p, 1, { fileSave: b }).fileSave;
          if (aloneA?.kind !== "bound" || aloneB?.kind !== "bound") continue;
          const r = resolveBindings(p, 1, { fileNew: a, fileSave: b });
          if (JSON.stringify([r.fileNew, r.fileSave]) !== JSON.stringify([overlap("file.save"), aloneB])) {
            failures.push(`${p} ${a} ${b} ${JSON.stringify(r.fileNew)}`);
          }
          pairs++;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(pairs).toBeGreaterThanOrEqual(90);
  });
});

describe("F1 Settings refuses the overlap and names both commands", () => {
  it("Codex's pair is refused on every platform, with a banner naming New and Save", () => {
    for (const p of PLATFORMS) {
      const found = findSettingsConflicts(p, 1, { fileNew: "Cmd+Shift+0", fileSave: "Cmd+Shift+=" });
      expect({ p, keys: [...found.refusing.keys()] }).toEqual({ p, keys: ["fileNew", "fileSave"] });
      expect(found.refusing.get("fileNew")).toMatchObject({ kind: "physicalOverlap", with: ["file.save"], names: ["Save"] });
      const { alerts } = settingsConflictLines(found, p);
      expect(alerts).toHaveLength(2);
      expect(alerts[0]).toMatch(/New/);
      expect(alerts[0]).toMatch(/Save/);
      expect(alerts[0]).toMatch(/keyboard layout/);
    }
  });

  it("the French pair outside the table is not refused (stated limit)", () => {
    for (const p of PLATFORMS) {
      const found = findSettingsConflicts(p, 1, { fileNew: "Cmd+Shift+.", fileClose: "Cmd+Shift+/" });
      expect({ p, n: found.refusing.size, notices: found.notices }).toEqual({ p, n: 0, notices: [] });
    }
  });
});
