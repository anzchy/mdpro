/**
 * @module emptyParagraph
 * Purpose: ADR-0091's empty-paragraph convention for the WYSIWYG editor (D188): an
 * empty paragraph is saved as blank lines and read back by count.
 *
 * Pipeline: `commonmarkWithBlankLineGaps` is preset-commonmark's plugin list with
 * `remarkPreserveEmptyLinePlugin` swapped, in place, for our reader
 * (`blankLineGaps.ts`). Dropping the preset plugin is what stops the `<br />`
 * writer: the preset's paragraph serializer only writes `<br />` while that
 * plugin's id is in ctx. `emptyParagraphEdgeSerializerPlugins` (`edgeSerializer.ts`)
 * strips leading and trailing empty paragraphs on write and is registered after
 * `commonmark` and `gfm`.
 *
 * Key decisions:
 *   - The swap keeps the reader at the preset plugin's position, so it still runs
 *     after `remarkInlineLink` and `remarkHTMLTransformer`.
 *   - Replaces the D192 pnpm patch of preset-commonmark 7.18.0: the narrow `<br>`
 *     reader now lives in `blankLineGaps.ts`.
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use`s both lists
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { commonmark, remarkPreserveEmptyLinePlugin } from "@milkdown/kit/preset/commonmark";
import { remarkBlankLineGapsPlugin } from "./blankLineGaps";

export { emptyParagraphEdgeSerializerPlugins } from "./edgeSerializer";
export { remarkBlankLineGapsPlugin } from "./blankLineGaps";

/** preset-commonmark with the `<br />` empty-line plugin replaced by our reader. */
export const commonmarkWithBlankLineGaps: MilkdownPlugin[] = commonmark.flatMap((plugin) => {
  if (plugin === remarkPreserveEmptyLinePlugin.options) return [...remarkBlankLineGapsPlugin];
  if (plugin === remarkPreserveEmptyLinePlugin.plugin) return [];
  return [plugin];
});
