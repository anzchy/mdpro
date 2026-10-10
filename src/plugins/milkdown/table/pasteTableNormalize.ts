/**
 * @module table/pasteTableNormalize
 * Purpose: End-pads every ragged table in an HTML paste before it is dispatched
 * (ADR-0067 Decision 4, D64 WI-3). HTML paste bypasses remark, so the parse-time
 * widener (`raggedTableWiden.ts`) never sees it; left alone, prosemirror-tables'
 * `fixTables` would repair the table at the row start.
 *
 * Pipeline: clipboard HTML → `transformPastedHTML` (sanitizer) → ProseMirror DOM
 * parser → `transformPasted` (this plugin) → `handlePaste` / `replaceSelection`.
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
 *   - A paste whose caret is inside a table is passed through untouched too.
 *     prosemirror-tables' `handlePaste` takes it, and its `pastedCells` already
 *     end-pads ragged rows; a slice padded here with header cells makes its
 *     `insertCells` throw against Milkdown's body-row schema
 *     (`tests/table-paste-normalize.test.ts` P-6).
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts
 * @coordinates-with src/plugins/milkdown/table/raggedTableWiden.ts
 */
import { Fragment, type Node as PmNode, Slice } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { isInTable, TableMap } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";

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

export const tablePasteNormalizePlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("MDPRO_TABLE_PASTE_NORMALIZE"),
      props: {
        transformPasted: (slice, view, plain) =>
          plain || isInTable(view.state) ? slice : normalizePastedTables(slice),
      },
    }),
);
