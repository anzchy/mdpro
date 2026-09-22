/**
 * @module tests/support/legacyLintColumnCount
 * Purpose: FROZEN byte-copy of `columnCountDiagnosticsFromSource`'s body as
 * it shipped before D13 (`src/plugins/codemirror/lintTableColumnCount.ts`
 * at HEAD `44607d8`, copied before the D13 edit). Used as the output oracle
 * by `tests/lint-table-column-count-no-raw.test.ts`.
 *
 * ---------------------------------------------------------------------
 * THIS FILE IS NEVER UPDATED.
 *
 * It is a reference implementation, not a test double. If the live linter
 * disagrees with it, the live linter changed behaviour. Editing this file
 * to match is a BEHAVIOURAL DECISION that must be argued for on its own
 * merits — it is not a "test fix".
 * ---------------------------------------------------------------------
 *
 * What is frozen and what is not: only the lint loop — the part D13
 * rewrites (`table.raw.split("\n")` walked with a running offset). It
 * still calls the LIVE `scanTables` and `countTableLineCells`, which D13
 * does not touch; freezing them too would turn a parser change elsewhere
 * into a false failure here. It must never import `lintTableColumnCount`,
 * or it would compare the new code against itself.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import type { Diagnostic } from "@codemirror/lint";
import { countTableLineCells } from "../../src/utils/tableParser";
import type { TableLineSource } from "../../src/utils/tableParser/lines";
import { scanTables } from "../../src/utils/tableParser/scan";
import type { IsFenced } from "../../src/utils/cursorSync/table";

// --- verbatim from src/plugins/codemirror/lintTableColumnCount.ts ----------

export function legacyColumnCountDiagnosticsFromSource(
  src: TableLineSource,
  isFenced?: IsFenced,
): Diagnostic[] {
  const tables = scanTables(src, isFenced);
  const diagnostics: Diagnostic[] = [];

  for (const table of tables) {
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

// --- end verbatim -----------------------------------------------------------
