/**
 * @module insertTable
 * Purpose: Validates dimensions and dispatches Milkdown's
 * `insertTableCommand` against the active editor. Caller surface
 * for `TableInsertModal` and (later) source-mode insertion.
 *
 * Validation: 1 ≤ rows ≤ 50, 1 ≤ cols ≤ 50 (integers). Out-of-range
 * values return false without touching the editor. The plan caps at
 * 50 to keep insertion latency reasonable for jsdom tests and to
 * discourage absurd table sizes that hurt rendering performance.
 *
 * Return value semantics: matches Milkdown's command convention.
 * `true` means the transaction was applied; `false` means either
 * input validation failed or ProseMirror's `insertTableCommand`
 * could not apply (most commonly when the cursor is inside an
 * existing table — a critical-gap regression covered by tests).
 *
 * @coordinates-with src/components/Editor/TableInsertModal/index.tsx
 * @coordinates-with src/stores/milkdownEditorStore.ts
 */

import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import { isInTable } from "@milkdown/kit/prose/tables";

interface MilkdownEditorLike {
  action: (fn: (ctx: unknown) => void) => void;
}

interface CommandsCtxLike {
  call: (key: unknown, payload?: unknown) => boolean;
}

interface ViewLike {
  state: unknown;
}

interface CtxLike {
  get: (key: unknown) => CommandsCtxLike | ViewLike;
}

const MIN_DIMENSION = 1;
const MAX_DIMENSION = 50;

function isValidDimension(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DIMENSION && value <= MAX_DIMENSION;
}

/**
 * Insert a GFM table at the current selection.
 *
 * @param editor  Milkdown editor instance (from `useEditor` or
 *                `useMilkdownEditorStore.getEditor()`).
 * @param rows    Number of body rows (the resulting GFM table has
 *                `rows + 1` total rows including the header).
 * @param cols    Number of columns.
 * @returns       `true` if the table was inserted; `false` if validation
 *                failed or the command did not apply.
 */
export function runInsertTable(
  editor: MilkdownEditorLike,
  rows: number,
  cols: number,
): boolean {
  if (!isValidDimension(rows) || !isValidDimension(cols)) {
    return false;
  }

  let applied = false;
  editor.action((ctx) => {
    const c = ctx as CtxLike;
    // Audit fix H2: insertTableCommand uses replaceSelectionWith which
    // returns true unconditionally. Pre-check via isInTable so the
    // documented "false when cursor inside an existing table" contract
    // (used by TableInsertModal to show its inline error) is enforced.
    const view = c.get(editorViewCtx) as ViewLike;
    if (isInTable(view.state as never)) {
      applied = false;
      return;
    }
    const commands = c.get(commandsCtx) as CommandsCtxLike;
    applied = commands.call(insertTableCommand.key, { row: rows, col: cols });
  });
  return applied;
}
