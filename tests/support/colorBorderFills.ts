/**
 * @module tests/support/colorBorderFills
 * Purpose: the scanner behind `tests/color-border-fills.test.ts` (plan P
 * WI-3.0). It lists every declaration that paints an area with
 * `var(--color-border)`, i.e. uses the hairline token as a fill.
 *
 * Key decisions:
 * - Fill properties are `background`, `background-color` and `fill`. Borders,
 *   outlines and shadows are the token's intended use and are not reported.
 * - Only the exact token counts: `--color-border-subtle` is another token.
 * - Parsing (comments blanked, `@media` prefixes, multi-line values) is
 *   `parseDeclarations` from the tokenization scanner, so both guards read
 *   CSS the same way.
 */

import { parseDeclarations, type CssDeclaration } from "./cssTokenScan";

const FILL_PROPERTIES = new Set(["background", "background-color", "fill"]);
const COLOR_BORDER = /var\(\s*--color-border\s*[,)]/;

/** Every `var(--color-border)` used as a fill in `css`, in source order. */
export function colorBorderFillUses(css: string): CssDeclaration[] {
  return parseDeclarations(css).filter((d) => FILL_PROPERTIES.has(d.property) && COLOR_BORDER.test(d.value));
}
