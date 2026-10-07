/**
 * @module tableFormatter
 * Purpose: GFM table pretty-printer (Phase 3 WI-3.2). Reads a parsed
 * `TableModel` (or a whole document) and produces aligned source —
 * cells padded column-by-column, alignment markers preserved, escaped
 * pipes preserved, CRLF normalized to LF.
 *
 * `formatTable(model)` is the single-table primitive behind
 * `formatAllTables(source, isFenced)`, the whole-document pass used by the
 * `editor.autoReformatTablesOnSave` Settings opt-in (⌘S). The source
 * context menu's "Reformat table" does NOT come through here: it goes
 * through `tableEdits/edits.ts#reformatTable`.
 *
 * Both pass through `serializeRows` / `findAllTables` so the fence
 * guard (Risk R3) and the parser's edge-pipe / escape semantics stay
 * single-source-of-truth.
 *
 * Key decisions:
 *  - D44 (ADR-0052): formatting WIDENS a table to its own widest row
 *    instead of dropping overflow cells (body cells past the header's
 *    column count). The parser still truncates rows to the header
 *    (`tableParser/rowCells.ts`, GFM's "excess cells are ignored", which
 *    cursor locate, the linter and MCP rely on), so the cells inside the
 *    header's columns come from `model.rows` and only the overflow is read
 *    back from the row's own line with `splitCellTexts`. New columns get an
 *    empty header cell and default alignment (`null`, `---`). Each widened
 *    table logs `editor.table.format-widened` with offsets and widths only.
 *
 * @coordinates-with src/utils/tableParser
 * @coordinates-with src/utils/tableParser/lines.ts (splitCellTexts, the overflow read)
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/hooks/useDocument.ts (auto-reformat on save)
 */

import {
  serializeRows,
  type ColumnAlignment,
  type TableModel,
} from "./tableParser";
import { splitCellTexts } from "./tableParser/lines";
import { findAllTables, type IsFenced } from "./cursorSync/table";
import { guardTableWrite } from "./tableWriteGuard";
import { loggingService } from "../services/loggingService";

/** Raw line index of the delimiter row in `model.raw` (0 is the header). */
const DELIMITER_LINE = 1;

interface WidenedTable {
  rows: string[][];
  alignments: ColumnAlignment[];
}

/**
 * Cell texts and alignments for `model`, widened to its widest row.
 *
 * `model.raw` line 0 is the header, line 1 the delimiter (skipped by
 * index, never by content), and line k >= 2 is model row k - 1. A row's
 * overflow is `splitCellTexts(line).slice(colCount)`, trimmed exactly as
 * `parseRowCells` trims, so the two sources agree (RC-6).
 */
function widenTable(model: TableModel): WidenedTable {
  const lines = model.raw.split("\n");
  const rows = model.rows.map((row, r) => {
    const line = lines[r === 0 ? 0 : r + DELIMITER_LINE] ?? "";
    const overflow = splitCellTexts(line)
      .slice(model.colCount)
      .map((text) => text.trim());
    return [...row.map((cell) => cell.text), ...overflow];
  });
  // reduce, not Math.max(...spread): a spread over a huge table overflows the stack.
  const width = rows.reduce((max, row) => Math.max(max, row.length), model.alignments.length);
  const alignments = [...model.alignments];
  while (alignments.length < width) alignments.push(null);
  return { rows, alignments };
}

/**
 * Serialize `model` with column-aligned padding, widened to its widest
 * row. Output is a drop-in replacement for `model.raw` (NO trailing
 * newline).
 */
export function formatTable(model: TableModel): string {
  const { rows, alignments } = widenTable(model);
  return serializeRows(rows, alignments);
}

/**
 * Walk the source, format every (non-fenced) table region in place,
 * and return the new source. Idempotent — applying twice yields the
 * same output as applying once.
 *
 * WI-C0 (plan §3.1 W2): this is the only write path that reaches disk
 * unattended — `useDocument.ts` runs it on ⌘S when
 * `editor.autoReformatTablesOnSave` is on. A model refused by
 * `guardTableWrite` is SKIPPED, not rewritten: its bytes survive
 * verbatim and the rest of the document is still formatted. Refusing the
 * whole pass would be a worse trade — one questionable region should not
 * cost the user the formatting of every other table. A refused model is
 * neither read for overflow nor logged as widened.
 *
 * D44: a table that widens logs one `editor.table.format-widened` entry
 * with its PRE-format span and widths — never cell text (rule 60).
 *
 * Implementation detail: tables are spliced from LAST to FIRST so each
 * splice doesn't shift offsets in the still-pending tables.
 */
export function formatAllTables(source: string, isFenced?: IsFenced): string {
  const tables = findAllTables(source, isFenced);
  if (tables.length === 0) return source;

  let out = source;
  for (let i = tables.length - 1; i >= 0; i -= 1) {
    const table = tables[i];
    if (!guardTableWrite(table, "format.all_tables")) continue;
    const { rows, alignments } = widenTable(table);
    if (alignments.length > table.colCount) {
      loggingService.logEventSync({
        level: "info",
        event: "editor.table.format-widened",
        status: "success",
        context: {
          start: table.start,
          end: table.end,
          fromColCount: table.colCount,
          toColCount: alignments.length,
        },
      });
    }
    const formatted = serializeRows(rows, alignments);
    out = out.slice(0, table.start) + formatted + out.slice(table.end);
  }
  return out;
}
