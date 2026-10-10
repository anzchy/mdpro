/**
 * @module table/emptyHeaderRowRepair
 * Purpose: Refills a table header row that a transaction left with no cells (D103,
 * D100). Deleting a selection that runs from a paragraph into a table cell — Backspace,
 * Delete, the source side of a move-drag — removes every `table_header` but keeps the
 * `table_header_row`; a drop of a slice that starts in a body cell builds a table the
 * same way. prosemirror-tables' `fixTables` picks the cell type to add from the row's
 * first child: an empty header row has none, so it tries `table_cell`, which Milkdown's
 * header row (`(table_header)*`) cannot hold, and the insert lands as a new body row.
 * The header stays empty, the markdown serializer throws, and every flush and ⌘S fails.
 *
 * Pipeline: any doc-changing transaction → `appendTransaction` (this plugin, FIRST in
 * the plugin list) fills each empty header row in the tables the batch changed → the
 * other plugins' `appendTransaction`s, prosemirror-tables' `fixTables` among them, see
 * a header that has cells and repair the table by its normal rules.
 *
 * Key decisions:
 *   - Registered at the FRONT of `prosePluginsCtx`, not appended like `$prose`.
 *     `EditorState.applyTransaction` runs `appendTransaction` in plugin order, and gfm's
 *     `tableEditing` (and with it `fixTables`) is registered before the parity list.
 *     Running after it would leave the spurious body row `fixTables` already appended;
 *     running first means `fixTables` never sees the empty header.
 *   - Width is the table's `TableMap` width (the widest row, counting colspan). A table
 *     with no cell at all has width 0: it is left alone, and `fixTables` deletes it as
 *     `zero_sized` — there is no content to keep and no column count to restore.
 *   - Each added header cell copies the alignment of the first body row's cell at the
 *     same index (null when that row is shorter): the serializer takes a table's column
 *     alignment from its header row, so this keeps the column's delimiter.
 *   - Only header rows (a row type whose default cell is a `header_cell`) with zero
 *     cells are touched. A short header row that still has a cell is `fixTables`' job
 *     (it takes the cell type from that first cell), and a healthy table is never seen
 *     as needing anything, so ordinary typing appends no transaction.
 *   - The appended transaction carries no meta of its own: prosemirror-history folds an
 *     appended transaction into its root's event, so one undo restores the document as
 *     it was before the root change. Edit-sync classifies it like `fixTables`' own
 *     append (history-carrying).
 *   - Logs `editor.table.header_repair` (info, success) once per repairing pass, with
 *     `count` (tables repaired), `widths`, `trigger` (the root transaction's
 *     `uiEvent` meta — `drop` / `paste` / `cut` — or `edit` when it has none:
 *     Backspace, Delete, a programmatic dispatch) and, for a drop, `move` (the
 *     `moved` flag prosemirror-view passes to `handleDrop`).
 *   - Its only prop is a `handleDrop` that records `moved` and returns false, so it
 *     never consumes a drop; being first in the list does not change which plugin
 *     handles anything else.
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — registration
 * @coordinates-with prosemirror-tables `fixTables` (via @milkdown/preset-gfm `tableEditing`)
 */
import { prosePluginsCtx, SchemaReady } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { TableMap } from "@milkdown/kit/prose/tables";
import { loggingService } from "../../../services/loggingService";

const HEADER_REPAIR_EVENT = "editor.table.header_repair";

const headerRepairKey = new PluginKey("MDPRO_TABLE_HEADER_REPAIR");

/** The header cells to put into `table`'s empty header row, or null if it needs none. */
function missingHeaderCells(table: PmNode): PmNode[] | null {
  const header = table.firstChild;
  if (!header || header.childCount > 0) return null;
  const cellType = header.type.contentMatch.defaultType;
  if (!cellType || cellType.spec.tableRole !== "header_cell") return null;
  const { width } = TableMap.get(table);
  if (width === 0) return null;
  const firstBody = table.childCount > 1 ? table.child(1) : null;
  const cells: PmNode[] = [];
  for (let col = 0; col < width; col += 1) {
    const alignment = firstBody?.maybeChild(col)?.attrs.alignment ?? null;
    const cell = cellType.createAndFill({ alignment });
    if (cell) cells.push(cell);
  }
  return cells.length > 0 ? cells : null;
}

type Visit = (node: PmNode, pos: number) => void;

/**
 * Call `visit` for every node of `cur` that differs from `old` (the same walk as
 * prosemirror-tables' `changedDescendants`), so a keystroke costs a scan of the
 * changed path only, not the whole document.
 */
function changedDescendants(old: PmNode, cur: PmNode, offset: number, visit: Visit): void {
  const oldSize = old.childCount;
  let pos = offset;
  let j = 0;
  outer: for (let i = 0; i < cur.childCount; i += 1) {
    const child = cur.child(i);
    for (let scan = j, end = Math.min(oldSize, i + 3); scan < end; scan += 1) {
      if (old.child(scan) === child) {
        j = scan + 1;
        pos += child.nodeSize;
        continue outer;
      }
    }
    visit(child, pos);
    if (j < oldSize && old.child(j).sameMarkup(child)) {
      changedDescendants(old.child(j), child, pos + 1, visit);
    } else {
      child.nodesBetween(0, child.content.size, (n, p) => visit(n, p), pos + 1);
    }
    pos += child.nodeSize;
  }
}

/**
 * A transaction that fills every empty header row among the tables that changed
 * between `oldState` and `state`, or null when there is none.
 */
function repairEmptyHeaderRows(
  oldState: EditorState,
  state: EditorState,
): { tr: Transaction; widths: number[] } | null {
  if (oldState.doc === state.doc) return null;
  const repairs: { pos: number; cells: PmNode[] }[] = [];
  changedDescendants(oldState.doc, state.doc, 0, (node, pos) => {
    if (node.type.spec.tableRole !== "table") return;
    const cells = missingHeaderCells(node);
    if (cells) repairs.push({ pos, cells });
  });
  if (repairs.length === 0) return null;
  const tr = state.tr;
  for (const { pos, cells } of repairs) {
    // pos + 1: inside the table; + 1 again: inside its first (header) row.
    tr.insert(tr.mapping.map(pos + 2), cells);
  }
  return { tr, widths: repairs.map((r) => r.cells.length) };
}

/**
 * What caused the batch: the root transaction's `uiEvent` meta, which prosemirror-view
 * sets to `drop`, `paste` or `cut`; anything else (Backspace / Delete through the
 * keymap, a programmatic dispatch) is `edit`.
 */
function triggerOf(transactions: readonly Transaction[]): string {
  const first = transactions[0];
  const root = (first?.getMeta("appendedTransaction") as Transaction | undefined) ?? first;
  const uiEvent = root?.getMeta("uiEvent");
  return typeof uiEvent === "string" ? uiEvent : "edit";
}

function createHeaderRepairPlugin(): Plugin {
  // Whether the last drop was a move, as prosemirror-view decided it (the `moved`
  // argument of `handleDrop`). This plugin is first in the list, so its `handleDrop`
  // sees every drop before any other plugin can consume it; a drop that is then
  // refused dispatches nothing, so the value is only read for a dispatched drop.
  let lastDropMoved = false;
  return new Plugin({
    key: headerRepairKey,
    props: {
      handleDrop: (_view, _event, _slice, moved) => {
        lastDropMoved = moved;
        return false;
      },
    },
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const repair = repairEmptyHeaderRows(oldState, state);
      if (!repair) return null;
      const trigger = triggerOf(transactions);
      loggingService.logEventSync({
        level: "info",
        event: HEADER_REPAIR_EVENT,
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          count: repair.widths.length,
          widths: repair.widths,
          trigger,
          ...(trigger === "drop" ? { move: lastDropMoved } : {}),
        },
      });
      return repair.tr;
    },
  });
}

/**
 * The Milkdown plugin. Unlike `$prose`, it puts its ProseMirror plugin at the front of
 * `prosePluginsCtx`, so its `appendTransaction` runs before `fixTables`'.
 */
export const tableHeaderRepairPlugin: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady);
  const plugin = createHeaderRepairPlugin();
  ctx.update(prosePluginsCtx, (plugins) => [plugin, ...plugins]);
  return () => {
    ctx.update(prosePluginsCtx, (plugins) => plugins.filter((p) => p !== plugin));
  };
};
