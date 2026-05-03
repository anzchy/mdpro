/**
 * @module cursorSync/tableMilkdown
 * Purpose: ProseMirror-aware capture/restore for the cross-mode table
 * cursor sync (Phase 2 WI-2.6). Pure source-side helpers and the
 * pending slot live in `./table.ts`; this file holds the bits that
 * need ProseMirror types so the source-side helpers stay
 * unit-testable in isolation.
 *
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/stores/editorStore.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 */

import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { TableCellPos } from "./table";

interface MilkdownEditorLike {
  action: (fn: (ctx: unknown) => void) => void;
}

interface CtxLike {
  get: (key: unknown) => unknown;
}

interface TableHit {
  node: ProseNode;
  pos: number;
}

/**
 * Walk the doc and return every `table` node in document order. We do
 * NOT descend into a table's subtree — once we find a table we know
 * `TableMap.get(node)` covers every cell.
 */
function findTablesInDoc(doc: ProseNode): TableHit[] {
  const out: TableHit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

/**
 * Capture (tableIndex, rowIndex, colIndex) for the cell containing the
 * current selection. Returns null when the selection is not inside
 * any table.
 */
export function captureCellFromMilkdownView(
  view: EditorView,
): TableCellPos | null {
  const tables = findTablesInDoc(view.state.doc);
  if (tables.length === 0) return null;
  const fromPos = view.state.selection.$from.pos;

  for (let i = 0; i < tables.length; i += 1) {
    const hit = tables[i];
    const tableStart = hit.pos + 1; // step past the opening table token
    const tableEnd = hit.pos + hit.node.nodeSize;
    if (fromPos < tableStart || fromPos > tableEnd) continue;

    const map = TableMap.get(hit.node);
    const relPos = fromPos - tableStart;
    let cellIndex = -1;
    for (let j = 0; j < map.map.length; j += 1) {
      if (map.map[j] > relPos) break;
      if (j === 0 || map.map[j] !== map.map[j - 1]) cellIndex = j;
    }
    if (cellIndex < 0) cellIndex = 0;
    const colIndex = cellIndex % map.width;
    const rowIndex = Math.floor(cellIndex / map.width);
    return { tableIndex: i, rowIndex, colIndex };
  }
  return null;
}

/**
 * Move the selection to the cell at (tableIndex, rowIndex, colIndex).
 * Returns true on success, false when the table or cell is no longer
 * present (the doc may have changed since capture).
 */
export function restoreCellInMilkdownView(
  view: EditorView,
  pos: TableCellPos,
): boolean {
  const tables = findTablesInDoc(view.state.doc);
  const hit = tables[pos.tableIndex];
  if (!hit) return false;
  const map = TableMap.get(hit.node);
  if (pos.rowIndex >= map.height || pos.colIndex >= map.width) return false;
  const cellIdx = pos.rowIndex * map.width + pos.colIndex;
  const cellRel = map.map[cellIdx];
  if (cellRel === undefined) return false;
  // map.map[i] is the position BEFORE the cell relative to table start.
  // tableStart (pos + 1) + cellRel = position before cell.
  // +1 again to enter the cell content. TextSelection.near snaps to a
  // valid text position inside.
  const cellOpenPos = hit.pos + 1 + cellRel + 1;
  try {
    const $cell = view.state.doc.resolve(cellOpenPos);
    const tr = view.state.tr.setSelection(TextSelection.near($cell));
    view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Editor-instance wrappers (used by editorStore at mode-toggle time)
// ---------------------------------------------------------------------------

/**
 * Capture the cell from a live Milkdown editor instance. Wraps
 * `captureCellFromMilkdownView` with the `editor.action(...)` ctx
 * dance so the store doesn't need to import ProseMirror types.
 */
export function captureCellFromMilkdownEditor(
  editor: unknown,
): TableCellPos | null {
  let captured: TableCellPos | null = null;
  try {
    (editor as MilkdownEditorLike).action((rawCtx) => {
      const ctx = rawCtx as CtxLike;
      const view = ctx.get(editorViewCtx) as EditorView;
      captured = captureCellFromMilkdownView(view);
    });
  } catch {
    return null;
  }
  return captured;
}

/**
 * Restore the cursor in a live Milkdown editor instance. Mirrors the
 * `captureCellFromMilkdownEditor` ergonomics for the inbound side.
 */
export function restoreCellInMilkdownEditor(
  editor: unknown,
  pos: TableCellPos,
): boolean {
  let applied = false;
  try {
    (editor as MilkdownEditorLike).action((rawCtx) => {
      const ctx = rawCtx as CtxLike;
      const view = ctx.get(editorViewCtx) as EditorView;
      applied = restoreCellInMilkdownView(view, pos);
    });
  } catch {
    return false;
  }
  return applied;
}
