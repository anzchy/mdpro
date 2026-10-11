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
 * the plugin list) fills each empty header row in the tables the batch's doc diff
 * visits (see `changedDescendants` for what that covers) → the
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
 *   - Each added header cell copies the alignment of the first body row's cell that
 *     covers the same LOGICAL column, found through the `TableMap` (D108), so a colspan
 *     cell lends its alignment to every column it spans and the columns after it do not
 *     shift. Null when the table has no body row or that row does not reach the column.
 *     The serializer takes a table's column alignment from its header row, so this
 *     keeps the column's delimiter.
 *   - Only header rows (a row type whose default cell is a `header_cell`) with zero
 *     cells are touched. A short header row that still has a cell is `fixTables`' job
 *     (it takes the cell type from that first cell), and a healthy table is never seen
 *     as needing anything, so ordinary typing appends no transaction.
 *   - The appended transaction carries no meta of its own: prosemirror-history folds an
 *     appended transaction into its root's event, so one undo restores the document as
 *     it was before the root change. Edit-sync classifies it like `fixTables`' own
 *     append (history-carrying).
 *   - Accepted cost of appending (D108): preset-commonmark's `syncListOrderPlugin`
 *     skips any batch holding a non-generic transaction, and an appended one always
 *     carries `appendedTransaction` meta. So when one transaction both renumbers an
 *     ordered list (deletes its first item) and empties a header, the list keeps its
 *     old labels until the next ordinary transaction. `fixTables`' own appends cause
 *     the same skip; pinned by tests/d108-header-repair-list-order.test.ts.
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
  const map = TableMap.get(table);
  if (map.width === 0) return null;
  const cells: PmNode[] = [];
  for (let col = 0; col < map.width; col += 1) {
    const cell = cellType.createAndFill({ alignment: firstBodyAlignment(table, map, col) });
    if (cell) cells.push(cell);
  }
  return cells.length > 0 ? cells : null;
}

/**
 * The alignment of the first body row's cell that covers logical column `col` (by
 * `TableMap`, so a colspan cell covers each of its columns), or null when that row does
 * not reach the column. Only called with width > 0 and an empty header, so a body row
 * exists; without one the lookup is past the map's end and also gives null.
 */
function firstBodyAlignment(table: PmNode, map: TableMap, col: number): string | null {
  // A map entry is the covering cell's offset inside the table. No cell starts at 0
  // (that is the header row's own offset), and 0 is what TableMap leaves for a column
  // no cell covers.
  const offset = map.map[map.width + col];
  if (!offset) return null;
  return (table.nodeAt(offset)?.attrs.alignment as string | undefined) ?? null;
}

type Visit = (node: PmNode, pos: number) => void;

/**
 * Call `visit` for the nodes of `cur` that are not identical (`===`) to their counterpart
 * in `old` (the same walk as prosemirror-tables' `changedDescendants`): every ancestor of
 * a change, plus the whole subtree of a node that is new or whose counterpart differs in
 * markup. Identical siblings are skipped after an identity check, not descended into.
 *
 * It is not strictly the changed path. Identity is only looked for among old siblings
 * up to index `i + 2`, so an unchanged sibling whose index fell by three or more (three
 * or more siblings deleted before it) is visited with its whole subtree; and after a
 * mismatch a node is diffed against the old sibling at the current old index, which need
 * not be its real counterpart, so more of it can be visited than changed. Visiting extra
 * nodes is harmless here (a healthy table yields no repair); what matters is that a
 * keystroke costs one root-to-leaf path plus sibling identity checks, not a full walk.
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
