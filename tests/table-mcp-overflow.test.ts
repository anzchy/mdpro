// @vitest-environment node
/**
 * D49 WI-2 (Variant A1, ADR-0064): the MCP table actions keep body cells past
 * the header's column count ("overflow") instead of truncating them.
 *
 * Law: every MCP rewriting action on an overflow table either writes nothing
 * (null) or keeps every non-empty oracle cell except the deleted or replaced
 * ones, with the bytes outside the table unchanged (NT-1). `setCell` changes
 * exactly one cell of the widened oracle grid (MA-4), and on a table with no
 * overflow every action is byte-identical to the pre-fix code (MA-9). The
 * `set_cell` column bound stays the header width (A1, MA-3).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-2" NT-1,
 * MA-1, MA-2, MA-3, MA-4, MA-5, MA-7, MA-8, MA-9, MA-10, MA-12. MA-6 (the
 * store + live view path) lives in `tests/mcp-table-action-overflow.test.ts`.
 * MA-3, MA-9 and MA-10 are pins; MA-2, MA-8 and the row/column half of NT-1
 * went green with WI-1.2 (the plan's ordering hazard).
 *
 * Boundary: only `@tauri-apps/api/core` `invoke` is mocked. Log entries are
 * observed as `log_event` calls through the real `loggingService`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyMcpTableAction, insertTable, setCell, type McpTableAction } from "../src/utils/tableMcp";
import { useLoggingStore } from "../src/stores/loggingStore";
import { frozenApplyMcpTableAction } from "./support/frozenTableMcp";
import { oracleGrid } from "./support/tableEditsOverflowLaws";
import {
  AFTER,
  BEFORE,
  D44_SEED,
  oracleCells,
  onlyTable,
  randomOverflowCases,
  summary,
  widthOf,
  type OverflowCase,
} from "./support/tableOverflowArb";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

const WIDENED = "editor.table.edit-widened";
const T2 = "| a | b |\n|---|---|\n| 1 | 2 | Z |\n| 3 | 4 |\n";
const T0 = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n";
const H = "| a   | b   |     |";
const D = "| --- | --- | --- |";
const R1 = "| 1   | 2   | Z   |";
const R2 = "| 3   | 4   |     |";
const B3 = "|     |     |     |";
const CASES = 200;
const MIN_OUTCOMES = 100;
const MIN_FLUSH_CASES = 20;
const CONTENT = "Q§";

type LogPayload = { level: string; event: string; status?: string; context?: unknown };
type LogCall = [string, { payload: LogPayload }];

const widenedLogs = (): LogPayload[] =>
  (invoke.mock.calls as unknown as LogCall[])
    .filter(([cmd, a]) => cmd === "log_event" && a.payload.event === WIDENED)
    .map(([, a]) => a.payload);

beforeEach(() => {
  invoke.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

/** Every in-range payload for `action` on the case's table (header-width columns). */
function payloadsFor(action: McpTableAction, rowCount: number, h: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (action === "set_cell") {
    for (let row = 0; row < rowCount; row += 1) for (let col = 0; col < h; col += 1) out.push({ row, col, content: CONTENT });
  } else if (action === "add_row" || action === "delete_row") {
    for (let r = 0; r < rowCount; r += 1) out.push(action === "add_row" ? { after: r } : { index: r });
  } else {
    for (let c = 0; c < h; c += 1) out.push(action === "add_column" ? { after: c } : { index: c });
  }
  return out;
}

const REWRITING: readonly McpTableAction[] = ["set_cell", "add_row", "delete_row", "add_column", "delete_column"];

/** Non-empty oracle cells of the table between BEFORE and AFTER (delimiter line skipped). */
function tableCells(out: string): string[] {
  const middle = out.slice(BEFORE.length, out.length - AFTER.length);
  const lines = middle.split("\n").filter((l) => l.trim() !== "");
  return lines.filter((_, i) => i !== 1).flatMap(oracleCells).filter((s) => s !== "");
}

/** Input oracle cells minus the ones the action deletes or replaces. */
function keptCells(c: OverflowCase, action: McpTableAction, p: Record<string, unknown>): string[] {
  const grid = oracleGrid(c);
  const keep = grid.flatMap((row, r) =>
    row.filter((_, col) => {
      if (action === "set_cell") return !(r === p.row && col === p.col);
      if (action === "delete_row") return r !== p.index;
      if (action === "delete_column") return col !== p.index;
      return true;
    }),
  );
  return keep.filter((s) => s !== "");
}

/** True when `big` contains every element of `small` with multiplicity. */
function isSuperMultiset(big: readonly string[], small: readonly string[]): boolean {
  const counts = new Map<string, number>();
  for (const s of big) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const s of small) {
    const n = counts.get(s) ?? 0;
    if (n === 0) return false;
    counts.set(s, n - 1);
  }
  return true;
}

describe("NT-1: no MCP rewriting path truncates an overflow table", () => {
  it("every action either writes nothing or keeps every surviving oracle cell and the wrapper", () => {
    const cases = randomOverflowCases(D44_SEED, CASES).filter((c) => widthOf(c) > c.h);
    const bad: string[] = [];
    const outcomes: Record<string, number> = {};
    for (const c of cases) {
      const m = onlyTable(c.source);
      if (!m) {
        bad.push(`#${c.index} no table`);
        continue;
      }
      for (const action of REWRITING) {
        for (const p of payloadsFor(action, m.rowCount, c.h)) {
          const out = applyMcpTableAction(c.source, action, p);
          if (out === null) continue;
          outcomes[action] = (outcomes[action] ?? 0) + 1;
          const tag = `#${c.index} ${JSON.stringify(c.source)} ${action} ${JSON.stringify(p)}`;
          if (!out.startsWith(BEFORE) || !out.endsWith(AFTER)) bad.push(`${tag} wrapper changed`);
          else if (!isSuperMultiset(tableCells(out), keptCells(c, action, p))) {
            bad.push(`${tag} → ${JSON.stringify(out)}`);
          }
        }
      }
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
    for (const action of REWRITING) expect(outcomes[action] ?? 0).toBeGreaterThanOrEqual(MIN_OUTCOMES);
  });
});

describe("MA-1: set_cell on an overflow table keeps the overflow cell", () => {
  it("writes Q into (1,0) and keeps Z in its own column", () => {
    expect(setCell("| a | b |\n|---|---|\n| 1 | 2 | Z |\n", { row: 1, col: 0, content: "Q" })).toBe(
      "| a   | b   |     |\n| --- | --- | --- |\n| Q   | 2   | Z   |\n",
    );
  });
});

describe("MA-2: the row/column actions on an overflow table keep Z", () => {
  it.each<[McpTableAction, Record<string, unknown>, string]>([
    ["add_row", { after: 1 }, [H, D, R1, B3, R2].join("\n") + "\n"],
    ["delete_row", { index: 2 }, [H, D, R1].join("\n") + "\n"],
    ["add_column", { after: 0 }, "| a   |     | b   |     |\n| --- | --- | --- | --- |\n| 1   |     | 2   | Z   |\n| 3   |     | 4   |     |\n"],
    ["delete_column", { index: 0 }, "| b   |     |\n| --- | --- |\n| 2   | Z   |\n| 4   |     |\n"],
  ])("%s %j", (action, payload, expected) => {
    expect(applyMcpTableAction(T2, action, payload)).toBe(expected);
  });
});

describe("MA-3 (A1): the set_cell column bound stays the header width", () => {
  it("an overflow column returns null and logs no widening", () => {
    expect(setCell(T2, { row: 1, col: 2, content: "Q" })).toBeNull();
    expect(applyMcpTableAction(T2, "set_cell", { row: 1, col: 2, content: "Q" })).toBeNull();
    expect(widenedLogs()).toEqual([]);
  });
});

describe("MA-4: set_cell changes exactly one cell of the widened oracle grid", () => {
  it("over seeded random cases, every in-range (row, col < h)", () => {
    const bad: string[] = [];
    let writes = 0;
    for (const c of randomOverflowCases(D44_SEED, CASES)) {
      const m = onlyTable(c.source);
      if (!m) {
        bad.push(`#${c.index} no table`);
        continue;
      }
      for (const p of payloadsFor("set_cell", m.rowCount, c.h)) {
        const tag = `#${c.index} ${JSON.stringify(c.source)} ${JSON.stringify(p)}`;
        const out = setCell(c.source, p as { row: number; col: number; content: string });
        if (out === null) {
          bad.push(`${tag} → null`);
          continue;
        }
        writes += 1;
        const expected = oracleGrid(c);
        expected[p.row as number][p.col as number] = CONTENT;
        const got = onlyTable(out)?.rows.map((row) => row.map((cell) => cell.text));
        if (JSON.stringify(got) !== JSON.stringify(expected)) bad.push(`${tag} → ${JSON.stringify(got)}`);
        if (!out.startsWith(BEFORE) || !out.endsWith(AFTER)) bad.push(`${tag} wrapper changed`);
      }
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
    expect(writes).toBeGreaterThanOrEqual(MIN_OUTCOMES);
  });
});

describe("MA-5: escaped and code-span pipes in overflow survive set_cell", () => {
  it("(a) an escaped pipe in an overflow cell", () => {
    expect(setCell("| a | b |\n|---|---|\n| 1 | 2 | a\\|b |\n", { row: 1, col: 0, content: "Q" })).toBe(
      "| a   | b   |      |\n| --- | --- | ---- |\n| Q   | 2   | a\\|b |\n",
    );
  });
  it("(b) a code-span pipe splits into overflow cells, which are kept", () => {
    expect(setCell("| a |\n|---|\n| `x|y` | b |\n", { row: 0, col: 0, content: "Q" })).toBe(
      "| Q   |     |     |\n| --- | --- | --- |\n| `x  | y`  | b   |\n",
    );
  });
});

describe("MA-7: set_cell logs one edit-widened entry when it widened", () => {
  it("logs {action:set_cell, fromColCount:2, toColCount:3} for the overflow table", () => {
    setCell("| a | b |\n|---|---|\n| 1 | 2 | Z |\n", { row: 1, col: 0, content: "Q" });
    expect(widenedLogs()).toEqual([
      {
        level: "info",
        event: WIDENED,
        status: "success",
        context: { action: "set_cell", fromColCount: 2, toColCount: 3 },
      },
    ]);
  });
  it("logs nothing for a table with no overflow", () => {
    expect(setCell(T0, { row: 1, col: 0, content: "Q" })).not.toBeNull();
    expect(widenedLogs()).toEqual([]);
  });
});

describe("MA-8: add_row on an overflow table logs through applyEdit", () => {
  it("one entry with action insert_row_after", () => {
    expect(applyMcpTableAction(T2, "add_row", { after: 1 })).toContain("Z");
    expect(widenedLogs().map((p) => p.context)).toEqual([
      { action: "insert_row_after", fromColCount: 2, toColCount: 3 },
    ]);
  });
});

describe("MA-9: tables with no overflow are byte-identical to the pre-fix code", () => {
  it("over seeded random W === h cases, every action and in-range payload", () => {
    const cases = randomOverflowCases(D44_SEED, CASES).filter((c) => widthOf(c) === c.h);
    const bad: string[] = [];
    for (const c of cases) {
      const m = onlyTable(c.source);
      if (!m) {
        bad.push(`#${c.index} no table`);
        continue;
      }
      for (const action of REWRITING) {
        for (const p of payloadsFor(action, m.rowCount, c.h)) {
          const got = applyMcpTableAction(c.source, action, p);
          const want = frozenApplyMcpTableAction(c.source, action, p);
          if (got !== want) bad.push(`#${c.index} ${JSON.stringify(c.source)} ${action} ${JSON.stringify(p)} → ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
        }
      }
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
    expect(cases.length).toBeGreaterThanOrEqual(MIN_FLUSH_CASES);
  });
});

describe("MA-10: insert_table leaves an overflow table's bytes alone", () => {
  it("appends a blank 2x2 table after T2", () => {
    expect(insertTable(T2, { rows: 2, cols: 2 })).toBe(
      T2 + "\n" + "|     |     |\n| --- | --- |\n|     |     |" + "\n",
    );
  });
});

describe("MA-12: one trailing blank cell counts as overflow", () => {
  it("set_cell widens the table by a blank column", () => {
    expect(setCell("| a | b |\n|---|---|\n| 1 | 2 | |\n", { row: 1, col: 0, content: "Q" })).toBe(
      "| a   | b   |     |\n| --- | --- | --- |\n| Q   | 2   |     |\n",
    );
  });
});
