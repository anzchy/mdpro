/**
 * @module linkDefinitions
 * Purpose: ADR-0094's link reference definitions for the WYSIWYG editor (D194):
 * references are inlined, definitions are kept as `link_definition` blocks and
 * written back verbatim.
 *
 * Pipeline: `linkDefinitionPlugins` takes the place of preset-commonmark's
 * `remarkInlineLinkPlugin` in `src/plugins/milkdown/commonmarkPreset.ts`: the remark
 * transformer (`resolveReferences.ts`), the node schema and the stringify options
 * (`linkDefinitionNode.ts`).
 *
 * @coordinates-with src/plugins/milkdown/commonmarkPreset.ts — the composition that uses it
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { linkDefinitionSchema, linkDefinitionStringify } from "./linkDefinitionNode";
import { remarkKeepDefinitionsPlugin } from "./resolveReferences";

export { LINK_DEFINITION_NODE } from "./linkDefinitionNode";
export { remarkKeepDefinitionsPlugin } from "./resolveReferences";

/** Everything that replaces `remarkInlineLinkPlugin`, in order. */
export const linkDefinitionPlugins: MilkdownPlugin[] = [
  ...remarkKeepDefinitionsPlugin,
  ...linkDefinitionSchema,
  linkDefinitionStringify,
];
