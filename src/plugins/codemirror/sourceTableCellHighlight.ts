/**
 * @module sourceTableCellHighlight
 * Purpose: Highlight the active table cell in source mode (Phase 2
 * WI-2.5). Visually pairs with the WYSIWYG `selectedCell` decoration
 * from WI-1.6 so users get the same "you are here" feedback in both
 * modes.
 *
 * Implementation: ViewPlugin that recomputes a single Decoration on
 * `update.docChanged || update.selectionSet`, marking the source
 * range of the active cell with a `cm-table-active-cell` class.
 *
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.css (CSS rule)
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorState, Extension } from "@codemirror/state";
import { findCell } from "../../utils/tableParser";
import { getTableContext } from "./sourceTableDetection";

const CELL_CLASS = "cm-table-active-cell";

/**
 * Pure helper used by the ViewPlugin and tests. Returns a
 * DecorationSet containing zero or one mark — the active cell's
 * source range when the cursor is inside a table cell, empty
 * otherwise (delimiter row, outside any table, inside fence).
 */
export function computeCellHighlightDecorations(state: EditorState): DecorationSet {
  const ctx = getTableContext(state);
  if (!ctx) return Decoration.none;

  const cursor = state.selection.main.head;
  const cell = findCell(ctx, cursor);
  if (!cell) return Decoration.none;

  return Decoration.set([
    Decoration.mark({ class: CELL_CLASS }).range(cell.start, cell.end),
  ]);
}

const cellHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = computeCellHighlightDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return;
      this.decorations = computeCellHighlightDecorations(update.state);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

export function sourceTableCellHighlightExtension(): Extension {
  return [cellHighlightPlugin];
}
