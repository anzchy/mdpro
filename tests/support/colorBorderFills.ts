/**
 * @module tests/support/colorBorderFills
 * Purpose: the scanner behind `tests/color-border-fills.test.ts` (plan P
 * WI-3.0, hardened in WI-3.1 after audit b129). It lists every declaration
 * that paints an area with `--color-border`, i.e. uses the hairline token
 * for anything but an edge.
 *
 * Key decisions:
 * - Edges are the token's intended use and are not reported: `border*`,
 *   `outline*`, `box-shadow` and `column-rule*`. Every other property that
 *   names the token is reported (background, background-image, fill, stroke,
 *   mask, …), so a new kind of fill cannot slip past an allowlist.
 * - Custom-property aliases are followed: `--x: var(--color-border)` makes
 *   `var(--x)` a use, transitively, across the files passed as `context`.
 * - Only the exact token counts: `--color-border-subtle` is another token.
 * - Parsing (comments blanked, `@media` prefixes, multi-line values) is
 *   `parseDeclarations` from the tokenization scanner, which skips
 *   custom-property definitions, so a token file reports only rules it renders.
 */

import { blankComments, parseDeclarations, type CssDeclaration } from "./cssTokenScan";

const TOKEN = "--color-border";
const EDGE_PROPERTIES = /^(border|outline|box-shadow$|column-rule)/;

const escape = (name: string) => name.replace(/[-]/g, "\\-");
/** Matches `var(<one of names>` followed by `,` or `)`. */
const varOf = (names: ReadonlySet<string>) =>
  new RegExp(`var\\(\\s*(${[...names].map(escape).join("|")})\\s*[,)]`);

/** `--color-border` plus every custom property that resolves to it in `cssTexts`. */
export function colorBorderAliases(cssTexts: readonly string[]): Set<string> {
  const defs: Array<[string, string]> = [];
  for (const css of cssTexts) {
    for (const m of blankComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;{}]*)/g)) defs.push([m[1], m[2]]);
  }
  const names = new Set([TOKEN]);
  for (let grew = true; grew; ) {
    grew = false;
    const ref = varOf(names);
    for (const [name, value] of defs) {
      if (!names.has(name) && ref.test(value)) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/**
 * Every non-edge use of `--color-border` in `css`, in source order. Aliases
 * declared in `css` itself or in any of `context` are followed.
 */
export function colorBorderFillUses(css: string, context: readonly string[] = []): CssDeclaration[] {
  const uses = varOf(colorBorderAliases([css, ...context]));
  return parseDeclarations(css).filter((d) => !EDGE_PROPERTIES.test(d.property) && uses.test(d.value));
}
