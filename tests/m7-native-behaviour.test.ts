// @vitest-environment node
/**
 * M7 audit round 1 (PR #504, two Mediums), on the real command table:
 * (a) D19 (U11, 2026-10-17: 「A · Keep, say so in Settings (Recommended)」):
 *     the v1 off-Mac Find row says "WYSIWYG: browser find bar". D255-WI-3c
 *     makes v2 available in both editor modes, so that note no longer applies.
 * (b) rowStateOf's key-kind branch is exhaustive (rule 60): an unknown kind
 *     throws rather than falling through.
 */
import { describe, expect, it } from "vitest";
import { rowById } from "../src/commands/commandTable";
import type { CommandRow, Platform } from "../src/commands/commandTable.types";
import { rowStateOf } from "../src/components/common/settings/shortcuts/rowState";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

const find = () => rowById("edit.find") as CommandRow;

const state = (row: CommandRow, platform: Platform, version = 1) =>
  rowStateOf({
    row,
    platform,
    version,
    local: { ...DEFAULT_KEYBOARD_SHORTCUTS },
    saved: { ...DEFAULT_KEYBOARD_SHORTCUTS },
    applied: null,
    conflicts: new Set(),
  });

describe("M7 (a) Find's native behaviour comes from the real table row", () => {
  it("n1 the edit.find row carries D19's text", () => {
    expect(find().nativeBehaviour).toBe("WYSIWYG: browser find bar");
  });

  it("n2 Windows and Linux show the legacy browser note only at v1", () => {
    for (const p of ["windows", "linux"] as const)
      for (const v of [1, 2])
        expect({ p, v, s: state(find(), p, v) }).toMatchObject({ p, v, s: { kind: "configurable", capability: v === 1 ? "WYSIWYG: browser find bar" : null } });
  });

  it("n3 macOS has no browser find bar, so its Find row stays Source only", () => {
    expect(state(find(), "macos")).toMatchObject({ kind: "configurable", capability: "Source only" });
    expect(state(find(), "macos", 2)).toMatchObject({ kind: "configurable", capability: null });
  });

  it("n4 no other row gains a native-behaviour line", () => {
    const others = ["edit.findNext", "edit.findPrevious", "edit.pasteAsPlainText", "edit.replace"];
    for (const id of others) expect({ id, text: rowById(id)?.nativeBehaviour }).toEqual({ id, text: undefined });
  });
});

describe("M7 (b) the key-kind branch is exhaustive", () => {
  it("k1 an unknown key kind throws", () => {
    const row = find();
    const bogus = { ...row, key: { ...row.key, macos: { ...row.key.macos, kind: "bogus" } } } as unknown as CommandRow;
    expect(() => state(bogus, "macos")).toThrow();
  });
});
