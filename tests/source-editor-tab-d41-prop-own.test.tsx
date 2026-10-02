/**
 * D41 WI-4 / WI-5 — C2-PROP-OWN and C2-LOG-PROP: the Tab-ownership partition
 * and the exact swallow log over an enumerated selection domain.
 *
 * Every (doc, selection, direction) maps to exactly one outcome, computed here
 * from HAND-LISTED table lines and cells (never from the parser under test):
 *  1. no line of interest is a table line → the indentMore / indentLess oracle;
 *  2. otherwise swallow, first match wins: multi-table > mixed-selection >
 *     delimiter-row > (guard-refused: unreachable unmocked) > first-cell —
 *     state unchanged and exactly one `ui.table.tab_swallowed` log whose
 *     context is exactly `{controlId, key, reason, ranges}`;
 *  3. otherwise navigate from the main head (one cursor), or append one row.
 *
 * Lines of interest: an empty range gives its head line; otherwise
 * `lineAt(from)..lineAt(to)`, dropping the last line when `to` is its start
 * and it is not the head line. The head line is always included.
 *
 * Domain (matrix `.claude/tdd-guardian/tests-20261002-D41.md`, C2-PROP-OWN,
 * round 2 and the WI-0 finding — G has NO table lines):
 *  D  {2,7,9,25,37,59,66}: 49 singles + 42 2-cursor + 105 3-cursor = 196
 *  D2 {2,56,59}: 6 non-empty singles + 6 2-cursor + 3 3-cursor = 15
 *  G  {2,9,14,25,35}: 25 singles + 20 2-cursor = 45
 *  F  {1,6,26,36}: 16 singles + 12 2-cursor = 28
 * 284 selections × 2 directions = 568 presses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { loggingService } from "../src/services/loggingService";
import { D12_FIXTURES } from "./support/tableSpanOracle";
import { completeTree, indentOracle, swallowContexts, type Sel, type SelState } from "./support/tabOwnershipOracle";
import { mountEditor, press, resetDoc, seedStores, select, teardownEditor } from "./support/mountSourceEditor";

const { T3, P2 } = D12_FIXTURES;

type Cell = readonly [number, number];
interface Table {
  lines: readonly number[];
  delimiterLine: number;
  cells: readonly Cell[];
  end: number;
  colCount: number;
}
interface Fixture {
  name: string;
  doc: string;
  points: readonly number[];
  tables: readonly Table[];
  singles: "all" | "non-empty";
  maxCursors: 2 | 3;
  fenced: boolean;
}

const T3_CELLS: Cell[] = [[1, 4], [5, 8], [9, 12], [29, 32], [33, 36], [37, 40], [43, 46], [47, 50], [51, 54]];
const shift = (cells: Cell[], by: number): Cell[] => cells.map(([s, e]) => [s + by, e + by] as const);

const FIXTURES: Fixture[] = [
  {
    name: "D",
    doc: "intro\n\n" + T3 + "\noutro\n",
    points: [2, 7, 9, 25, 37, 59, 66],
    tables: [{ lines: [2, 3, 4, 5], delimiterLine: 3, cells: shift(T3_CELLS, 7), end: 62, colCount: 3 }],
    singles: "all",
    maxCursors: 3,
    fenced: false,
  },
  {
    name: "D2",
    doc: T3 + "\n" + P2,
    points: [2, 56, 59],
    tables: [
      { lines: [0, 1, 2, 3], delimiterLine: 1, cells: T3_CELLS, end: 55, colCount: 3 },
      { lines: [5, 6, 7], delimiterLine: 6, cells: [[58, 61], [62, 65], [78, 81], [82, 85]], end: 86, colCount: 2 },
    ],
    singles: "non-empty",
    maxCursors: 3,
    fenced: false,
  },
  {
    name: "G",
    doc: "intro\n\np | q\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    points: [2, 9, 14, 25, 35],
    tables: [],
    singles: "all",
    maxCursors: 2,
    fenced: false,
  },
  {
    name: "F",
    doc: "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n",
    points: [1, 6, 26, 36],
    tables: [],
    singles: "all",
    maxCursors: 2,
    fenced: true,
  },
];

function lineStarts(doc: string): number[] {
  const out = [0];
  for (let i = 0; i < doc.length; i += 1) if (doc[i] === "\n") out.push(i + 1);
  return out;
}
const lineOf = (starts: number[], pos: number) => starts.filter((s) => s <= pos).length - 1;

function linesOfInterest(starts: number[], sel: Sel): number[] {
  const out = new Set<number>();
  for (const r of sel.ranges) {
    const head = r.head ?? r.anchor;
    const from = Math.min(r.anchor, head);
    const to = Math.max(r.anchor, head);
    const headLine = lineOf(starts, head);
    out.add(headLine);
    if (from === to) continue;
    let last = lineOf(starts, to);
    if (to === starts[last] && last !== headLine) last -= 1;
    for (let l = lineOf(starts, from); l <= last; l += 1) out.add(l);
  }
  return [...out];
}

interface Expected extends SelState {
  reason: string | null;
}

function expected(f: Fixture, sel: Sel, isShift: boolean): Expected {
  const starts = lineStarts(f.doc);
  const lines = linesOfInterest(starts, sel);
  const tableOf = (l: number) => f.tables.find((t) => t.lines.includes(l));
  const touched = new Set(lines.map(tableOf).filter((t): t is Table => t !== undefined));
  if (touched.size === 0) return { ...indentOracle(f.doc, sel, isShift), reason: null };
  const ranges = sel.ranges.map((r) => ({ anchor: r.anchor, head: r.head ?? r.anchor }));
  const unchanged = (reason: string): Expected => ({ doc: f.doc, ranges, mainIndex: sel.main, reason });
  if (touched.size > 1) return unchanged("multi-table");
  if (lines.some((l) => tableOf(l) === undefined)) return unchanged("mixed-selection");
  const [table] = [...touched];
  const head = ranges[sel.main].head;
  if (lineOf(starts, head) === table.delimiterLine) return unchanged("delimiter-row");
  const one = (doc: string, h: number): Expected => ({ doc, ranges: [{ anchor: h, head: h }], mainIndex: 0, reason: null });
  if (isShift) {
    const prev = table.cells.filter(([, e]) => e < head).pop();
    return prev ? one(f.doc, prev[0]) : unchanged("first-cell");
  }
  const next = table.cells.find(([s]) => s > head);
  if (next) return one(f.doc, next[0]);
  const row = "\n|" + "  |".repeat(table.colCount);
  return one(f.doc.slice(0, table.end) + row + f.doc.slice(table.end), table.end + 3);
}

function selections(f: Fixture): Sel[] {
  const out: Sel[] = [];
  for (const a of f.points) {
    for (const h of f.points) {
      if (f.singles === "non-empty" && a === h) continue;
      out.push({ ranges: [{ anchor: a, head: h }], main: 0 });
    }
  }
  const p = f.points;
  for (let i = 0; i < p.length; i += 1) {
    for (let j = i + 1; j < p.length; j += 1) {
      for (const main of [0, 1]) out.push({ ranges: [{ anchor: p[i] }, { anchor: p[j] }], main });
      if (f.maxCursors < 3) continue;
      for (let k = j + 1; k < p.length; k += 1) {
        for (const main of [0, 1, 2]) {
          out.push({ ranges: [{ anchor: p[i] }, { anchor: p[j] }, { anchor: p[k] }], main });
        }
      }
    }
  }
  return out;
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  seedStores();
  logSpy = vi.spyOn(loggingService, "logEventSync");
});
afterEach(teardownEditor);

describe("D41 WI-4 / WI-5 — ownership partition and swallow log", () => {
  it("C2-PROP-OWN + C2-LOG-PROP: every press equals the oracle state and logs exactly its reason", () => {
    const view = mountEditor(T3);
    const counts = FIXTURES.map((f) => selections(f).length);
    expect(counts).toEqual([196, 15, 45, 28]);
    const stateMismatches: unknown[] = [];
    const logMismatches: unknown[] = [];
    const reasons = new Set<string>();
    let presses = 0;
    for (const f of FIXTURES) {
      for (const sel of selections(f)) {
        for (const isShift of [false, true]) {
          resetDoc(view, f.doc, 0);
          if (f.fenced) completeTree(view);
          select(view, sel.ranges, sel.main);
          logSpy.mockClear();
          const out = press(view, isShift);
          presses += 1;
          const want = expected(f, sel, isShift);
          const got = { doc: out.doc, ranges: out.ranges, mainIndex: out.mainIndex };
          const { reason, ...wantState } = want;
          if (JSON.stringify(got) !== JSON.stringify(wantState)) {
            stateMismatches.push({ fixture: f.name, sel, isShift, got, want });
          }
          const wantLogs = reason === null ? [] : [{
            controlId: "source.tab_nav",
            key: isShift ? "Shift-Tab" : "Tab",
            reason,
            ranges: sel.ranges.map((r) => ({ anchor: r.anchor, head: r.head ?? r.anchor })),
          }];
          if (reason !== null) reasons.add(reason);
          const gotLogs = swallowContexts(logSpy);
          if (JSON.stringify(gotLogs) !== JSON.stringify(wantLogs)) {
            logMismatches.push({ fixture: f.name, sel, isShift, gotLogs, wantLogs });
          }
        }
      }
    }
    expect(presses).toBe(568);
    expect([...reasons].sort()).toEqual(["delimiter-row", "first-cell", "mixed-selection", "multi-table"]);
    expect({ count: stateMismatches.length, first: stateMismatches.slice(0, 3) }).toEqual({ count: 0, first: [] });
    expect({ count: logMismatches.length, first: logMismatches.slice(0, 3) }).toEqual({ count: 0, first: [] });
  }, 60_000);
});
