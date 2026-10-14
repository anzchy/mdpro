/**
 * @module listSpread
 * Purpose: D195. Lists are written with the tight/loose spacing they were read with.
 * preset-commonmark@7.18.0 stores a list's `spread` attr as the string "true" /
 * "false" when it parses Markdown (and as a boolean when it parses DOM); its
 * `bullet_list` and plain `list_item` serializers hand that value to mdast as is, and
 * mdast-util-to-markdown honours only a boolean `spread` (`join.js`), so a tight list
 * gained blank lines between its items on the first save after an edit.
 *
 * Pipeline: the three list schemas' `toMarkdown` runners are replaced by ones that
 * coerce `spread` to a boolean (`isSpread`) before opening the mdast node. Parsing is
 * unchanged, so the live doc keeps the preset's attr values.
 *
 * Key decisions:
 *   - Fixed on write, where the string meets the boolean-only writer: the preset's
 *     ordered-list and task-item serializers already compare `=== "true"`, and
 *     `syncListOrderPlugin` sets `spread: "true"` itself, so the string is the
 *     preset's convention, not a stray value.
 *   - `list_item` is registered once, by emptyParagraph/edgeSerializer.ts, as
 *     `edgeStripRule(listItemSpreadRule(gfm task item))`: a schema id registered
 *     later replaces the earlier spec, so two registrations would drop one rule.
 *   - The ordered list keeps the preset's `start: 1` (renumbering is not D195).
 *
 * @coordinates-with src/plugins/milkdown/emptyParagraph/edgeSerializer.ts — registers list_item
 * @coordinates-with src/plugins/milkdown/commonmarkPreset.ts — appends `listSpreadPlugins`
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { bulletListSchema, orderedListSchema } from "@milkdown/kit/preset/commonmark";
import type { GetNodeSchema } from "@milkdown/kit/utils";
import type { JSONRecord } from "@milkdown/kit/transformer";

/** A `spread` attr as mdast wants it: only `true` and `"true"` are loose. */
export function isSpread(value: unknown): boolean {
  return value === true || value === "true";
}

/** `extendSchema` handler for `bullet_list` / `ordered_list`: write `spread` as a boolean. */
function listSpreadRule(ordered: boolean) {
  return (prev: GetNodeSchema): GetNodeSchema =>
    (ctx) => {
      const base = prev(ctx);
      return {
        ...base,
        toMarkdown: {
          ...base.toMarkdown,
          runner: (state, node) => {
            const spread = isSpread(node.attrs.spread);
            const props: JSONRecord = ordered ? { ordered, start: 1, spread } : { ordered, spread };
            state.openNode("list", undefined, props).next(node.content).closeNode();
          },
        },
      };
    };
}

/**
 * `extendSchema` handler for preset-gfm's `list_item`: write `spread` as a boolean, and a
 * task item's label, list type and checkbox as the preset does.
 */
export function listItemSpreadRule(prev: GetNodeSchema): GetNodeSchema {
  return (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      toMarkdown: {
        ...base.toMarkdown,
        runner: (state, node) => {
          const { label, listType, checked } = node.attrs;
          const spread = isSpread(node.attrs.spread);
          const props: JSONRecord =
            checked == null ? { spread } : { label, listType, spread, checked };
          state.openNode("listItem", undefined, props).next(node.content).closeNode();
        },
      },
    };
  };
}

/** The two list schemas with boolean `spread` on write. Registered after `commonmark`'s own. */
export const listSpreadPlugins: MilkdownPlugin[] = [
  ...bulletListSchema.extendSchema(listSpreadRule(false)),
  ...orderedListSchema.extendSchema(listSpreadRule(true)),
];
