/**
 * @module table/pasteTableNormalize
 * Purpose: End-pads every ragged table in an HTML paste before it is dispatched
 * (ADR-0067 Decision 4, D64 WI-3). HTML paste bypasses remark, so the parse-time
 * widener (`raggedTableWiden.ts`) never sees it; left alone, prosemirror-tables'
 * `fixTables` would repair the table at the row start. Also refuses a
 * table-carrying paste (D83, D136) or drop (D90 / D94 / D102) that would split
 * the host table or be dropped by a cell selection.
 *
 * Pipeline: clipboard HTML → `transformPastedHTML` (sanitizer) → ProseMirror DOM
 * parser → `transformPasted` (this plugin: end-pad) → `handlePaste` (the front
 * guard `pasteRefusalGuard.ts` asks `pasteRefusal` and refuses, then
 * prosemirror-tables) → `replaceSelection`. A drop: the
 * dragged slice (`transformPasted`) or the dropped HTML (parsed as above) →
 * `handleDrop` (this plugin: replay the default drop on a scratch transaction,
 * refuse if it breaks the host table) → prosemirror-view's `dropPoint` →
 * `replaceRange`.
 *
 * Key decisions:
 *   - Uses `TableMap`'s `missing` problems as the width rule, so colspan and
 *     rowspan count the way prosemirror-tables counts them. Other problems
 *     (collisions, overlong rowspans) are left to `fixTables`.
 *   - Added cells take explicit `null` alignment, like the parse-time widener,
 *     so an added column's delimiter carries no colon.
 *   - A table on an open slice edge is a fragment of a larger table; padding it
 *     would break the slice's open structure, so it is left as pasted.
 *   - Plain-text paste is passed through untouched: it becomes paragraphs and
 *     carries no table.
 *   - Inside a table, only the shapes prosemirror-tables' `handlePaste` takes
 *     itself — a CellSelection, or a slice its `pastedCells` accepts — are passed
 *     through `transformPasted` untouched. Its `pastedCells` already end-pads ragged rows, and a
 *     slice padded here with header cells makes its `insertCells` throw against
 *     Milkdown's body-row schema (`tests/table-paste-normalize.test.ts` P-6).
 *   - Any other slice carrying a table, pasted with the caret inside a table, is
 *     refused (D83): `replaceSelection` cannot put a table in a cell, so it splits
 *     the host table around the paste and `fixTables` repairs the ragged tail at
 *     the row start — values shift a column right, or an empty header row stops
 *     the document serializing. Padding the pasted table does not prevent that,
 *     so the paste is consumed with no change (a selected range is not
 *     deleted), logs `editor.table.paste` as `start` + `fail` under one actionId
 *     and toasts.
 *   - Over a CellSelection prosemirror-tables takes every paste and fits a slice
 *     `pastedCells` rejects into one cell: the table and all after it are dropped,
 *     or `insertCells` throws over a header cell (D136). A table-carrying slice
 *     there is refused too, with its own reason and copy; cells and a slice with
 *     no table are left to prosemirror-tables.
 *   - The decision is the pure `pasteRefusal`; `refuseTableBreak` refuses. Both
 *     serve `pasteRefusalGuard.ts`, which must precede gfm's `tableEditing`, so
 *     this plugin (appended after it) has no `handlePaste`.
 *   - Drag-and-drop does not pass through `handlePaste`, and prosemirror-tables
 *     has no `handleDrop`, so the same split happens on a drop (D90). `handleDrop`
 *     decides by the property itself (D102): it replays prosemirror-view's default
 *     drop on a scratch transaction — the move deletion, `dropPoint` from the
 *     pointer position (falling back to the pointer position), then
 *     `replaceRange` (`replaceRangeWith` for a closed single node) — and refuses
 *     a table-carrying slice iff the insert position lies in a table
 *     (`findTable`) and that host table does not come through intact: the result
 *     must hold exactly the tables it held plus the slice's, with the host's
 *     unchanged copy among them. A zero-sized table shell is not counted:
 *     the replace at the table's start leaves one, and `fixTables` deletes it in
 *     the same dispatch. That refuses a drop in a cell (D90) and at an
 *     interior boundary between cells or rows (D94), where the replace splits
 *     the host, but not at the table's outer-edge chain (content start, first row
 *     start, last row end, content end), where it lands beside the host. A D94
 *     rule by ancestry alone refused that chain needlessly. A replay that throws
 *     is refused too, since the default drop would throw the same way. Returning
 *     true consumes the drop, so nothing is inserted and the source of a
 *     move-drag is not deleted; it logs `editor.table.drop` the same way and toasts.
 *   - The toast is per refusal and names what is checked — the current table
 *     would be split — not "inside a table cell": a pure table pasted into a
 *     cell is taken by prosemirror-tables (D83-3), and a drop at an interior
 *     boundary is refused though it is in no cell (D91). Only the CellSelection
 *     copy names cells: nothing splits there (D136).
 *   - A paste is still decided by `isInTable` (the selection head's cell). A
 *     TextSelection whose head sits between rows would slip past it, but the view
 *     never holds one: the DOM selection read, mapping and `Selection.near` all
 *     move such a position into a cell's text, and no gapcursor plugin is
 *     registered (D102 ②, `tests/d102-table-drop-edge.test.ts`).
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts
 * @coordinates-with src/plugins/milkdown/table/pasteRefusalGuard.ts — the front `handlePaste`
 * @coordinates-with src/plugins/milkdown/table/raggedTableWiden.ts
 * @coordinates-with src/stores/toastStore.ts — refusal feedback
 */
import { Fragment, type Node as PmNode, Slice } from "@milkdown/kit/prose/model";
import { type EditorState, type NodeSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  __pastedCells,
  CellSelection,
  findTable,
  isInTable,
  TableMap,
} from "@milkdown/kit/prose/tables";
import { dropPoint } from "@milkdown/kit/prose/transform";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { loggingService } from "../../../services/loggingService";
import { useToastStore } from "../../../stores/toastStore";

/** Why a paste is refused: it would split the host table, or be dropped by a CellSelection. */
export type PasteRefusal = "paste" | "cellPaste";
type RefusalKind = PasteRefusal | "drop";

/** Per-refusal copy, reason and logged operation (`editor.table.<event>`). */
const REFUSAL: Record<RefusalKind, { event: "paste" | "drop"; toast: string; reason: string }> = {
  paste: {
    event: "paste",
    toast: "This paste would split the current table. Paste it outside the table.",
    reason: "table-carrying slice not pasted as cells would split the host table",
  },
  cellPaste: {
    event: "paste",
    toast: "A table mixed with other content can't be pasted over selected cells. Paste it outside the table.",
    reason: "table-carrying slice not pasted as cells would be dropped by the cell selection",
  },
  drop: {
    event: "drop",
    toast: "This drop would split the current table. Drop it outside the table.",
    reason: "table-carrying drop would break the host table",
  },
};

/** Append the cells TableMap reports missing to the end of each short row. */
function padTable(table: PmNode): PmNode {
  const missing = new Map<number, number>();
  for (const problem of TableMap.get(table).problems ?? []) {
    if (problem.type === "missing") {
      missing.set(problem.row, (missing.get(problem.row) ?? 0) + problem.n);
    }
  }
  if (missing.size === 0) return table;
  const rows: PmNode[] = [];
  table.forEach((row, _offset, index) => {
    const n = missing.get(index) ?? 0;
    const cellType = row.type.contentMatch.defaultType;
    const added: PmNode[] = [];
    for (let i = 0; i < n && cellType; i += 1) {
      const cell = cellType.createAndFill({ alignment: null });
      if (cell) added.push(cell);
    }
    rows.push(added.length ? row.copy(row.content.append(Fragment.from(added))) : row);
  });
  return table.copy(Fragment.from(rows));
}

/** `openStart` / `openEnd`: how deep the slice is open into this node (0 = closed). */
function mapNode(node: PmNode, openStart: number, openEnd: number): PmNode {
  if (node.type.spec.tableRole === "table") {
    return openStart === 0 && openEnd === 0 ? padTable(node) : node;
  }
  if (node.isLeaf || node.isTextblock) return node;
  const content = mapFragment(node.content, Math.max(openStart - 1, 0), Math.max(openEnd - 1, 0));
  return content === node.content ? node : node.copy(content);
}

function mapFragment(fragment: Fragment, openStart: number, openEnd: number): Fragment {
  const last = fragment.childCount - 1;
  let changed = false;
  const out: PmNode[] = [];
  fragment.forEach((child, _offset, index) => {
    const next = mapNode(child, index === 0 ? openStart : 0, index === last ? openEnd : 0);
    if (next !== child) changed = true;
    out.push(next);
  });
  return changed ? Fragment.from(out) : fragment;
}

/**
 * End-pad every closed ragged table in `slice`, at any depth. Returns the same
 * slice object when nothing needed padding.
 */
export function normalizePastedTables(slice: Slice): Slice {
  const content = mapFragment(slice.content, slice.openStart, slice.openEnd);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/** Whether prosemirror-tables' own `handlePaste` takes this paste as cells. */
function takenByTables(state: EditorState, slice: Slice): boolean {
  return (
    isInTable(state) && (state.selection instanceof CellSelection || __pastedCells(slice) !== null)
  );
}

function sliceHasTable(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (node.type.spec.tableRole === "table") found = true;
    return !found;
  });
  return found;
}

/**
 * Whether a paste of `slice` into `state` is refused, and why. Pure. Null outside a
 * table and for a slice carrying no table. Over a CellSelection, "cellPaste" unless
 * `pastedCells` takes the slice as cells (D136); elsewhere in a table, "paste"
 * unless it does (D83) — `replaceSelection` would split the host table.
 */
export function pasteRefusal(state: EditorState, slice: Slice): PasteRefusal | null {
  if (!isInTable(state) || !sliceHasTable(slice) || __pastedCells(slice) !== null) return null;
  return state.selection instanceof CellSelection ? "cellPaste" : "paste";
}

/**
 * Refuse a table-carrying paste or drop: log `editor.table.<operation>` as `start`
 * then `fail` under one actionId (rule 20) — the `fail` with the refusal's reason —
 * both with the slice's top-level node count, and show the refusal's toast.
 * Returns true, so the caller's prop consumes the event. A paste or drop that is
 * let through logs nothing.
 */
export function refuseTableBreak(kind: RefusalKind, slice: Slice): true {
  const { event: operation, toast, reason } = REFUSAL[kind];
  const event = `editor.table.${operation}`;
  const actionId = loggingService.generateActionId();
  const nodes = slice.content.childCount;
  loggingService.logEventSync({ level: "info", event, status: "start", actionId, context: { nodes } });
  loggingService.logEventSync({
    level: "warn",
    event,
    status: "fail",
    actionId,
    context: { reason, nodes },
  });
  useToastStore.getState().showToast(toast);
  return true;
}

/** Whether `fixTables` deletes this table as `zero_sized` (no cell at all). */
function isZeroSized(table: PmNode): boolean {
  return (TableMap.get(table).problems ?? []).some((problem) => problem.type === "zero_sized");
}

/**
 * Every table in `node` (not descending into a table), and how many equal
 * `host`. A zero-sized table is not counted: `fixTables` deletes it in the same
 * dispatch, as it does the empty shell a replace leaves at the table's start.
 */
function countTables(node: PmNode | Fragment, host: PmNode): { all: number; host: number } {
  const count = { all: 0, host: 0 };
  node.descendants((child) => {
    if (child.type.spec.tableRole !== "table") return true;
    if (isZeroSized(child)) return false;
    count.all += 1;
    if (child.eq(host)) count.host += 1;
    return false;
  });
  return count;
}

/**
 * Whether prosemirror-view's default drop of this table-carrying slice would
 * break the table it lands in. Replays the view's drop handler on a scratch
 * transaction: delete the move source, map `dropPoint(...) ?? pointer`, then
 * insert. No table at the insert position → false. Otherwise true unless the
 * result holds exactly the old tables plus the slice's, the host's unchanged
 * copy among them (a split adds a table and loses the host; an edit in a cell
 * loses the host). A replay that throws is true: the default drop would throw.
 */
function dropBreaksTable(view: EditorView, event: DragEvent, slice: Slice, moved: boolean): boolean {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return false;
  const { state } = view;
  const tr = state.tr;
  if (moved) {
    const source = (view.dragging as { node?: NodeSelection } | null)?.node;
    if (source) source.replace(tr);
    else tr.deleteSelection();
  }
  const pos = tr.mapping.map(dropPoint(state.doc, coords.pos, slice) ?? coords.pos);
  const host = findTable(tr.doc.resolve(pos));
  if (!host) return false;
  const before = countTables(tr.doc, host.node);
  const added = countTables(slice.content, host.node);
  const single = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1;
  try {
    if (single && slice.content.firstChild) tr.replaceRangeWith(pos, pos, slice.content.firstChild);
    else tr.replaceRange(pos, pos, slice);
  } catch {
    return true;
  }
  const after = countTables(tr.doc, host.node);
  return after.all !== before.all + added.all || after.host !== before.host + added.host;
}

export const tablePasteNormalizePlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("MDPRO_TABLE_PASTE_NORMALIZE"),
      props: {
        transformPasted: (slice, view, plain) =>
          plain || takenByTables(view.state, slice) ? slice : normalizePastedTables(slice),
        handleDrop: (view, event, slice, moved) => {
          if (!sliceHasTable(slice) || !dropBreaksTable(view, event, slice, moved)) return false;
          return refuseTableBreak("drop", slice);
        },
      },
    }),
);
