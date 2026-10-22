/**
 * Purpose: keep Milkdown table navigation commands together, including the
 * code-block and IME guards that decide whether the table owns a key.
 *
 * @coordinates-with typoraKeymapPlugin.ts
 */
import { commandsCtx } from "@milkdown/kit/core";
import {
  addRowAfterCommand,
  exitTable,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
} from "@milkdown/kit/preset/gfm";
import { isInTable } from "@milkdown/kit/prose/tables";
import type { Command } from "@milkdown/kit/prose/state";

type EditorStateLike = Parameters<Command>[0];
type MilkdownCtx = {
  get: (key: typeof commandsCtx) => {
    call: (key: typeof goToNextTableCellCommand.key) => boolean;
  };
};

/** Let a table handle Tab or Escape only outside code blocks and IME composition. */
function isTableTabHandlerEligible(
  state: EditorStateLike,
  view: Parameters<Command>[2],
): boolean {
  if (view?.composing) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "code_block") return false;
  }
  return isInTable(state);
}

/** Move to the next table cell, adding a row at the end when needed. */
export function makeTableTabCommand(ctx: MilkdownCtx): Command {
  const commands = ctx.get(commandsCtx);
  return (state, _dispatch, view) => {
    if (!isTableTabHandlerEligible(state, view)) return false;
    if (commands.call(goToNextTableCellCommand.key)) return true;
    return commands.call(addRowAfterCommand.key) && commands.call(goToNextTableCellCommand.key);
  };
}

/** Move to the previous table cell. */
export function makeTableShiftTabCommand(ctx: MilkdownCtx): Command {
  const commands = ctx.get(commandsCtx);
  return (state, _dispatch, view) => {
    if (!isTableTabHandlerEligible(state, view)) return false;
    return commands.call(goToPrevTableCellCommand.key);
  };
}

/** Leave the table when Escape belongs to a cell. */
export function makeTableExitCommand(ctx: MilkdownCtx): Command {
  const commands = ctx.get(commandsCtx);
  return (state, _dispatch, view) => {
    if (!isTableTabHandlerEligible(state, view)) return false;
    return commands.call(exitTable.key);
  };
}
