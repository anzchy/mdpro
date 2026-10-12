/**
 * @module tests/support/cssNamedColors
 * Purpose: finds colour literals in a CSS declaration value, for the
 * "no literal colours" guards on app stylesheets (D158, audit b70). The first
 * guard knew only `white` / `black` as names, so `color: red`,
 * `background: rebeccapurple` and `color(srgb 1 0 0)` passed it.
 *
 * Key decisions:
 *   - Names are the full CSS Color 4 named-colour list (148 names, `grey`
 *     spellings included), matched per identifier token, case-insensitively.
 *   - Custom property names (`--accent-red`) are stripped before the token scan,
 *     so a `var()` whose token name contains a colour word is not a literal.
 *   - `transparent`, `currentColor` and the CSS-wide keywords (`inherit`,
 *     `initial`, `unset`, `revert`) are not literals: they name no colour of
 *     their own and render the same in both themes. System colours (`Canvas`, …)
 *     are not in the list.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

/** CSS Color Module Level 4, §6.1 named colours. */
export const CSS_NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

/** Hex colours and every colour function, `color()` included (`color-mix()` is checked by its arguments). */
const COLOUR_SYNTAX = /#[0-9a-f]{3,8}\b|(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

/** The colour literals in one declaration value; empty when it has none. */
export function colourLiterals(value: string): string[] {
  const found = Array.from(value.matchAll(COLOUR_SYNTAX), (m) => m[0]);
  const idents = value.replace(/--[\w-]+/g, " ").match(/[a-z][\w-]*/gi) ?? [];
  for (const ident of idents) {
    if (CSS_NAMED_COLORS.has(ident.toLowerCase())) found.push(ident);
  }
  return found;
}
