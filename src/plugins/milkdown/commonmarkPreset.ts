/**
 * @module commonmarkPreset
 * Purpose: mdpro's preset-commonmark: the stock plugin list with two remark plugins
 * swapped, in place, for mdpro's own, and the two list schemas re-registered with a
 * boolean `spread` on write. The ONE composition the app and the test rigs `.use`, so
 * they cannot drift.
 *
 * Pipeline:
 *   - `remarkInlineLinkPlugin` → `linkDefinitionPlugins` (ADR-0094, D194): references
 *     inlined, definitions kept as `link_definition` blocks written verbatim.
 *   - `remarkPreserveEmptyLinePlugin` → `remarkBlankLineGapsPlugin` (ADR-0091, D188):
 *     blank-line gaps read as empty paragraphs. Dropping the preset plugin is what
 *     stops the `<br />` writer (the preset's paragraph serializer only writes it while
 *     that plugin's id is in ctx).
 *   - `bullet_list` / `ordered_list` → `listSpreadPlugins` (D195): tight lists are written
 *     tight. Appended last, because a schema id registered later replaces the earlier
 *     spec; `list_item` gets the same rule in emptyParagraph/edgeSerializer.ts.
 *
 * Key decisions:
 *   - Swapping in place keeps the preset's order: the definitions transformer runs
 *     where `remarkInlineLink` ran (before `remarkHTMLTransformer`), and the gap reader
 *     runs last, so a kept definition is a positioned sibling it counts.
 *   - A Milkdown upgrade must keep both swaps or re-apply them (ADR-0094 Consequences).
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use`s it before gfm
 * @coordinates-with tests/helpers/scriptedMilkdownRig.ts — `.use`s it the same way
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import {
  commonmark,
  remarkInlineLinkPlugin,
  remarkPreserveEmptyLinePlugin,
} from "@milkdown/kit/preset/commonmark";
import { remarkBlankLineGapsPlugin } from "./emptyParagraph";
import { linkDefinitionPlugins } from "./linkDefinitions";
import { listSpreadPlugins } from "./listSpread";

/** preset-commonmark with mdpro's definition, empty-line and list-spread plugins. */
export const mdproCommonmark: MilkdownPlugin[] = [
  ...commonmark.flatMap((plugin) => {
    if (plugin === remarkInlineLinkPlugin.options) return linkDefinitionPlugins;
    if (plugin === remarkInlineLinkPlugin.plugin) return [];
    if (plugin === remarkPreserveEmptyLinePlugin.options) return [...remarkBlankLineGapsPlugin];
    if (plugin === remarkPreserveEmptyLinePlugin.plugin) return [];
    return [plugin];
  }),
  ...listSpreadPlugins,
];
