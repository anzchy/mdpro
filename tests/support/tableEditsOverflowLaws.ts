/**
 * @module tests/support/tableEditsOverflowLaws
 * Purpose: D49 WI-1.2 laws for the source-mode context-menu edits on tables
 * whose body rows overflow the header. Shared by
 * `tests/table-edits-overflow-law.test.ts` (seeded, default lane) and
 * `tests/table-edits-overflow-law.slow.test.ts` (exhaustive, ADR-0050).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.2" L-1 to
 * L-10, with the adversary-round-1 amendment to L-10 (column-insert targets).
 *
 * The oracle is `oracleGrid(c)`: the generator's header plus each body
 * line's own `oracleCells`, padded to `widthOf(c)`. It never reads
 * `model.rows` (which truncates) and never calls `widenTable`, so a broken
 * widening cannot certify itself. Generators and oracles come from
 * `tableOverflowArb.ts`; nothing is copied out of it. `refOp` below is a
 * test-local reference model on plain arrays (L-9).
 *
 * The edit under test is passed in (`apply`), so this file never imports
 * `src/utils/tableEdits`. `formatTable` (L-5) and `frozenApplyEdit` (L-6)
 * are imported directly.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { parseTableAt, type ColumnAlignment, type TableModel } from "../../src/utils/tableParser";
import { splitCellTexts } from "../../src/utils/tableParser/lines";
import { formatTable } from "../../src/utils/tableFormatter";
import type { TableActionId, TableCellAlignment, TableContext } from "../../src/plugins/milkdown/table/types";
import { frozenApplyEdit } from "./frozenTableEdits";
import { oracleCells, onlyTable, pad, summary, widthOf, type OverflowCase } from "./tableOverflowArb";

export interface EditOutput {
  source: string;
  cursorOffset: number;
}
export type ApplyEditFn = (model: TableModel, ctx: TableContext, id: TableActionId) => EditOutput | null;

/** Every action id; `delete_table` takes part in L-6 only (it rewrites nothing). */
export const ALL_ACTION_IDS: readonly TableActionId[] = [
  "insert_row_before", "insert_row_after", "insert_column_before", "insert_column_after",
  "move_row_up", "move_row_down", "move_column_left", "move_column_right",
  "align_left", "align_center", "align_right", "reformat_table",
  "delete_row", "delete_column", "delete_table",
];

export type EditLawKey = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L9" | "L10";
export type EditLawReport = Record<EditLawKey, string[]>;
/** L-8 non-vacuity counters. */
export interface EditLawStats {
  overflowing: number;
  flush: number;
  h1WidenedDeleteColumn: number;
  edits: number;
  disabled: number;
}

/** The context the source menu would build at (r, col): header-width sizes (plan Finding 4). */
export function ctxAt(m: TableModel, r: number, col: number): TableContext {
  const a = m.alignments[col];
  const alignment: TableCellAlignment = a === "left" || a === "center" || a === "right" ? a : "left";
  return { rowIndex: r, colIndex: col, rowCount: m.rowCount, colCount: m.colCount, alignment };
}

/** The widened oracle grid: header + each body line's own cells, padded to W. */
export function oracleGrid(c: OverflowCase): string[][] {
  const w = widthOf(c);
  return [pad(c.header, w), ...c.rows.map((r) => pad(oracleCells(r.line), w))];
}

function oracleAligns(c: OverflowCase): ColumnAlignment[] {
  return [...c.aligns, ...new Array<ColumnAlignment>(widthOf(c) - c.h).fill(null)];
}

const swap = <T>(xs: T[], a: number, b: number) => ([xs[a], xs[b]] = [xs[b], xs[a]]);

/** L-9 reference model: the edit as a plain array operation on the oracle grid. */
export function refOp(
  id: TableActionId,
  ctx: TableContext,
  grid: readonly string[][],
  aligns: readonly ColumnAlignment[],
): { rows: string[][]; aligns: ColumnAlignment[] } {
  const rows = grid.map((r) => r.slice());
  const al = aligns.slice();
  const { rowIndex: r, colIndex: c } = ctx;
  const blank = () => new Array<string>(al.length).fill("");
  switch (id) {
    case "insert_row_before": rows.splice(r, 0, blank()); break;
    case "insert_row_after": rows.splice(r + 1, 0, blank()); break;
    case "insert_column_before": rows.forEach((x) => x.splice(c, 0, "")); al.splice(c, 0, null); break;
    case "insert_column_after": rows.forEach((x) => x.splice(c + 1, 0, "")); al.splice(c + 1, 0, null); break;
    case "delete_row": rows.splice(r, 1); break;
    case "delete_column": rows.forEach((x) => x.splice(c, 1)); al.splice(c, 1); break;
    case "move_row_up": swap(rows, r, r - 1); break;
    case "move_row_down": swap(rows, r, r + 1); break;
    case "move_column_left": rows.forEach((x) => swap(x, c, c - 1)); swap(al, c, c - 1); break;
    case "move_column_right": rows.forEach((x) => swap(x, c, c + 1)); swap(al, c, c + 1); break;
    case "align_left": al[c] = "left"; break;
    case "align_center": al[c] = "center"; break;
    case "align_right": al[c] = "right"; break;
    default: break;
  }
  return { rows, aligns: al };
}

/** L-10 target cell for each edit (amended: column inserts included). */
export function cursorTarget(id: TableActionId, ctx: TableContext, w: number): [number, number] {
  const { rowIndex: r, colIndex: c, rowCount } = ctx;
  switch (id) {
    case "insert_row_after": return [r + 1, c];
    case "insert_column_after": return [r, c + 1];
    case "delete_row": return [Math.min(r, rowCount - 2), c];
    case "delete_column": return [r, Math.min(c, w - 2)];
    case "move_row_up": return [r - 1, c];
    case "move_row_down": return [r + 1, c];
    case "move_column_left": return [r, c - 1];
    case "move_column_right": return [r, c + 1];
    default: return [r, c];
  }
}

const sorted = (xs: string[]) => JSON.stringify(xs.filter((s) => s !== "").sort());
const outputCells = (source: string) => source.split("\n").filter((_, i) => i !== 1).flatMap(oracleCells);
const pick = (r: EditOutput | null) => (r ? { source: r.source, cursorOffset: r.cursorOffset } : null);
const COLUMN_DELTA: Partial<Record<TableActionId, number>> = {
  insert_column_before: 1, insert_column_after: 1, delete_column: -1,
};
const ROUND_TRIPS: ReadonlyArray<[TableActionId, TableActionId, number, number]> = [
  ["move_row_down", "move_row_up", 1, 0],
  ["move_column_right", "move_column_left", 0, 1],
  ["insert_row_after", "delete_row", 1, 0],
];

/** Run L-0 (domain) and L-1 to L-10 (except L-8, returned as `stats`) over `cases`. */
export function checkEditLaws(
  cases: readonly OverflowCase[],
  apply: ApplyEditFn,
  seed?: number,
): { report: EditLawReport; stats: EditLawStats } {
  const report: EditLawReport = { L0: [], L1: [], L2: [], L3: [], L4: [], L5: [], L6: [], L7: [], L9: [], L10: [] };
  const stats: EditLawStats = { overflowing: 0, flush: 0, h1WidenedDeleteColumn: 0, edits: 0, disabled: 0 };
  for (const c of cases) {
    const tag = (msg: string) => `${seed === undefined ? "" : `seed=${seed} `}#${c.index} ${JSON.stringify(c.source)} ${msg}`;
    const m = onlyTable(c.source);
    if (!m || m.rowCount !== 1 + c.rows.length) {
      report.L0.push(tag(`input rowCount ${m?.rowCount}`));
      continue;
    }
    const w = widthOf(c);
    const grid = oracleGrid(c);
    const aligns = oracleAligns(c);
    if (w > c.h) stats.overflowing += 1;
    else stats.flush += 1;

    const ref = apply(m, ctxAt(m, 0, 0), "reformat_table");
    const reformatted = ref?.source ?? "";
    const again = parseTableAt(reformatted, 0);
    const twice = again ? apply(again, ctxAt(again, 0, 0), "reformat_table")?.source : null;
    if (twice !== reformatted) report.L4.push(tag(`→ ${JSON.stringify(twice)}`));
    if (reformatted !== formatTable(m)) report.L5.push(tag(`edit ${JSON.stringify(reformatted)} vs format ${JSON.stringify(formatTable(m))}`));

    for (let r = 0; r < m.rowCount; r += 1) {
      for (let col = 0; col < m.colCount; col += 1) {
        const ctx = ctxAt(m, r, col);
        for (const id of ALL_ACTION_IDS) {
          const where = `${id} (${r},${col})`;
          const out = apply(m, ctx, id);
          if (w === c.h && JSON.stringify(pick(out)) !== JSON.stringify(frozenApplyEdit(m, ctx, id))) {
            report.L6.push(tag(`${where} differs from pre-fix`));
          }
          if (!out) { stats.disabled += 1; continue; }
          if (id === "delete_table") continue;
          stats.edits += 1;
          if (id === "delete_column" && c.h === 1 && w > 1) stats.h1WidenedDeleteColumn += 1;
          const expected = refOp(id, ctx, grid, aligns);
          const wOut = w + (COLUMN_DELTA[id] ?? 0);
          if (out.source === "") {
            const allowed = (id === "delete_row" && m.rowCount === 1) || (id === "delete_column" && w === 1);
            if (!allowed) report.L2.push(tag(`${where} emptied the table`));
            continue;
          }
          const want = sorted(expected.rows.flat());
          const got = sorted(outputCells(out.source));
          if (got !== want) report[id.startsWith("delete") ? "L2" : "L1"].push(tag(`${where} cells ${got} vs ${want}`));
          const lines = out.source.split("\n");
          if (lines.some((l) => splitCellTexts(l).length !== wOut)) report.L3.push(tag(`${where} W'=${wOut} ${JSON.stringify(lines)}`));
          const re = parseTableAt(out.source, 0);
          const reGrid = re ? re.rows.map((row) => pad(row.map((cell) => cell.text), wOut)) : null;
          if (JSON.stringify({ rows: reGrid, aligns: re?.alignments }) !== JSON.stringify(expected)) {
            report.L9.push(tag(`${where} → ${JSON.stringify(reGrid)} ${JSON.stringify(re?.alignments)}`));
          }
          const [tr, tc] = cursorTarget(id, ctx, w);
          const cell = re?.rows[tr]?.[tc];
          if (!cell || out.cursorOffset !== cell.start) {
            report.L10.push(tag(`${where} cursor ${out.cursorOffset} vs (${tr},${tc})@${cell?.start}`));
          } else if (id.startsWith("move") && cell.text !== grid[r][col]) {
            report.L10.push(tag(`${where} cursor cell ${JSON.stringify(cell.text)} vs ${JSON.stringify(grid[r][col])}`));
          }
        }
        for (const [first, second, dr, dc] of ROUND_TRIPS) {
          const a = apply(m, ctx, first);
          if (!a) continue;
          const mid = parseTableAt(a.source, 0);
          const b = mid ? apply(mid, ctxAt(mid, r + dr, col + dc), second) : null;
          if (b?.source !== reformatted) report.L7.push(tag(`${first}∘${second} (${r},${col}) → ${JSON.stringify(b?.source)}`));
        }
      }
    }
  }
  return { report, stats };
}

/** Every report entry as a summary, so one `toEqual` reports all of them. */
export function summarizeEditLaws(report: EditLawReport): Record<EditLawKey, { count: number; first: string[] }> {
  const out = {} as Record<EditLawKey, { count: number; first: string[] }>;
  for (const k of Object.keys(report) as EditLawKey[]) out[k] = summary(report[k]);
  return out;
}
