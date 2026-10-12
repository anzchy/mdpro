/**
 * @module tests/support/upstreamTableSchema
 * Purpose: a bare prosemirror-tables schema and cell builders for the D162-WI-3
 * upstream reproductions, which call `__clipCells` / `__insertCells` directly,
 * with no Milkdown editor. Not a `*.test.ts`, so vitest does not collect it.
 */
import { Fragment, type Node as PmNode, Schema } from "@milkdown/kit/prose/model";
import { type Rect, TableMap, tableNodes } from "@milkdown/kit/prose/tables";

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    text: {},
    ...tableNodes({ tableGroup: "block", cellContent: "paragraph+", cellAttributes: {} }),
  },
});

/** A body cell holding `text`, spanning `rowspan` × `colspan`. */
export function cell(text: string, rowspan = 1, colspan = 1): PmNode {
  const para = schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  return schema.nodes.table_cell.create({ rowspan, colspan, colwidth: null }, para);
}

/** A row fragment of `cells`. */
export const row = (...cells: PmNode[]): Fragment => Fragment.from(cells);

/** A `width` × `height` table of plain cells named r{row}c{col}, 0-based. */
export function hostTable(width: number, height: number): PmNode {
  const rows = Array.from({ length: height }, (_, r) =>
    schema.nodes.table_row.create(
      null,
      Array.from({ length: width }, (_, c) => cell(`r${r}c${c}`)),
    ),
  );
  return schema.nodes.table.create(null, rows);
}

/** A table built from cell rows; returns its map's problems (null when sound). */
export function problemsOf(rows: readonly Fragment[]): unknown {
  const table = schema.nodes.table.create(
    null,
    rows.map((r) => schema.nodes.table_row.create(null, r)),
  );
  return TableMap.get(table).problems ?? null;
}

/** The text of the cell covering each slot outside `rect`, keyed `row,col`. */
export function slotsOutside(table: PmNode, rect: Rect): Map<string, string> {
  const map = TableMap.get(table);
  const out = new Map<string, string>();
  for (let r = 0; r < map.height; r += 1) {
    for (let c = 0; c < map.width; c += 1) {
      if (r >= rect.top && r < rect.bottom && c >= rect.left && c < rect.right) continue;
      out.set(`${r},${c}`, table.nodeAt(map.map[r * map.width + c])?.textContent ?? "");
    }
  }
  return out;
}
