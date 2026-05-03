/**
 * @module sourceTableDetection
 * Purpose: Detect when the cursor is inside a GFM table in source mode
 * (Phase 2 WI-2.2). Wraps the pure `tableParser` in a CodeMirror
 * StateField so downstream plugins (Tab nav WI-2.3, source-mode
 * context menu WI-2.4, cell highlight WI-2.5) read a single cached
 * value instead of re-parsing on every event.
 *
 * Fence guard: positions inside ` ``` ` / ` ~~~ ` blocks return null,
 * so the parser never sees pipe-runs that are actually code content.
 *
 * Performance: re-parses only on `update.docChanged ||
 * update.selectionSet`. The parser scan is bounded to the current
 * line + neighbors (it walks up/down until lines stop matching),
 * which is O(rows-in-table) and cheap relative to typical edits.
 *
 * @coordinates-with src/utils/tableParser.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts (planned WI-2.3)
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts (planned WI-2.4)
 * @coordinates-with src/plugins/codemirror/sourceTableCellHighlight.ts (planned WI-2.5)
 */

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { parseTableAt, type TableModel } from "../../utils/tableParser";

/**
 * Walk the markdown syntax tree at `pos` and return true if the
 * position sits inside a fenced code block (``` or ~~~). Used to
 * suppress table detection inside code so a cell-shaped line of code
 * doesn't surface as a table.
 */
export function isPositionInFencedCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  const node = tree.resolveInner(pos, 1);
  let current: typeof node | null = node;
  while (current) {
    // The markdown grammar tags fenced code blocks as "FencedCode"
    // (with internal nodes "CodeMark" / "CodeText" / "CodeInfo").
    if (current.name === "FencedCode" || current.name === "CodeBlock") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * StateField holding the active TableModel for the cursor position,
 * or null when the cursor is outside any table (or inside a fence).
 */
const tableContextField = StateField.define<TableModel | null>({
  create(state) {
    return computeContext(state);
  },
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    return computeContext(transaction.state);
  },
});

function computeContext(state: EditorState): TableModel | null {
  const cursor = state.selection.main.head;
  if (isPositionInFencedCode(state, cursor)) return null;
  return parseTableAt(state.doc.toString(), cursor);
}

/** Returns the active TableModel for the cursor (null if not in a table). */
export function getTableContext(state: EditorState): TableModel | null {
  return state.field(tableContextField, false) ?? null;
}

/** CodeMirror extension that registers the detection field. */
export function tableDetectionExtension(): Extension {
  return [tableContextField];
}
