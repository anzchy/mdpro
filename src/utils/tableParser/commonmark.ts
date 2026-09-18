/**
 * @module tableParser/commonmark
 * Purpose: The two CommonMark/GFM block-level rules the table parser has
 * to defer to, extracted here so neither `lines.ts` nor `parse.ts` grows
 * past rule 50 §6. Both are pure string predicates over a single line and
 * neither knows what a table is.
 *
 * Why these two live together: they are the whole of WI-C1 + WI-C2, the
 * narrowing of mdpro's detector toward `micromark-extension-gfm-table`
 * (measured at 2.1.2 on 2026-09-17). See
 * `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` §5.1.
 *
 * Key decisions:
 *  - `countIndentColumns` is a NEW function, not a rename of
 *    `lines.ts#countLeadingSpaces`. The latter is still used by
 *    `parse.ts#parseRowCells` to derive `baseOffset`, where it must stay a
 *    CHARACTER count because it is offset arithmetic. Columns and
 *    characters differ the moment a tab appears; conflating them would
 *    shift every `TableCell.start/end`. The two notions stay separate
 *    functions on purpose — see the plan §2.3.
 *  - `isSetextUnderline` can reject unconditionally at its call site
 *    because `parseTableAtLine` only reaches it with a non-blank candidate
 *    line directly above, i.e. a paragraph line — which is exactly the
 *    precondition a setext underline needs.
 *
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/parse.ts
 */

/**
 * Indentation of `s` measured in CommonMark COLUMNS, not characters.
 *
 * A space advances one column; a tab advances to the next multiple of 4
 * (CommonMark 0.31 §2.2 "Tabs"). Stops at the first non-whitespace
 * character, so `countIndentColumns("\t| - |") === 4` — which is what
 * makes a tab-indented line an indented code block / paragraph
 * continuation rather than a table row.
 *
 * NOT interchangeable with `lines.ts#countLeadingSpaces`; see the module
 * header.
 */
export function countIndentColumns(s: string): number {
  let col = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === " ") col += 1;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/**
 * Number of leading ASCII spaces in `s` — a CHARACTER count.
 *
 * Sits next to `countIndentColumns` precisely because the two are easy to
 * confuse and must never be swapped. This one exists for
 * `parse.ts#parseRowCells`, which adds it to `LineRange.start` to get a
 * cell's absolute offset; that arithmetic is in characters, so a column
 * count there would be wrong the moment a tab appeared.
 *
 * Previously in `lines.ts`; moved here with WI-C2 so both notions of
 * "leading whitespace" are defined in one place, under one warning.
 */
export function countLeadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n += 1;
  return n;
}

/**
 * True when `text` is a setext H2 underline: a run of `-` alone on the
 * line, with optional surrounding whitespace.
 *
 * GFM resolves the collision between this and a pipe-less table delimiter
 * row in setext's favour, so `| a |` / `---` / `| b |` is an `<h2>`
 * followed by a paragraph and yields ZERO tables — measured against
 * `micromark-extension-gfm-table@2.1.2` on 2026-09-17.
 *
 * The rule only bites on a SINGLE-COLUMN header: a pipe-less line splits
 * into exactly one cell, so a 2+-column header already fails the
 * column-count check in `parse.ts`. Delimiters carrying a colon (`:-:`,
 * `--:`, `:--`) are real GFM delimiters, do not match here, and are
 * unaffected.
 */
export function isSetextUnderline(text: string): boolean {
  return /^\s*-+\s*$/.test(text);
}
