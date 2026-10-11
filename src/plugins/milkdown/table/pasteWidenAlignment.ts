/**
 * @module table/pasteWidenAlignment
 * Purpose: Keeps a cell paste that grows the host table from inventing a column
 * alignment (D135). prosemirror-tables' `handlePaste` → `insertCells` →
 * `growTable` fills every added column and row with `createAndFill()`, i.e. the
 * schema default `alignment: "left"`, and the serializer reads a table's column
 * alignment from its header row — so a widening paste wrote `| -- | -- | :- |`.
 *
 * Pipeline: paste → this plugin's `handlePaste` (front of `prosePluginsCtx`, ahead
 * of gfm's `tableEditing`) → prosemirror-tables' own `handlePaste`, given the view
 * with a wrapped `dispatch` → `resetGrownAlignment` rewrites the cells `growTable`
 * created on that one transaction → `view.dispatch`.
 *
 * Key decisions:
 *   - Tied to the paste, not an `appendTransaction`: only the transaction
 *     prosemirror-tables builds for this paste is touched, so Insert Table, the
 *     context menu's add column / add row and MCP table actions keep the schema
 *     default (D99 kept it `left` for them on purpose).
 *   - The schema default is not changed, for the same reason.
 *   - A grown cell is one outside the host's old width or height and outside the
 *     pasted rectangle, which `insertCells` leaves as the transaction's
 *     `CellSelection`. Cells the paste wrote keep the alignment they were pasted
 *     with.
 *   - A cell in an added column gets `null` (no colon), header and body alike. A
 *     cell in an added row under an existing column takes that column's header
 *     alignment, as preset-gfm's `addRowWithAlignment` does. Body alignment never
 *     serializes; this only keeps the editor matching what a reload would show.
 *   - prosemirror-tables' `handlePaste` runs once: when it takes the paste this
 *     plugin returns true and `tableEditing`'s copy never runs; when it declines,
 *     it dispatched nothing, and `tableEditing`'s copy declines the same way.
 *   - A paste `pasteRefusal` would refuse (D83 / D136) is declined before
 *     prosemirror-tables sees it. This plugin and `pasteRefusalGuard` both sit at
 *     the front of `prosePluginsCtx`, so either may run first; declining keeps the
 *     guard's refusal in force either way, instead of letting prosemirror-tables
 *     drop the content over a CellSelection.
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — registration
 * @coordinates-with src/plugins/milkdown/table/pasteTableNormalize.ts — `pasteRefusal`; runs after this on a paste tables declines
 * @coordinates-with src/plugins/milkdown/table/pasteRefusalGuard.ts — refuses what this declines
 * @coordinates-with prosemirror-tables `handlePaste` / `insertCells` / `growTable`
 */
import { prosePluginsCtx, SchemaReady } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import {
  CellSelection,
  handlePaste as tablesHandlePaste,
  isInTable,
  type Rect,
  TableMap,
} from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../../../services/loggingService";
import { pasteRefusal } from "./pasteTableNormalize";

export const PASTE_WIDENED_EVENT = "editor.table.paste-widened";

/** What `resetGrownAlignment` did to one paste transaction. */
export interface GrownAlignmentReset {
  fromColCount: number;
  toColCount: number;
  fromRowCount: number;
  toRowCount: number;
  /** Cells whose alignment was rewritten. */
  cells: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The header row's alignment for logical column `col` (`null` when unset). */
function headerAlignment(table: PmNode, map: TableMap, col: number): string | null {
  return (table.nodeAt(map.map[col])?.attrs.alignment as string | null | undefined) ?? null;
}

/**
 * Rewrite, on `tr`, the alignment of every cell prosemirror-tables' `growTable`
 * added for this paste: `null` in an added column, the column's header alignment
 * in an added row. Returns null when the paste did not grow the table.
 */
export function resetGrownAlignment(tr: Transaction): GrownAlignmentReset | null {
  const sel = tr.selection;
  if (!(sel instanceof CellSelection)) return null;
  const start = sel.$anchorCell.start(-1);
  const table = sel.$anchorCell.node(-1);
  // insertCells edits only inside the table, so it starts at the same position before.
  const old = tr.before.nodeAt(start - 1);
  if (!old || old.type !== table.type) return null;
  const oldMap = TableMap.get(old);
  const map = TableMap.get(table);
  if (map.width <= oldMap.width && map.height <= oldMap.height) return null;
  const pasted = map.rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
  let cells = 0;
  for (const offset of new Set(map.map)) {
    const rect = map.findCell(offset);
    const addedColumn = rect.left >= oldMap.width;
    if ((!addedColumn && rect.top < oldMap.height) || overlaps(rect, pasted)) continue;
    const alignment = addedColumn ? null : headerAlignment(table, map, rect.left);
    const cell = table.nodeAt(offset);
    if (!cell || cell.attrs.alignment === alignment) continue;
    tr.setNodeMarkup(start + offset, null, { ...cell.attrs, alignment });
    cells += 1;
  }
  return {
    fromColCount: oldMap.width,
    toColCount: map.width,
    fromRowCount: oldMap.height,
    toRowCount: map.height,
    cells,
  };
}

/** Reset the grown cells' alignment, log it when anything changed, then dispatch. */
function dispatchWithReset(view: EditorView, tr: Transaction): void {
  const reset = resetGrownAlignment(tr);
  if (reset && reset.cells > 0) {
    loggingService.logEventSync({
      level: "info",
      event: PASTE_WIDENED_EVENT,
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { ...reset },
    });
  }
  view.dispatch(tr);
}

/** The ProseMirror plugin: prosemirror-tables' paste, with the reset on its dispatch. */
export function createPasteWidenAlignmentPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("MDPRO_TABLE_PASTE_WIDEN_ALIGNMENT"),
    props: {
      handlePaste: (view, event, slice) => {
        if (!isInTable(view.state)) return false;
        // A paste the D83 / D136 guard refuses must never reach prosemirror-tables:
        // decline it, so the guard refuses it whichever of the two runs first.
        if (pasteRefusal(view.state, slice) !== null) return false;
        // `handlePaste` reads only `state` and `dispatch`; the rest is the real view.
        const wrapped: EditorView = Object.create(view);
        wrapped.dispatch = (tr: Transaction) => dispatchWithReset(view, tr);
        return tablesHandlePaste(wrapped, event, slice);
      },
    },
  });
}

/**
 * The Milkdown plugin. Puts its ProseMirror plugin at the front of
 * `prosePluginsCtx`, so its `handlePaste` runs before gfm's `tableEditing`'s.
 */
export const tablePasteWidenAlignmentPlugin: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady);
  const plugin = createPasteWidenAlignmentPlugin();
  ctx.update(prosePluginsCtx, (plugins) => [plugin, ...plugins]);
  return () => {
    ctx.update(prosePluginsCtx, (plugins) => plugins.filter((p) => p !== plugin));
  };
};
