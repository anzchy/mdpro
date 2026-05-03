/**
 * @module tableParser
 * Purpose: Public barrel for the GFM table parser. Split across
 * `types.ts`, `parse.ts`, and `serialize.ts` per rule 50 (file size
 * guideline). Consumers continue to `import { ... } from
 * "../utils/tableParser"` — module resolution finds index.ts.
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
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/utils/tableEdits.ts
 * @coordinates-with src/utils/cursorSync/table.ts
 */

export type {
  ColumnAlignment,
  TableCell,
  TableModel,
} from "./types";
export { parseTableAt } from "./parse";
export { findCell, findCellOrNearest } from "./find";
export { serializeModel, serializeRows } from "./serialize";
