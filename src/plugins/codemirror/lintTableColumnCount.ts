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
 * Runs over the editor's rope (WI-3B) — the document is never copied
 * into a string, on the lint timer or anywhere else.
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
 */
export function columnCountDiagnosticsFromSource(
  src: TableLineSource,
  isFenced?: IsFenced,
): Diagnostic[] {
  const tables = scanTables(src, isFenced);
  const diagnostics: Diagnostic[] = [];

  for (const table of tables) {
    // `model.raw` IS `source.slice(table.start, table.end)`. This comment
    // used to say "the parser already paid for it" — true when `raw` was
    // eager, false since D11 made it a lazy memoized getter. Nothing has
    // paid for it; THIS line is what forces the copy (D13). Re-slicing
    // separately would still be worse — two copies instead of one — so the
    // read stays, but on a single-table document it is a whole-document
    // materialisation on the lint timer, not a free ride.
    const lines = table.raw.split("\n");
    const expected = countTableLineCells(lines[0] ?? "");
    if (expected === 0) continue;

    let lineStart = table.start;
    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i];
      const lineEnd = lineStart + lineText.length;

      // Skip header (i=0) — defines the count. Skip delimiter (i=1) —
      // its alignment markers wouldn't parse as content cells.
      if (i >= 2 && lineText.trim().length > 0) {
        const actual = countTableLineCells(lineText);
        if (actual !== expected) {
          diagnostics.push({
            from: lineStart,
            to: lineEnd,
            severity: "warning",
            message: `Table row has ${actual} cell${actual === 1 ? "" : "s"} but header has ${expected}.`,
            source: "table-column-count",
          });
        }
      }

      lineStart = lineEnd + 1; // +1 for the trailing \n
    }
  }

  return diagnostics;
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
