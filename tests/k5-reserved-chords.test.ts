// @vitest-environment node
/**
 * M1A-WI-6 — K5: no editor-command default takes a reserved chord.
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-6, "reservedChords.ts and K5".
 */
import { describe, expect, it } from "vitest";
import { normaliseStored } from "../src/commands/chord";
import type { Platform } from "../src/commands/commandTable.types";
import { K3_EXCEPTIONS, RESERVED_CHORDS } from "../src/commands/reservedChords";
import { PLATFORMS, tableBindings, type Version } from "./support/tableBindings";

interface K5Result {
  violations: string[];
  skippedNative: string[];
  checked: number;
}

function k5(version: Version, p: Platform): K5Result {
  const reserved = new Set(RESERVED_CHORDS[p].map((s) => normaliseStored(s, p)));
  const out: K5Result = { violations: [], skippedNative: [], checked: 0 };
  for (const b of tableBindings(version, p)) {
    if (b.row.route[p] === "native") continue;
    out.checked++;
    if (reserved.has(b.chord) && !K3_EXCEPTIONS.includes(b.row.id)) {
      out.violations.push(`${b.row.prefField ?? b.row.id} ${b.chord}`);
    }
  }
  out.skippedNative = [
    ...new Set(tableBindings(version, p).filter((b) => b.row.route[p] === "native").map((b) => b.row.id)),
  ].sort();
  return out;
}

const NATIVE_MAC = [
  "app.hideOthers", "app.quit", "edit.copy", "edit.cut", "edit.paste", "edit.redo",
  "edit.selectAll", "edit.undo", "view.enterFullScreen", "window.minimize",
];
const NATIVE_OFF = [
  "edit.copy", "edit.cut", "edit.paste", "edit.redo", "edit.selectAll", "edit.undo",
  "window.closeWindow", "window.minimize",
];

describe("K5: the reserved list", () => {
  it("is K5's text, per platform, and every entry parses", () => {
    expect(RESERVED_CHORDS.macos).toEqual([
      "Cmd+Option+H", "Cmd+M", "Cmd+Q", "Cmd+Option+Q", "Cmd+Ctrl+F", "Cmd+`",
      "Cmd+Tab", "Cmd+Space", "Cmd+Shift+Q", "Cmd+Shift+3", "Cmd+Shift+4", "Cmd+Shift+5",
    ]);
    expect(RESERVED_CHORDS.windows).toEqual(["Option+F4"]);
    expect(RESERVED_CHORDS.linux).toEqual(["Option+F4"]);
    for (const p of PLATFORMS) for (const s of RESERVED_CHORDS[p]) expect(normaliseStored(s, p)).not.toBeNull();
  });

  it("the K3 exception list is empty", () => {
    expect(K3_EXCEPTIONS).toEqual([]);
  });
});

describe("K5 on v2", () => {
  it.each(PLATFORMS)("%s: no v2 default or fixed second key is reserved", (p) => {
    const r = k5("v2", p);
    expect(r.violations).toEqual([]);
    expect(r.checked).toBeGreaterThanOrEqual(55);
    expect(r.skippedNative).toEqual(p === "macos" ? NATIVE_MAC : NATIVE_OFF);
  });

  it("detects a reserved default (the reserved list is not vacuous)", () => {
    expect(RESERVED_CHORDS.macos.length).toBeGreaterThan(0);
    expect(k5("v1", "macos").violations.length).toBeGreaterThan(0);
  });
});

describe("K5 on v1: fails at exactly the known defects", () => {
  it("macOS: Quote ⌥⌘Q (C1) and Switch Documents ⌘` (C4)", () => {
    expect(k5("v1", "macos").violations.sort()).toEqual([
      "paragraphQuote Cmd+Option+Q",
      "viewSwitchDocuments Cmd+`",
    ]);
  });

  it.each(["windows", "linux"] as const)("%s: none", (p) => {
    expect(k5("v1", p).violations).toEqual([]);
  });
});
