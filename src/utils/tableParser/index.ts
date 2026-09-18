/**
 * @module tableParser
 * Purpose: Public barrel for the GFM table parser. Split across
 * `types.ts`, `lines.ts`, `parse.ts`, `scan.ts`, `find.ts` and
 * `serialize.ts` per rule 50 (file size guideline). Consumers continue
 * to `import { ... } from "../utils/tableParser"` — module resolution
 * finds index.ts.
 *
 * Layering, bottom to top:
 *
 *   lines.ts   `TableLineSource` — the line index and the line-level
 *              predicates. Owns NO table structure. The interface is
 *              the representation boundary: `linesFromString` is the
 *              string adapter here, and `plugins/codemirror/
 *              textLineSource.ts#linesFromText` is the CodeMirror-rope
 *              adapter on the other side of it (Phase 4 WI-3B). One
 *              algorithm, two adapters — never two parsers.
 *   parse.ts   one table at one position. No loop over the document.
 *   scan.ts    whole-document enumeration (Phase 4 WI-3): one
 *              `parseTableAtLine` probe per maximal run of candidate
 *              lines, replacing the probe-every-offset loop that went
 *              quadratic whenever a table failed to parse.
 *   find.ts / serialize.ts  cell lookup and model → Markdown.
 *
 * `lines.ts` and `scan.ts` are deliberately NOT re-exported here: their
 * consumers (the CodeMirror plugins, `cursorSync/table.ts`) import them
 * by path, and widening the barrel would invite a second enumeration
 * loop to grow somewhere else.
 *
 * Source-of-truth header (kept here so future readers don't have to
 * hunt across files):
 *
 *   GFM table format:
 *     | Header A | Header B |   ← header row (edge pipes optional)
 *     | :------- | -------: |   ← delimiter row (alignment via colons)
 *     | cell 1   | cell 2   |   ← body rows
 *
 *   Edge cases handled by parseTableAt:
 *     - escaped `\|` inside cell content
 *     - missing leading/trailing `|`
 *     - up to 3 leading spaces (CommonMark indented-code boundary)
 *     - CRLF normalized to LF for processing; offsets refer to the
 *       ORIGINAL source so callers don't need to translate
 *     - body rows shorter/longer than header (padded / truncated per GFM)
 *
 *   Out of scope for v1:
 *     - tables inside blockquotes, list items
 *     - tables inside fenced code blocks (caller responsibility — see
 *       `src/plugins/codemirror/sourceTableDetection.ts`)
 *
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/scan.ts
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/codemirror/lintTableColumnCount.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 * @coordinates-with src/utils/tableEdits.ts
 * @coordinates-with src/utils/cursorSync/table.ts
 */

export type {
  ColumnAlignment,
  TableCell,
  TableModel,
} from "./types";
export { countTableLineCells, parseTableAt } from "./parse";
export { findCell, findCellOrNearest } from "./find";
export { serializeModel, serializeRows } from "./serialize";
