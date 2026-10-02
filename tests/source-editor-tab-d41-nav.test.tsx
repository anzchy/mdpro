/**
 * D41 WI-2 — Source-mode Tab / Shift-Tab target cells by OFFSET ORDER, not by
 * `findCell` (whose half-open `[start, end)` lost the caret at a cell end and
 * in a zero-width cell, so Tab indented and Shift-Tab stalled).
 *
 * Law (matrix `.claude/tdd-guardian/tests-20261002-D41.md`, WI-2):
 *  - Tab → `min{cell.start > head}` over row-major cells, else append one row.
 *  - Shift-Tab → start of `max{cell.end < head}`, else swallow (state unchanged).
 *  - Monotone: every Tab strictly increases head or appends exactly one row;
 *    every Shift-Tab strictly decreases head or leaves the state unchanged.
 *
 * Cell intervals below are HAND-WRITTEN from the fixture strings, never read
 * from the parser under test. Mounted real Editor through
 * `tests/support/mountSourceEditor.tsx`; `indentWithTab` always consumes the
 * key there, so cases assert doc + head, never `handled`.
 *
 * Cases: C2-NAV-PAD, C2-NAV-NOPAD, C2-NAV-ZW, C2-PROP-ORDER, C2-NO-STALL,
 * C2-NAV-CONSEC. Mocked boundaries: `@tauri-apps/api/core` / `event` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { D12_FIXTURES } from "./support/tableSpanOracle";
import {
  mountEditor,
  placeCursor,
  press,
  resetDoc,
  seedStores,
  teardownEditor,
} from "./support/mountSourceEditor";

const { T3 } = D12_FIXTURES;
const NOPAD = "|a|b|\n|-|-|\n|c|d|\n";
const ZW = "|a||c|\n|-|-|-|\n";
const ROW3 = "|  |  |  |";
const T3A = T3 + ROW3 + "\n";

type Cell = readonly [number, number];
interface OrderFixture {
  name: string;
  doc: string;
  /** Half-open cell intervals, row-major. */
  cells: readonly Cell[];
  /** Offsets on non-delimiter table lines. */
  offsets: number[];
  appended: { doc: string; head: number };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const FIXTURES: OrderFixture[] = [
  {
    name: "T3",
    doc: T3,
    cells: [[1, 4], [5, 8], [9, 12], [29, 32], [33, 36], [37, 40], [43, 46], [47, 50], [51, 54]],
    offsets: [...range(0, 13), ...range(28, 55)],
    appended: { doc: T3A, head: 58 },
  },
  {
    name: "NOPAD",
    doc: NOPAD,
    cells: [[1, 2], [3, 4], [13, 14], [15, 16]],
    offsets: [...range(0, 5), ...range(12, 17)],
    appended: { doc: NOPAD + "|  |  |\n", head: 20 },
  },
  {
    name: "ZW",
    doc: ZW,
    cells: [[1, 2], [3, 3], [4, 5]],
    offsets: range(0, 6),
    appended: { doc: "|a||c|\n|-|-|-|\n|  |  |  |\n", head: 17 },
  },
];

beforeEach(() => seedStores());
afterEach(teardownEditor);

/** Expected `{doc, head}` for one press under the WI-2 order law. */
function oracle(f: OrderFixture, h: number, shift: boolean): { doc: string; head: number } {
  if (shift) {
    const prev = f.cells.filter(([, e]) => e < h).pop();
    return { doc: f.doc, head: prev ? prev[0] : h };
  }
  const next = f.cells.find(([s]) => s > h);
  return next ? { doc: f.doc, head: next[0] } : f.appended;
}

describe("D41 WI-2 — offset-order examples", () => {
  it("C2-NAV-PAD: Tab from inside a padded cell before its end moves to the next cell", () => {
    const view = mountEditor(T3);
    placeCursor(view, 35);
    const out = press(view, false);
    expect({ head: out.head, doc: out.doc }).toEqual({ head: 37, doc: T3 });
  });

  it.each([
    ["(a) caret 2 (end of `a`), Tab", 2, false, 3],
    ["(b) caret 14 (end of `c`), Tab", 14, false, 15],
    ["(c) caret 4 (end of `b`), Shift-Tab", 4, true, 1],
  ] as const)("C2-NAV-NOPAD %s", (_n, h, shift, want) => {
    const view = mountEditor(NOPAD);
    placeCursor(view, h);
    const out = press(view, shift);
    expect({ head: out.head, doc: out.doc }).toEqual({ head: want, doc: NOPAD });
  });

  it.each([
    ["(a) Tab", false, 4],
    ["(b) Shift-Tab", true, 1],
  ] as const)("C2-NAV-ZW %s from the zero-width middle cell", (_n, shift, want) => {
    const view = mountEditor(ZW);
    placeCursor(view, 3);
    const out = press(view, shift);
    expect({ head: out.head, doc: out.doc }).toEqual({ head: want, doc: ZW });
  });

  it("C2-NAV-CONSEC: four Tabs from cell i append two rows and walk into them", () => {
    const view = mountEditor(T3);
    placeCursor(view, 52);
    const heads = Array.from({ length: 4 }, () => press(view, false).head);
    expect(heads).toEqual([58, 60, 63, 69]);
    expect(view.state.doc.toString()).toBe(T3 + ROW3 + "\n" + ROW3 + "\n");
  });
});

describe("D41 WI-2 — order law over every table offset", () => {
  it("C2-PROP-ORDER: Tab and Shift-Tab equal the offset-order oracle on T3, NOPAD, ZW", () => {
    const view = mountEditor(T3);
    const mismatches: unknown[] = [];
    let presses = 0;
    for (const f of FIXTURES) {
      for (const h of f.offsets) {
        for (const shift of [false, true]) {
          resetDoc(view, f.doc, h);
          const out = press(view, shift);
          presses += 1;
          const got = { doc: out.doc, head: out.head };
          const want = oracle(f, h, shift);
          if (got.doc !== want.doc || got.head !== want.head) {
            mismatches.push({ fixture: f.name, h, dir: shift ? "shift" : "tab", got, want });
          }
        }
      }
    }
    expect(presses).toBe(2 * (42 + 12 + 7));
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("C2-NO-STALL: 12 Tabs strictly advance or append one row; Shift-Tab strictly retreats or holds", () => {
    const view = mountEditor(T3);
    const starts = FIXTURES[0].offsets;
    const violations: unknown[] = [];
    for (const h0 of starts) {
      resetDoc(view, T3, h0);
      const seen = new Set<string>([`${h0}|${T3}`]);
      let prev: { head: number; doc: string } = { head: h0, doc: T3 };
      for (let i = 0; i < 12; i += 1) {
        const { head, doc } = press(view, false);
        const advanced = head > prev.head && doc === prev.doc;
        const line = view.state.doc.lineAt(head);
        const appended =
          doc.length === prev.doc.length + 11 && line.text === ROW3 && head === line.from + 2;
        const key = `${head}|${doc}`;
        if (!(advanced || appended) || seen.has(key)) violations.push({ h0, i, prev: prev.head, head });
        seen.add(key);
        prev = { head, doc };
      }
    }
    for (const h0 of starts) {
      resetDoc(view, T3, h0);
      let prev = h0;
      let held = false;
      for (let i = 0; i < 12; i += 1) {
        const { head, doc } = press(view, true);
        if (doc !== T3) violations.push({ h0, i, shift: true, doc });
        if (held && head !== prev) violations.push({ h0, i, shift: true, heldThenMoved: head });
        if (head > prev) violations.push({ h0, i, shift: true, prev, head });
        held = head === prev;
        prev = head;
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
  });
});
