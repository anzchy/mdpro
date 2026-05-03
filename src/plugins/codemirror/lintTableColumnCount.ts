/**
 * @module lintTableColumnCount
 * Purpose: Source-mode CodeMirror linter (Phase 3 WI-3.1) that flags
 * GFM table body rows whose cell count doesn't match the header.
 * Surfaces as gutter warnings via `@codemirror/lint`.
 *
 * Reuses `findAllTables` for enumeration (so the fence guard is
 * inherited) and `countTableLineCells` for per-line cell counting
 * (so escape and edge-pipe semantics stay single-source).
 *
 * Exposes `tableColumnCountDiagnostics(state)` as a pure function so
 * tests can assert against the diagnostic list directly without
 * mounting an EditorView.
 *
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/utils/tableParser
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 */

import {
  linter,
  lintGutter,
  type Diagnostic,
  type LintSource,
} from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { countTableLineCells } from "../../utils/tableParser";
import { findAllTables } from "../../utils/cursorSync/table";
import { isPositionInFencedCode } from "./sourceTableDetection";

/**
 * Pure: derive the diagnostic list for the given state. Walks each
 * GFM table (skipping fenced-code regions) and flags body rows whose
 * raw cell count differs from the header's.
 */
export function tableColumnCountDiagnostics(state: EditorState): Diagnostic[] {
  const source = state.doc.toString();
  const tables = findAllTables(source, (pos) =>
    isPositionInFencedCode(state, pos),
  );
  const diagnostics: Diagnostic[] = [];

  for (const table of tables) {
    const tableSource = source.slice(table.start, table.end);
    const lines = tableSource.split("\n");
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
