// @vitest-environment node
/**
 * M1A-WI-5 — chord parsing and per-platform normalisation
 * (`src/commands/chord.ts`). Matrix: `.claude/tdd-guardian/tests-20261016-223726.md`
 * § M1A-WI-5 and R1-13. The Rust twin (`src-tauri/src/models/chord_tests.rs`)
 * runs the same `parse` rows of `tests/fixtures/binding-owner-cases.json`.
 *
 * Laws: normalise is idempotent; parse(format(parse(s))) == parse(s);
 * validity is platform-independent; off-Mac adding Ctrl to a Cmd chord changes
 * nothing, on macOS it always does; total over junk input.
 *
 * Mocked: nothing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Platform } from "../src/commands/commandTable.types";
import {
  formatChord,
  normaliseChord,
  normaliseStored,
  parseChord,
} from "../src/commands/chord";

const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const OFF_MAC: readonly Platform[] = ["windows", "linux"];

const RAW: unknown = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/binding-owner-cases.json"), "utf8"),
);

interface ParseRow {
  platform: Platform;
  input: string;
  normalised: string | null;
}

/** R1-13a: a strict loader, so an extra or misspelt key fails instead of being skipped. */
function loadParseRows(raw: unknown): ParseRow[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("top level");
  const top = raw as Record<string, unknown>;
  const allowedTop = ["$comment", "parse", "cases", "sweep"];
  const extraTop = Object.keys(top).filter((k) => !allowedTop.includes(k));
  if (extraTop.length > 0) throw new Error(`unknown top-level keys: ${extraTop.join(",")}`);
  if (!Array.isArray(top.parse)) throw new Error("parse is not an array");
  return top.parse.map((row: unknown, i: number) => {
    if (typeof row !== "object" || row === null) throw new Error(`row ${i}`);
    const keys = Object.keys(row).sort().join(",");
    if (keys !== "input,normalised,platform") throw new Error(`row ${i} keys: ${keys}`);
    const r = row as Record<string, unknown>;
    if (!PLATFORMS.includes(r.platform as Platform)) throw new Error(`row ${i} platform`);
    if (typeof r.input !== "string") throw new Error(`row ${i} input`);
    if (r.normalised !== null && typeof r.normalised !== "string") throw new Error(`row ${i}`);
    return r as unknown as ParseRow;
  });
}

const MODS = ["Cmd", "Ctrl", "Option", "Shift"] as const;
const VALID_KEYS = [
  "A", "a", "Z", "z", "m", "0", "5", "9",
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "Up", "ArrowUp", "Down", "ArrowDown", "Left", "ArrowLeft", "Right", "ArrowRight",
  "Space", "Backspace", "Delete", "Enter", "Tab", "Escape", "Home", "End", "PageUp", "PageDown",
  "F1", "F6", "F11", "F12",
];
const F_KEYS = ["F1", "F6", "F11", "F12"];
const INVALID_KEYS = ["F13", "Esc", "é"];
const KEY_POOL = [...VALID_KEYS, ...INVALID_KEYS];

interface DomainEntry {
  s: string;
  mask: number;
  key: string;
}

/** Every modifier subset, in canonical and in reversed order, × the key pool. */
function domain(): DomainEntry[] {
  const out: DomainEntry[] = [];
  for (let mask = 0; mask < 16; mask++) {
    const mods = MODS.filter((_, i) => (mask >> i) & 1);
    for (const order of [mods, [...mods].reverse()]) {
      for (const key of KEY_POOL) out.push({ s: [...order, key].join("+"), mask, key });
    }
  }
  return out;
}

const CMD = 1;
const CTRL = 2;

describe("chord: the shared fixture's parse rows", () => {
  const rows = loadParseRows(RAW);

  it("has 41 valid and 54 null rows, and every platform", () => {
    expect(PLATFORMS.length).toBe(3);
    expect(rows.filter((r) => r.normalised !== null)).toHaveLength(41);
    expect(rows.filter((r) => r.normalised === null)).toHaveLength(54);
    expect(new Set(rows.map((r) => r.platform))).toEqual(new Set(PLATFORMS));
  });

  it("the strict loader rejects an extra key and a misspelt key", () => {
    const top = RAW as { parse: Record<string, unknown>[] };
    const extra = { ...top, parse: [{ ...top.parse[0], extra: 1 }] };
    const misspelt = { ...top, parse: [{ platform: "macos", input: "F5", normalsed: "F5" }] };
    expect(() => loadParseRows(extra)).toThrow();
    expect(() => loadParseRows(misspelt)).toThrow();
    expect(() => loadParseRows({ ...top, cses: [] })).toThrow();
  });

  it("every row normalises to its expected value, and every row runs", () => {
    const mismatches: string[] = [];
    let executed = 0;
    for (const row of rows) {
      const got = normaliseStored(row.input, row.platform);
      executed++;
      if (got !== row.normalised) {
        mismatches.push(`${row.platform} ${JSON.stringify(row.input)}: ${got} != ${row.normalised}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(executed).toBe((RAW as { parse: unknown[] }).parse.length);
  });
});

describe("chord: C6 equalities", () => {
  it("off-Mac Cmd+Ctrl+I, Cmd+I and Ctrl+I are one chord", () => {
    for (const p of OFF_MAC) {
      expect(["Cmd+Ctrl+I", "Cmd+I", "Ctrl+I"].map((s) => normaliseStored(s, p))).toEqual([
        "Cmd+I",
        "Cmd+I",
        "Cmd+I",
      ]);
      expect(parseChord("Cmd+Ctrl+I", p)).toEqual(parseChord("Ctrl+I", p));
    }
  });

  it("on macOS they stay three distinct chords", () => {
    const got = ["Cmd+Ctrl+I", "Cmd+I", "Ctrl+I"].map((s) => normaliseStored(s, "macos"));
    expect(got).toEqual(["Cmd+Ctrl+I", "Cmd+I", "Ctrl+I"]);
  });
});

describe("chord: laws over the enumerated domain", () => {
  const entries = domain();

  it("the domain has 4 224 strings over 3 platforms, 3 714 of them valid", () => {
    expect(KEY_POOL).toHaveLength(44);
    expect(entries.length * PLATFORMS.length).toBe(4224);
    let valid = 0;
    for (const p of PLATFORMS) for (const e of entries) if (parseChord(e.s, p) !== null) valid++;
    expect(valid).toBe(3714);
  });

  it("a bare key is valid only for F1–F12; the invalid keys are null with every subset", () => {
    const wrong: string[] = [];
    for (const p of PLATFORMS) {
      for (const e of entries) {
        const shouldBeValid = !INVALID_KEYS.includes(e.key) && (e.mask !== 0 || F_KEYS.includes(e.key));
        if ((parseChord(e.s, p) !== null) !== shouldBeValid) wrong.push(`${p} ${e.s}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("validity does not depend on the platform", () => {
    const inputs = [...entries.map((e) => e.s), ...loadParseRows(RAW).map((r) => r.input)];
    const disagree = inputs.filter((s) => {
      const nulls = PLATFORMS.map((p) => parseChord(s, p) === null);
      return nulls.some((n) => n !== nulls[0]);
    });
    expect(inputs.length).toBeGreaterThan(1408);
    expect(disagree).toEqual([]);
  });

  it("normalise is idempotent and parse(format(parse(s))) == parse(s)", () => {
    const broken: string[] = [];
    let checked = 0;
    for (const e of entries) {
      const raw = parseChord(e.s, "macos");
      if (raw === null) continue;
      for (const p of PLATFORMS) {
        checked++;
        const once = normaliseChord(raw, p);
        const parsed = parseChord(e.s, p);
        if (JSON.stringify(normaliseChord(once, p)) !== JSON.stringify(once)) broken.push(`idem ${p} ${e.s}`);
        if (JSON.stringify(parsed) !== JSON.stringify(once)) broken.push(`parse ${p} ${e.s}`);
        if (parsed === null) continue;
        const back = parseChord(formatChord(parsed), p);
        if (JSON.stringify(back) !== JSON.stringify(parsed)) broken.push(`round ${p} ${e.s}`);
        if (normaliseStored(e.s, p) !== formatChord(parsed)) broken.push(`stored ${p} ${e.s}`);
      }
    }
    expect(checked).toBe(3714);
    expect(broken).toEqual([]);
  });

  it("normaliseChord canonicalises a hand-built chord's key and modifiers", () => {
    const built = { cmd: true, ctrl: true, option: false, shift: false, key: "ArrowUp" };
    expect(formatChord(normaliseChord(built, "macos"))).toBe("Cmd+Ctrl+Up");
    expect(formatChord(normaliseChord(built, "windows"))).toBe("Cmd+Up");
    expect(formatChord(normaliseChord({ ...built, ctrl: false, key: "q" }, "linux"))).toBe("Cmd+Q");
  });
});

describe("chord: adding Ctrl to a Cmd chord (metamorphic)", () => {
  it("off-Mac changes nothing; on macOS always changes it", () => {
    const broken: string[] = [];
    let pairs = 0;
    for (const e of domain()) {
      if (!(e.mask & CMD) || e.mask & CTRL) continue;
      const base = normaliseStored(e.s, "macos");
      if (base === null) continue;
      const withCtrl = `Ctrl+${e.s}`;
      const swapped = e.s.replace("Cmd", "Ctrl");
      for (const p of PLATFORMS) {
        pairs++;
        const before = normaliseStored(e.s, p);
        const after = normaliseStored(withCtrl, p);
        if (p === "macos") {
          if (after === null || after === before) broken.push(`same ${p} ${e.s}`);
          if (after === normaliseStored(swapped, p)) broken.push(`swap ${p} ${e.s}`);
        } else if (after !== before) {
          broken.push(`differs ${p} ${e.s}`);
        }
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(500);
    expect(broken).toEqual([]);
  });
});

describe("chord: total over junk input", () => {
  it("never throws, and any result is its own normal form", () => {
    const alphabet = ["C", "m", "d", "+", "S", "0", " ", "<", ">", "é"];
    let level = [""];
    const junk = [""];
    for (let len = 1; len <= 3; len++) {
      level = level.flatMap((s) => alphabet.map((c) => s + c));
      junk.push(...level);
    }
    expect(junk).toHaveLength(1111);
    junk.push("+".repeat(10_000), `${"Cmd+".repeat(1_000)}S`, "Cmd+😀", "\0", "Cmd+\0");
    const broken: string[] = [];
    for (const s of junk) {
      for (const p of PLATFORMS) {
        try {
          parseChord(s, p);
          const n = normaliseStored(s, p);
          if (n !== null && normaliseStored(n, p) !== n) broken.push(`closure ${p} ${s}`);
        } catch {
          broken.push(`threw ${p} ${JSON.stringify(s.slice(0, 20))}`);
        }
      }
    }
    expect(broken).toEqual([]);
    expect(normaliseStored("Cmd+😀", "macos")).toBeNull();
    expect(normaliseStored("+".repeat(10_000), "linux")).toBeNull();
  });
});
