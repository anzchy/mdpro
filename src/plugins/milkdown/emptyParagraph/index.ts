/**
 * @module emptyParagraph
 * Purpose: ADR-0091's empty-paragraph convention for the WYSIWYG editor (D188): an
 * empty paragraph is saved as blank lines and read back by count.
 *
 * Pipeline: `remarkBlankLineGapsPlugin` (`blankLineGaps.ts`) takes the place of the
 * preset's `remarkPreserveEmptyLinePlugin` in `src/plugins/milkdown/commonmarkPreset.ts`.
 * `emptyParagraphEdgeSerializerPlugins` (`edgeSerializer.ts`) strips leading and
 * trailing empty paragraphs on write and is registered after `commonmark` and `gfm`.
 *
 * Key decisions:
 *   - The swap keeps the reader at the preset plugin's position, so it still runs
 *     after the link-definition transformer (ADR-0094) and `remarkHTMLTransformer`.
 *   - Replaces the D192 pnpm patch of preset-commonmark 7.18.0: the narrow `<br>`
 *     reader now lives in `blankLineGaps.ts`.
 *
 * @coordinates-with src/plugins/milkdown/commonmarkPreset.ts — swaps the reader in
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use`s the edge serializer
 */
export { emptyParagraphEdgeSerializerPlugins } from "./edgeSerializer";
export { remarkBlankLineGapsPlugin } from "./blankLineGaps";
