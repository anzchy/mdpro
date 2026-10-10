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
 *    back from the row's own line with `splitCellTexts`. The widening itself
 *    lives in `tableWiden.ts#widenTable` (moved there in D49 so the
 *    context-menu edits can share it). New columns get an empty header cell
 *    and default alignment (`null`, `---`). Each widened table logs
 *    `editor.table.format-widened` with offsets and widths only.
 *
 * @coordinates-with src/utils/tableParser
 * @coordinates-with src/utils/tableWiden.ts (widenTable, the overflow read)
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/hooks/useDocument.ts (auto-reformat on save)
 */

import { serializeRows, type TableModel } from "./tableParser";
import { widenTable } from "./tableWiden";
import { findAllTables, type IsFenced } from "./cursorSync/table";
import { guardTableWrite } from "./tableWriteGuard";
import { loggingService } from "../services/loggingService";

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
