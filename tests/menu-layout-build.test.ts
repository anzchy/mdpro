// @vitest-environment node
/**
 * M1A-WI-7 — `buildMenuLayout` is order-independent and drops nothing.
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-7
 * ("input permutation leaves the bytes unchanged") and R1-7b.
 *
 * R1-7b builds each mutated unit on its own (one row, one reserved list, or
 * one inventory row) rather than the whole table: a full build per leaf is
 * about 1.5 ms × several thousand leaves, past the 2 s unit-lane budget.
 * R1-7a (tests/menu-layout-freshness.test.ts) is the whole-file check.
 */
import { describe, expect, it } from "vitest";
import { buildMenuLayout, serializeMenuLayout } from "../src/commands/buildMenuLayout";
import { COMMAND_TABLE } from "../src/commands/commandTable";
import type { CommandRow, PerPlatform, Platform } from "../src/commands/commandTable.types";
import { EDITOR_OWNED_CHORDS, SOURCE_FORMAT_BINDINGS, type EditorOwnedRow } from "../src/commands/editorOwnedChords";
import { CODEMIRROR_ROWS } from "../src/commands/inventory/codemirrorRows";
import { MILKDOWN_ROWS } from "../src/commands/inventory/milkdownRows";
import { RESERVED_CHORDS } from "../src/commands/reservedChords";
import { APP_ROWS } from "../src/commands/rows/appRows";
import { EDIT_ROWS } from "../src/commands/rows/editRows";
import { FILE_ROWS } from "../src/commands/rows/fileRows";
import { FORMAT_ROWS } from "../src/commands/rows/formatRows";
import { PARAGRAPH_ROWS } from "../src/commands/rows/paragraphRows";
import { TABLE_ROWS } from "../src/commands/rows/tableRows";
import { VIEW_ROWS } from "../src/commands/rows/viewRows";

type Reserved = PerPlatform<readonly string[]>;
const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const NO_RESERVED: Reserved = { macos: [], windows: [], linux: [] };

const bytes = (table: readonly CommandRow[], reserved: Reserved, inv: readonly EditorOwnedRow[]): string =>
  serializeMenuLayout(buildMenuLayout(table, reserved, inv));

const ROW_FILES = [FILE_ROWS, EDIT_ROWS, PARAGRAPH_ROWS, FORMAT_ROWS, VIEW_ROWS, TABLE_ROWS, APP_ROWS];
const rev = <T>(xs: readonly T[]): T[] => [...xs].reverse();

describe("input permutation leaves the bytes unchanged (S6)", () => {
  const first = bytes(COMMAND_TABLE, RESERVED_CHORDS, EDITOR_OWNED_CHORDS);

  it("the row files still assemble into the table", () => {
    expect(ROW_FILES.flat()).toStrictEqual([...COMMAND_TABLE]);
    expect([...CODEMIRROR_ROWS, ...SOURCE_FORMAT_BINDINGS, ...MILKDOWN_ROWS]).toStrictEqual([...EDITOR_OWNED_CHORDS]);
    expect(first.length).toBeGreaterThan(1000);
  });

  it("(a) a second call on the same input", () => {
    expect(bytes(COMMAND_TABLE, RESERVED_CHORDS, EDITOR_OWNED_CHORDS)).toBe(first);
  });

  it("(b) each row file reversed", () => {
    expect(bytes(ROW_FILES.flatMap(rev), RESERVED_CHORDS, EDITOR_OWNED_CHORDS)).toBe(first);
    expect(bytes(COMMAND_TABLE, RESERVED_CHORDS, [...rev(CODEMIRROR_ROWS), ...rev(SOURCE_FORMAT_BINDINGS), ...rev(MILKDOWN_ROWS)])).toBe(first);
  });

  it("(c) all rows reversed", () => {
    expect(bytes(rev(COMMAND_TABLE), RESERVED_CHORDS, EDITOR_OWNED_CHORDS)).toBe(first);
  });

  it("(d) the reserved and inventory lists reversed", () => {
    const reserved = { macos: rev(RESERVED_CHORDS.macos), windows: rev(RESERVED_CHORDS.windows), linux: rev(RESERVED_CHORDS.linux) };
    expect(bytes(COMMAND_TABLE, reserved, rev(EDITOR_OWNED_CHORDS))).toBe(first);
  });

  it("rows come out sorted by id, and $generated comes first", () => {
    const layout = buildMenuLayout(rev(COMMAND_TABLE), RESERVED_CHORDS, EDITOR_OWNED_CHORDS);
    const ids = layout.rows.map((r) => r.id);
    expect(ids).toStrictEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(Object.keys(JSON.parse(first) as object)).toStrictEqual(["$generated", "rows", "reserved", "editorOwned"]);
  });
});

type Json = null | string | number | boolean | Json[] | { [k: string]: Json };

const ENUMS: Readonly<Record<string, readonly string[]>> = {
  route: ["frontend", "native", "rust-quit", "rust-hide", "unavailable"],
  availability: ["both", "W", "S", "none"],
  contexts: ["editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus"],
  platforms: ["macos", "windows", "linux"],
  editor: ["W", "S"],
  latent: ["D267", "D270"],
  keyKind: ["configurable", "fixed"],
  dispositionKind: ["implements", "editorOwned", "removeInM1b", "shadowed"],
  removalId: ["C11", "C12", "C17", "D264", "D269", "D271", "D272", "K4"],
};

function enumOf(path: readonly (string | number)[]): readonly string[] | undefined {
  const head = String(path[0]);
  const last = path[path.length - 1];
  if (head === "key" && last === "kind") return ENUMS.keyKind;
  if (head === "disposition" && last === "kind") return ENUMS.dispositionKind;
  if (head === "disposition" && last === "id") return ENUMS.removalId;
  return ENUMS[head];
}

function mutateLeaf(v: Json, path: readonly (string | number)[]): Json {
  if (v === null) return "X";
  if (typeof v === "boolean") return !v;
  if (typeof v === "number") return v + 1;
  if (typeof v === "string") {
    const members = enumOf(path);
    const i = members?.indexOf(v) ?? -1;
    return members !== undefined && i >= 0 ? members[(i + 1) % members.length] : `${v}X`;
  }
  if (Array.isArray(v) && v.length === 0) return ["X"];
  throw new Error(`not a leaf at ${path.join(".")}`);
}

/** Every leaf path of `value`: scalars, nulls and empty arrays. */
function leafPaths(value: Json, prefix: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [prefix] : value.flatMap((x, i) => leafPaths(x, [...prefix, i]));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, x]) => leafPaths(x, [...prefix, k]));
  }
  return [prefix];
}

function withLeaf(value: Json, path: readonly (string | number)[]): Json {
  const copy = structuredClone(value) as Json;
  if (path.length === 0) return mutateLeaf(copy, path);
  let parent = copy as Record<string | number, Json>;
  for (const seg of path.slice(0, -1)) parent = parent[seg] as Record<string | number, Json>;
  const last = path[path.length - 1];
  parent[last] = mutateLeaf(parent[last], path);
  return copy;
}

/** Each mutation of one unit: its leaves, then each absent optional set. */
function mutationsOf(unit: Json, optionals: Readonly<Record<string, Json>>): Json[] {
  const out = leafPaths(unit).map((p) => withLeaf(unit, p));
  const obj = unit as Record<string, Json>;
  for (const [k, v] of Object.entries(optionals)) if (!(k in obj)) out.push({ ...obj, [k]: v });
  return out;
}

const ROW_OPTIONALS = { prefField: "X", menuId: "X", nativeBehaviour: "X" };
const INVENTORY_OPTIONALS = { latent: "D267", names: ["X"] };

describe("R1-7b: every leaf mutation changes the bytes (S4)", () => {
  it("one build per leaf, each differing from the unmutated build", () => {
    let leaves = 0;
    let changed = 0;
    const count = (base: string, mutated: string): void => {
      leaves += 1;
      if (mutated !== base) changed += 1;
    };
    for (const row of COMMAND_TABLE) {
      const base = bytes([row], NO_RESERVED, []);
      for (const m of mutationsOf(row as unknown as Json, ROW_OPTIONALS)) {
        count(base, bytes([m as unknown as CommandRow], NO_RESERVED, []));
      }
    }
    for (const p of PLATFORMS) {
      const reserved = (list: readonly string[]): Reserved => ({ ...NO_RESERVED, [p]: list });
      const base = bytes([], reserved(RESERVED_CHORDS[p]), []);
      RESERVED_CHORDS[p].forEach((chord, i) => {
        const list = RESERVED_CHORDS[p].map((c, j) => (j === i ? `${chord}X` : c));
        count(base, bytes([], reserved(list), []));
      });
    }
    for (const row of EDITOR_OWNED_CHORDS) {
      const base = bytes([], NO_RESERVED, [row]);
      for (const m of mutationsOf(row as unknown as Json, INVENTORY_OPTIONALS)) {
        count(base, bytes([], NO_RESERVED, [m as unknown as EditorOwnedRow]));
      }
    }
    expect(leaves).toBeGreaterThanOrEqual(580);
    expect(changed).toBe(leaves);
  });

  it("the unmutated per-unit builds are not empty", () => {
    expect(bytes([COMMAND_TABLE[0]], NO_RESERVED, [])).toContain(`"id": "${COMMAND_TABLE[0].id}"`);
    expect(bytes([], NO_RESERVED, [EDITOR_OWNED_CHORDS[0]])).toContain(`"source": "${EDITOR_OWNED_CHORDS[0].source}"`);
  });
});
