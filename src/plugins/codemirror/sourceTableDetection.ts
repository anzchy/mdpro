/**
 * @module sourceTableDetection
 * Purpose: Detect when the cursor is inside a GFM table in source mode
 * (Phase 2 WI-2.2). Wraps the pure `tableParser` in a CodeMirror
 * StateField so downstream plugins (Tab nav, source-mode context
 * menu, cell highlight) read a single cached value instead of
 * re-parsing on every event.
 *
 * Fence guard: positions inside ` ``` ` / ` ~~~ ` blocks return null,
 * so the parser never sees pipe-runs that are actually code content.
 *
 * Performance: re-parses on `transaction.docChanged ||
 * transaction.selection` — i.e. on every cursor move. Since Phase 4
 * WI-3B the parse runs over the editor's own rope via `linesFromText`,
 * so it neither copies the document into a string nor splits it: only
 * the lines of the candidate run around the cursor are ever read, each
 * as an O(log n) rope lookup. The cost therefore tracks the size of the
 * run the cursor is in, not the size of the document. (Before WI-3B
 * this was `splitLines` over a freshly materialised copy of the whole
 * document, on every keystroke — which is what made multi-MB documents
 * unusable.) Nothing is cached across transactions and nothing should
 * be — the adapter is per-call, and a cache keyed on anything but the
 * exact `Text` instance would retain superseded document states.
 *
 * @coordinates-with src/utils/tableParser
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/codemirror/sourceTableCellHighlight.ts
 */

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { TableModel } from "../../utils/tableParser";
import { parseTableAtOffset } from "../../utils/tableParser/parse";
import { linesFromText } from "./textLineSource";

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
  return parseTableAtOffset(linesFromText(state.doc), cursor);
}

/** Returns the active TableModel for the cursor (null if not in a table). */
export function getTableContext(state: EditorState): TableModel | null {
  return state.field(tableContextField, false) ?? null;
}

/** CodeMirror extension that registers the detection field. */
export function tableDetectionExtension(): Extension {
  return [tableContextField];
}
