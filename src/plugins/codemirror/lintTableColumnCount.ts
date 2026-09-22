/**
 * @module lintTableColumnCount
 * Purpose: Source-mode CodeMirror linter (Phase 3 WI-3.1) that flags
 * GFM table body rows whose cell count doesn't match the header.
 * Surfaces as gutter warnings via `@codemirror/lint`.
 *
 * Reuses `scanTables` for enumeration (so the fence guard is inherited)
 * and `countTableLineCells` for per-line cell counting (so escape and
 * edge-pipe semantics stay single-source).
 *
 * Key decisions:
 *  - Rows are walked through the `TableLineSource` (`src.line(i)`), never
 *    by reading `TableModel.raw` (D13). `raw` is a lazy slice (D11); on a
 *    one-table document reading it copied the whole document per lint
 *    tick. Pinned at 0 slices / 0 `raw` reads and `line()` <= 2R + 5 by
 *    `tests/lint-table-column-count-no-raw.test.ts`.
 *  - Diagnostic offsets reproduce the pre-D13 `raw.split("\n")` walk
 *    exactly, including `to` covering a row's `\r` under CRLF; the frozen
 *    copy in `tests/support/legacyLintColumnCount.ts` is the oracle.
 *
 * Exposes `tableColumnCountDiagnostics(state)` as a pure function so
 * tests can assert against the diagnostic list directly without
 * mounting an EditorView, and `columnCountDiagnosticsFromSource` as the
 * same logic over a bare line source (Phase 4 WI-3B).
 *
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/utils/tableParser
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 */

import {
  linter,
  lintGutter,
  type Diagnostic,
  type LintSource,
} from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { countTableLineCells } from "../../utils/tableParser";
import type { TableLineSource } from "../../utils/tableParser/lines";
import { scanTables } from "../../utils/tableParser/scan";
import type { IsFenced } from "../../utils/cursorSync/table";
import { isPositionInFencedCode } from "./sourceTableDetection";
import { linesFromText } from "./textLineSource";

/**
 * Pure: derive the diagnostic list for the given state. Walks each
 * GFM table (skipping fenced-code regions) and flags body rows whose
 * raw cell count differs from the header's.
 *
 * Runs over the editor's rope (WI-3B). Since D13 that claim holds on
 * the lint timer too: no `toString`, no `sliceString`, no `raw` read.
 */
export function tableColumnCountDiagnostics(state: EditorState): Diagnostic[] {
  return columnCountDiagnosticsFromSource(linesFromText(state.doc), (pos) =>
    isPositionInFencedCode(state, pos),
  );
}

/**
 * The linter's real body, against any `TableLineSource`. Exposed
 * separately so the cost claim ("no table-scan path materialises the
 * document") can be asserted as a counted integer over a pass-through
 * counting delegate, rather than only as a grep over this file.
 *
 * Cost: zero `slice()` calls; one `line()` per header and body row on
 * top of what `scanTables` spends.
 */
export function columnCountDiagnosticsFromSource(
  src: TableLineSource,
  isFenced?: IsFenced,
): Diagnostic[] {
  const tables = scanTables(src, isFenced);
  const diagnostics: Diagnostic[] = [];

  for (const table of tables) {
    // D13 — walk the table's lines through `src`; never read `table.raw`.
    // `raw` is a lazy slice (D11), so reading it here would copy the whole
    // table — on a one-table document, the whole document — per lint tick.
    // A table's lines are contiguous: header at `headerIdx`, delimiter at
    // `+1`, then `rowCount - 1` body rows, so the last line is
    // `headerIdx + rowCount`.
    const headerIdx = headerLineIndex(src, table.start);
    if (headerIdx < 0) continue;
    const expected = countTableLineCells(src.line(headerIdx).text);
    if (expected === 0) continue;

    const lastIdx = headerIdx + table.rowCount;
    // Skip header (defines the count) and delimiter (its alignment markers
    // wouldn't parse as content cells). Each body line is fetched once and
    // carried forward: its successor's `start` is what the next row needs.
    let line = headerIdx + 2 <= lastIdx ? src.line(headerIdx + 2) : null;
    for (let i = headerIdx + 2; line && i <= lastIdx; i += 1) {
      const next = i < lastIdx ? src.line(i + 1) : null;
      if (line.text.trim().length > 0) {
        const actual = countTableLineCells(line.text);
        if (actual !== expected) {
          diagnostics.push({
            from: line.start,
            to: rowEnd(line, next),
            severity: "warning",
            message: `Table row has ${actual} cell${actual === 1 ? "" : "s"} but header has ${expected}.`,
            source: "table-column-count",
          });
        }
      }
      line = next;
    }
  }

  return diagnostics;
}

/**
 * Index of the line that starts at `start` (a table's header).
 *
 * Resolves `start + 1`, not `start`: `lineIndexAt` deliberately maps an
 * offset equal to `prev.end + 1` — which IS a line's `start` under LF — to
 * the line ABOVE (see `lines.ts`). A header is a candidate line, so it is
 * never empty and `start + 1 <= header.end + 1` always lands on it.
 */
function headerLineIndex(src: TableLineSource, start: number): number {
  return src.lineIndexAt(start + 1);
}

/**
 * The diagnostic's `to`, byte-for-byte what the pre-D13 `raw.split("\n")`
 * walk produced. That walk kept each row's `\r` (only `\n` was split), so
 * under CRLF `to` covers it: for every row but the last it is the offset
 * of the row's `\n`, i.e. `next.start - 1`. The last row ends where the
 * table does, `line.end`.
 */
function rowEnd(
  line: { end: number },
  next: { start: number } | null,
): number {
  return next ? next.start - 1 : line.end;
}

/**
 * CodeMirror extension that registers the column-count linter PLUS
 * the lint gutter (audit-fix M2). Without `lintGutter()` the
 * `tables.md` claim of a "yellow triangle in the gutter" wouldn't
 * actually render — diagnostics would only show as inline underlines.
 *
 * Plug directly into the source editor's extension list.
 */
export function tableColumnCountLinter(): Extension {
  const lintFn: LintSource = (view) => tableColumnCountDiagnostics(view.state);
  return [linter(lintFn), lintGutter()];
}
