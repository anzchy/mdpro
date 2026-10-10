/**
 * @module table/contextMenuDispatch
 * Purpose: Runs one WYSIWYG table action against the live editor — the
 * dispatch layer behind the table context menu and the table keyboard
 * shortcuts. Re-exported by `contextMenu.ts`.
 *
 * Pipeline: (menu) clicked position + doc captured at menu open → validate
 * against the live doc → recompute the TableContext at that position →
 * gate disabled actions → move the selection into the clicked cell →
 * `runCommandFor` (`contextMenuCommands.ts`). Without a target (keyboard
 * path) the context is recomputed at the caret.
 *
 * Key decisions:
 *   - D81: the right-clicked cell, not the caret, is the target. Browsers
 *     do not move the caret on right-click, and the commands act on the
 *     selection's table/cell, so a targeted dispatch first moves the
 *     selection into the clicked cell. The caret stays there afterwards,
 *     as if the user had left-clicked the cell and then run the action.
 *   - D81: a target captured against an older doc (the doc changed while
 *     the menu was open, e.g. an MCP edit) is refused as `stale-position`
 *     rather than remapped — the user chose a cell in a table that no
 *     longer looks the way it did.
 *   - Disabled actions (M1) are refused before the selection moves, so a
 *     refused pick leaves the caret where it was.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts
 * @coordinates-with src/plugins/milkdown/table/contextMenuCommands.ts
 * @coordinates-with src/components/Editor/TableContextMenu/index.tsx
 */

import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Node as PmNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { type Selection, TextSelection } from "@milkdown/kit/prose/state";
import { findTable, TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { TableActionId, TableContext } from "./actionDescriptors";
import { isActionDisabled } from "./actionGate";
import { type CommandsLike, runCommandFor } from "./contextMenuCommands";
import { computeTableContext } from "./tableContext";

interface MilkdownEditorLike {
  action: (fn: (ctx: unknown) => void) => void;
}

interface CtxLike {
  get: (key: unknown) => unknown;
}

/**
 * The cell a right-click chose: `pos` from `view.posAtCoords`, and the
 * `view.state.doc` it was resolved against (identity-compared at dispatch).
 */
export interface TableTarget {
  pos: number;
  doc: unknown;
}

/** Why a dispatch did not apply. */
export type TableDispatchReason =
  | "stale-position"
  | "not-in-table"
  | "disabled"
  | "declined"
  | "threw";

export interface TableDispatchResult {
  applied: boolean;
  reason?: TableDispatchReason;
}

type Resolved = { ctx: TableContext } | { reason: TableDispatchReason };

/** Selection inside cell (row, col) of the table at `$pos`: the click itself when it is inline there. */
function selectionInCell(doc: PmNode, $pos: ResolvedPos, ctx: TableContext): Selection | null {
  const table = findTable($pos);
  if (!table) return null;
  const map = TableMap.get(table.node);
  const cellPos = table.start + map.positionAt(ctx.rowIndex, ctx.colIndex, table.node);
  const cell = doc.nodeAt(cellPos);
  if (!cell) return null;
  const inCell = $pos.pos > cellPos && $pos.pos < cellPos + cell.nodeSize;
  if (inCell && $pos.parent.inlineContent) return TextSelection.create(doc, $pos.pos);
  return TextSelection.near(doc.resolve(cellPos + 1), 1);
}

/** Validate the target, gate the action there, then move the selection into the clicked cell. */
function resolveTarget(view: EditorView, id: TableActionId, target: TableTarget): Resolved {
  const { doc } = view.state;
  if (doc !== target.doc) return { reason: "stale-position" };
  if (!Number.isInteger(target.pos) || target.pos < 0 || target.pos > doc.content.size) {
    return { reason: "not-in-table" };
  }
  const $pos = doc.resolve(target.pos);
  const clicked = computeTableContext(view, $pos);
  if (!clicked) return { reason: "not-in-table" };
  if (isActionDisabled(id, clicked)) return { reason: "disabled" };

  const selection = selectionInCell(doc, $pos, clicked);
  if (!selection) return { reason: "not-in-table" };
  view.dispatch(view.state.tr.setSelection(selection));
  const fresh = computeTableContext(view);
  if (!fresh || fresh.rowIndex !== clicked.rowIndex || fresh.colIndex !== clicked.colIndex) {
    return { reason: "declined" };
  }
  return { ctx: fresh };
}

/** Recompute at the caret (keyboard path / no target). */
function resolveCaret(view: EditorView, id: TableActionId): Resolved {
  const fresh = computeTableContext(view);
  if (!fresh) return { reason: "not-in-table" };
  if (isActionDisabled(id, fresh)) return { reason: "disabled" };
  return { ctx: fresh };
}

/**
 * Dispatch the Milkdown command(s) for `id` and say why it did not apply.
 *
 * With `target` (the context menu), the action runs on the right-clicked
 * cell; a target from an older doc is refused as `stale-position`.
 * Without it, the action runs on the caret's cell (keyboard shortcuts).
 *
 * The context is always recomputed from the live view (audit fix H3);
 * `_ctx`, the menu-open snapshot, is not used for command payloads and is
 * kept for API stability. Disabled actions are refused before anything
 * runs (audit fix M1). Delete composes select-then-delete and deletes only
 * after the select produced a cell selection (audit fix H4,
 * `contextMenuCommands.ts`). Never throws: a ProseMirror/Milkdown throw is
 * reported as `threw`, since the menu must never crash the editor.
 */
export function dispatchTableActionDetailed(
  editor: MilkdownEditorLike,
  id: TableActionId,
  _ctx: TableContext,
  target?: TableTarget,
): TableDispatchResult {
  let result: TableDispatchResult = { applied: false, reason: "declined" };
  try {
    editor.action((rawCtx) => {
      const c = rawCtx as CtxLike;
      const commands = c.get(commandsCtx) as CommandsLike;
      const view = c.get(editorViewCtx) as EditorView;
      const resolved = target ? resolveTarget(view, id, target) : resolveCaret(view, id);
      if ("reason" in resolved) {
        result = { applied: false, reason: resolved.reason };
        return;
      }
      const applied = runCommandFor(id, commands, view, resolved.ctx);
      result = applied ? { applied: true } : { applied: false, reason: "declined" };
    });
  } catch {
    return { applied: false, reason: "threw" };
  }
  return result;
}

/** Boolean form of `dispatchTableActionDetailed`: true when the action applied. */
export function dispatchTableAction(
  editor: MilkdownEditorLike,
  id: TableActionId,
  ctx: TableContext,
  target?: TableTarget,
): boolean {
  return dispatchTableActionDetailed(editor, id, ctx, target).applied;
}

/**
 * Keyboard-shortcut entry point: acts on the caret's cell (no target).
 * Returns false (no-op) when the editor isn't available or the caret
 * isn't in a table — making the shortcut harmless to fire outside.
 */
export function dispatchTableActionFromKeyboard(
  editor: MilkdownEditorLike,
  id: TableActionId,
): boolean {
  let ctx: TableContext | null = null;
  try {
    editor.action((rawCtx) => {
      ctx = computeTableContext((rawCtx as CtxLike).get(editorViewCtx));
    });
  } catch {
    return false;
  }
  if (!ctx) return false;
  return dispatchTableAction(editor, id, ctx);
}
