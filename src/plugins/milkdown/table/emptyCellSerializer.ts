/**
 * @module table/emptyCellSerializer
 * Purpose: Serializer rule that makes an empty GFM table cell (body or header)
 * serialize as an empty mdast `tableCell`, so WYSIWYG writes a blank cell
 * instead of `<br />` (ADR-0067 Decision 3, D64 WI-1).
 *
 * Pipeline: preset-gfm's `table_cell` / `table_header` schemas are re-registered
 * through `extendSchema`; only `toMarkdown` changes. A cell whose content is
 * exactly one empty paragraph opens and closes an empty `tableCell`; every other
 * cell defers to the preset's own runner, so its output is unchanged.
 *
 * Key decisions:
 *   - The `<br />` comes from preset-commonmark's paragraph serializer, which
 *     writes any empty non-last paragraph as `<br />`. Skipping the paragraph
 *     inside the cell keeps that rule intact everywhere outside tables.
 *   - The rule applies to every empty cell, not only synthetic ones: a blank
 *     cell already in the file also comes back blank (ADR-0067 Consequences).
 *   - `extendSchema` re-registers the node under the same id; `$node` replaces
 *     the earlier spec, so this plugin must be `.use`d after `gfm`.
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — exported in `tableParityPlugins`,
 *   which MilkdownEditor.tsx registers after gfm
 * @coordinates-with src/utils/tableWiden.ts — the source-side widener whose blank cells this matches
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/kit/preset/gfm";
import type { $NodeSchema } from "@milkdown/kit/utils";

/** True when the cell holds exactly one paragraph with no content at all. */
function isEmptyTableCell(cell: PmNode): boolean {
  if (cell.childCount !== 1) return false;
  const only = cell.firstChild;
  return only !== null && only.type.name === "paragraph" && only.content.size === 0;
}

function withEmptyCellRule<Id extends "table_cell" | "table_header">(
  schema: $NodeSchema<Id>,
): MilkdownPlugin[] {
  return schema.extendSchema((prev) => (ctx) => {
    const base = prev(ctx);
    const baseRunner = base.toMarkdown.runner;
    return {
      ...base,
      toMarkdown: {
        ...base.toMarkdown,
        runner: (state, node) => {
          if (isEmptyTableCell(node)) {
            state.openNode("tableCell").closeNode();
            return;
          }
          baseRunner(state, node);
        },
      },
    };
  });
}

/** Register after `gfm` so the extended cell schemas replace the preset's. */
export const tableEmptyCellSerializerPlugin: MilkdownPlugin[] = [
  ...withEmptyCellRule(tableCellSchema),
  ...withEmptyCellRule(tableHeaderSchema),
];
