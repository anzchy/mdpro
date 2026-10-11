/**
 * @module table/emptyCellSerializer
 * Purpose: Serializer rule that makes an empty GFM table cell (body or header)
 * serialize as an empty mdast `tableCell`, so WYSIWYG writes a blank cell
 * instead of `<br />` (ADR-0067 Decision 3, D64 WI-1).
 *
 * Pipeline: preset-gfm's `table_cell` / `table_header` schemas are re-registered
 * through `extendSchema`; this rule changes only `toMarkdown`. A cell whose content is
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
 *     the earlier spec, so the extended schemas must be `.use`d after `gfm`.
 *   - Each `extendSchema` starts from the preset's spec, not from an earlier
 *     extension, so the rule is exported as a handler (`emptyCellRule`) and
 *     `parityPlugins.ts` composes it with the D99 alignment DOM rule
 *     (`cellAlignmentDom.ts`) in one extension per cell schema.
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — composes `emptyCellRule` into the
 *   cell schemas in `tableParityPlugins`, which MilkdownEditor.tsx registers after gfm
 * @coordinates-with src/plugins/milkdown/table/cellAlignmentDom.ts — the other rule on the same schemas
 * @coordinates-with src/utils/tableWiden.ts — the source-side widener whose blank cells this matches
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/kit/preset/gfm";
import type { GetNodeSchema } from "@milkdown/kit/utils";

/** True when the cell holds exactly one paragraph with no content at all. */
function isEmptyTableCell(cell: PmNode): boolean {
  if (cell.childCount !== 1) return false;
  const only = cell.firstChild;
  return only !== null && only.type.name === "paragraph" && only.content.size === 0;
}

/**
 * `extendSchema` handler for `table_cell` / `table_header`: replaces only
 * `toMarkdown`, so an empty cell serializes as an empty `tableCell`.
 */
export function emptyCellRule(prev: GetNodeSchema): GetNodeSchema {
  return (ctx) => {
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
  };
}

/**
 * This rule alone on both cell schemas, for a harness that tests it in isolation
 * (`tests/table-empty-cell-serialize.test.ts`). The app registers the composed
 * cell schemas from `parityPlugins.ts` instead; using both would let the later one
 * replace the other. Register after `gfm` so it replaces the preset's schemas.
 */
export const tableEmptyCellSerializerPlugin: MilkdownPlugin[] = [
  ...tableCellSchema.extendSchema(emptyCellRule),
  ...tableHeaderSchema.extendSchema(emptyCellRule),
];
