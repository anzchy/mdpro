/**
 * @module tests/support/colorBorderFills
 * Purpose: the scanner behind `tests/color-border-fills.test.ts` (plan P
 * WI-3.0, hardened in WI-3.1 after audit b129). It lists every declaration
 * that paints an area with `--color-border`, i.e. uses the hairline token
 * for anything but an edge.
 *
 * Key decisions:
 * - Edges are the token's intended use and are not reported: `border*`
 *   (except `border-image*`, which paints an image and with `fill` the whole
 *   box), `outline*`, `box-shadow` and `column-rule*`. Every other property
 *   that names the token is reported (background, background-image, fill,
 *   stroke, mask, …), so a new kind of fill cannot slip past an allowlist.
 * - `var(` matches case-insensitively but the property name does not:
 *   `--COLOR-BORDER` is another custom property (audit b136). Quoted strings
 *   (with backslash escapes, a backslash-newline included) and unquoted
 *   `url()` bodies are blanked before matching, so `content:
 *   "var(--color-border)"` and `url(x#var(--color-border))` are text, not
 *   uses, and a `;` or an escaped `)` inside them does not end an alias's
 *   value (audits b134, b136, b138).
 * - Custom-property aliases are followed: `--x: var(--color-border)` makes
 *   `var(--x)` a use, transitively, across the files passed as `context`.
 * - Only the exact token counts: `--color-border-subtle` is another token.
 * - Parsing (comments blanked, `@media` prefixes, multi-line values) is
 *   `parseDeclarations` from the tokenization scanner, which skips
 *   custom-property definitions, so a token file reports only rules it renders.
 */

import { blankComments, parseDeclarations, type CssDeclaration } from "./cssTokenScan";

const TOKEN = "--color-border";
const EDGE_PROPERTIES = /^(border(?!-image)|outline|box-shadow$|column-rule)/;
/** A quoted string, honouring backslash escapes (a backslash-newline continues it). */
const STRING = String.raw`"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'`;
/** An unquoted `url(…)`, whose body may hold `;` (a `data:` URL) or an escaped `\)`. */
const BARE_URL = String.raw`url\((?:[^)"'\\]|\\[\s\S])*\)`;
/**
 * A custom-property definition; its value may contain quoted strings or an
 * unquoted `url()` with `;`, `{` or `}` inside.
 */
const CUSTOM_PROPERTY = new RegExp(String.raw`(--[\w-]+)\s*:\s*((?:${STRING}|${BARE_URL}|[^;{}"'])*)`, "gi");

/** `value` with the contents of every quoted string and unquoted `url()` blanked. */
const unquote = (value: string) =>
  value.replace(new RegExp(STRING, "g"), '""').replace(new RegExp(BARE_URL, "gi"), "url()");

const escape = (name: string) => name.replace(/[-]/g, "\\-");
/** Matches `var(<one of names>` followed by `,` or `)`; `var` in any case, the name exactly. */
const varOf = (names: ReadonlySet<string>) =>
  new RegExp(`[vV][aA][rR]\\(\\s*(${[...names].map(escape).join("|")})\\s*[,)]`);

/** `--color-border` plus every custom property that resolves to it in `cssTexts`. */
export function colorBorderAliases(cssTexts: readonly string[]): Set<string> {
  const defs: Array<[string, string]> = [];
  for (const css of cssTexts) {
    for (const m of blankComments(css).matchAll(CUSTOM_PROPERTY)) defs.push([m[1], unquote(m[2])]);
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
  return parseDeclarations(css).filter((d) => !EDGE_PROPERTIES.test(d.property) && uses.test(unquote(d.value)));
}
