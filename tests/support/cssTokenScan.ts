/**
 * @module tests/support/cssTokenScan
 * Purpose: the scanner behind `tests/css-tokenization.test.ts` (plan P
 * WI-2.1). It walks CSS text and reports every declaration that breaks the A5
 * definition of "100% tokenized" (`baseline-protocol.md` § Definition):
 * colour literals, chrome font sizes, font families, radii, motion, z-index
 * and icon sizes that do not go through `var(--…)`.
 *
 * Key decisions:
 * - One finding per declaration, not per literal: the deferred list and the
 *   exception list are keyed by declaration (file, selector, property,
 *   value), so `transition: a 0.15s ease, b 0.15s ease` is one finding.
 * - Comments are blanked to spaces (newlines kept) before parsing, so line
 *   numbers stay true and a literal inside a comment is never a finding.
 * - `var(--x, fallback)` fallbacks are dropped before the colour check when
 *   `--x` is declared (rule 31: defensive fallbacks are allowed). When `--x`
 *   is declared nowhere the fallback is what renders, so it is a finding.
 *   `color-mix()` is scanned like any other value, so a literal argument
 *   inside it is a finding.
 * - A literal colour declaration directly followed, in the same block, by
 *   the same property set through `color-mix()` is the rule 31 browser
 *   fallback and is allowed.
 * - A `font` shorthand passes only when its size and its family are each a
 *   `var()`, and a whole-value `var(--x, fallback)` counts as a token only
 *   when `--x` is declared (audit b125).
 * - Pure functions over strings; the test supplies file contents.
 */

/** One CSS declaration, with the line its property name starts on. */
export interface CssDeclaration {
  line: number;
  /** Innermost rule selector, prefixed by enclosing at-rules (`@media … > sel`). */
  selector: string;
  property: string;
  /** The value, whitespace collapsed, without `!important`'s surrounding space changes. */
  value: string;
}

/** A declaration the A5 definition does not allow, with the category it broke. */
export interface CssFinding extends CssDeclaration {
  category: "colour" | "font-size" | "font-family" | "radius" | "motion" | "z-index" | "icon-size";
}

/** z-index values in rule 31 § Z-index hierarchy. */
export const RULE31_Z_INDEX = new Set(["auto", "20", "30", "1000", "9999"]);

/** Radius values that need no token: rule 31 allowlist plus the DR23 pill. */
const ALLOWED_RADIUS = new Set(["0", "50%", "999px", "inherit", "initial", "unset"]);

const KEYWORDS_OK = new Set(["inherit", "initial", "unset", "none", "transparent", "currentcolor"]);

/** CSS Color 4 named colours, lower case. */
const NAMED_COLOURS = new Set(
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

const COLOUR_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline",
  "outline-color",
  "fill",
  "stroke",
  "box-shadow",
  "caret-color",
  "text-decoration-color",
  "text-decoration",
]);

const RADIUS_PROPERTIES = /^border(-(top|bottom)-(left|right))?-radius$/;
const MOTION_PROPERTIES = new Set([
  "transition",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
  "animation",
  "animation-duration",
  "animation-timing-function",
  "animation-delay",
]);

/** Selectors whose `em` / `%` font sizes are editor content (A5). */
const CONTENT_SELECTOR = /\.ProseMirror|\.cm-content|\.cm-line/;

/** Replace every comment with spaces, keeping newlines. */
export function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

/** Every declaration in `css`, in source order. */
export function parseDeclarations(css: string): CssDeclaration[] {
  const text = blankComments(css);
  const out: CssDeclaration[] = [];
  const stack: string[] = [];
  let buf = "";
  let bufLine = 1;
  let line = 1;
  let parens = 0;
  let quote: string | null = null;

  const flushDecl = () => {
    const raw = buf;
    buf = "";
    const colon = raw.indexOf(":");
    if (colon < 0 || stack.length === 0) return;
    const property = raw.slice(0, colon).trim().toLowerCase();
    if (!/^-?[a-z][a-z0-9-]*$/.test(property)) return;
    const value = raw.slice(colon + 1).replace(/\s+/g, " ").trim();
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const declLine = bufLine + (lead.match(/\n/g)?.length ?? 0);
    const rules = stack.filter((s) => !s.startsWith("@"));
    const ats = stack.filter((s) => s.startsWith("@"));
    const selector = [...ats, rules[rules.length - 1] ?? ""].filter(Boolean).join(" > ");
    out.push({ line: declLine, selector, property, value });
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (buf === "") bufLine = line;
    if (ch === "\n") line += 1;
    // A backslash escapes the next character, newline included, in or out of a
    // string, so `"a\\"` closes and `url(a\))` does not end at `\)` (audit b138).
    if (ch === "\\" && i + 1 < text.length) {
      if (text[i + 1] === "\n") line += 1;
      buf += ch + text[i + 1];
      i += 1;
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") parens += 1;
    if (ch === ")") parens -= 1;
    if (parens > 0) {
      buf += ch;
      continue;
    }
    if (ch === "{") {
      stack.push(buf.replace(/\s+/g, " ").trim());
      buf = "";
    } else if (ch === "}") {
      if (buf.trim()) flushDecl();
      buf = "";
      stack.pop();
    } else if (ch === ";") {
      if (stack.length === 0) buf = "";
      else flushDecl();
    } else {
      buf += ch;
    }
  }
  return out;
}

/**
 * `value` with every `var(--x, fallback)` reduced to `var(--x)`. With
 * `declared`, a fallback is kept when `--x` is not in it, since that
 * fallback is what renders.
 */
export function dropVarFallbacks(value: string, declared?: ReadonlySet<string>): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    let depth = 0;
    let j = at + 3;
    let comma = -1;
    for (; j < value.length; j += 1) {
      if (value[j] === "(") depth += 1;
      else if (value[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      } else if (value[j] === "," && depth === 1 && comma < 0) comma = j;
    }
    const name = value.slice(at + 4, comma < 0 ? j : comma).trim();
    const keep = comma < 0 || (declared !== undefined && !declared.has(name));
    out += keep ? value.slice(at, j + 1) : `${value.slice(at, comma)})`;
    i = j + 1;
  }
  return out;
}

/** True when the value carries a colour literal outside `var()` fallbacks. */
export function hasColourLiteral(value: string, declared?: ReadonlySet<string>): boolean {
  const v = dropVarFallbacks(value, declared).replace(/var\(--[\w-]+\)/g, " ");
  if (/#[0-9a-fA-F]{3,8}\b/.test(v)) return true;
  if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(v)) return true;
  return v
    .toLowerCase()
    .split(/[^a-z-]+/)
    .some((word) => NAMED_COLOURS.has(word));
}

/**
 * True when the value is a keyword or one `var()`. A fallback counts only
 * when its token is declared: otherwise the fallback is what renders.
 */
function onlyVarOrKeyword(value: string, declared?: ReadonlySet<string>): boolean {
  const v = value.replace(/!important/i, "").trim();
  if (KEYWORDS_OK.has(v.toLowerCase())) return true;
  const m = /^var\((--[\w-]+)\s*(,.*)?\)$/.exec(v);
  if (!m) return false;
  return m[2] === undefined || declared === undefined || declared.has(m[1]);
}

/**
 * Why a `font` shorthand breaks A5, or null. Its size and its family are
 * checked separately: each must be a `var()` (audit b125).
 */
function fontShorthand(value: string, selector: string, declared?: ReadonlySet<string>): CssFinding["category"] | null {
  if (onlyVarOrKeyword(value, declared)) return null;
  const vars: string[] = [];
  const v = value.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, (m) => {
    vars.push(m);
    return `\u0000${vars.length - 1}\u0000`;
  });
  const isVar = (t: string) => /^\u0000\d+\u0000$/.test(t) && onlyVarOrKeyword(vars[Number(t.slice(1, -1))], declared);
  const tokens = v.trim().split(/\s+/);
  const at = tokens.findIndex((t) => /^(\u0000\d+\u0000|[\d.]+[a-z%]+)(\/\S+)?$/i.test(t));
  if (at < 0) return "font-family";
  const size = tokens[at].split("/")[0];
  const sizeOk = isVar(size) || (/^[\d.]+(em|%)$/.test(size) && CONTENT_SELECTOR.test(selector));
  if (!sizeOk) return "font-size";
  const family = tokens.slice(at + 1).join(" ");
  return isVar(family) || family.toLowerCase() === "inherit" ? null : "font-family";
}

/** Why a declaration breaks A5, or null when it is allowed. */
export function categorize(
  decl: CssDeclaration,
  declared?: ReadonlySet<string>,
): CssFinding["category"] | null {
  const { property, selector } = decl;
  const value = decl.value.replace(/\s*!important$/i, "");
  if (COLOUR_PROPERTIES.has(property) && hasColourLiteral(value, declared)) return "colour";
  if (property === "font-size") {
    if (onlyVarOrKeyword(value, declared)) return null;
    if (/^[\d.]+(em|%)$/.test(value) && CONTENT_SELECTOR.test(selector)) return null;
    return "font-size";
  }
  if (property === "font-family") return onlyVarOrKeyword(value, declared) ? null : "font-family";
  if (property === "font") return fontShorthand(value, selector, declared);
  if (RADIUS_PROPERTIES.test(property)) {
    if (ALLOWED_RADIUS.has(value) || onlyVarOrKeyword(value, declared)) return null;
    return "radius";
  }
  if (MOTION_PROPERTIES.has(property)) {
    if (value === "none" || value === "0" || onlyVarOrKeyword(value, declared)) return null;
    const bare = value.replace(/var\(--[\w-]+(,[^)]*)?\)/g, " ");
    const literalTime = /(^|[\s,(])[-+]?[\d.]+m?s\b/.test(bare);
    const literalEase = /\b(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b|cubic-bezier\(|steps\(/.test(bare);
    return literalTime || literalEase ? "motion" : null;
  }
  if (property === "z-index") return RULE31_Z_INDEX.has(value) || value === "auto" ? null : "z-index";
  if ((property === "width" || property === "height") && /icon/i.test(selector)) {
    return /^[\d.]+px$/.test(value) ? "icon-size" : null;
  }
  return null;
}

/**
 * Every A5 finding in `css`. A literal colour declaration directly followed
 * in the same block by the same property through `color-mix()` is the rule
 * 31 browser fallback and is left out.
 */
export function scanCss(css: string, declared?: ReadonlySet<string>): CssFinding[] {
  const decls = parseDeclarations(css);
  const findings: CssFinding[] = [];
  decls.forEach((decl, i) => {
    const category = categorize(decl, declared);
    if (!category) return;
    const next = decls[i + 1];
    if (
      category === "colour" &&
      next &&
      next.selector === decl.selector &&
      next.property === decl.property &&
      /color-mix\(/.test(next.value) &&
      !hasColourLiteral(next.value, declared)
    ) {
      return;
    }
    findings.push({ ...decl, category });
  });
  return findings;
}

/** The text of `:root { … }` blocks blanked out (token definitions, A5-excluded). */
export function blankRootBlocks(css: string): string {
  return css.replace(/(^|\n)(\s*):root\s*\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Every custom property name (`--x`) declared anywhere in `cssTexts`. */
export function declaredTokens(cssTexts: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const css of cssTexts) {
    for (const m of blankComments(css).matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
  }
  return names;
}

/** `name → value` for the custom properties declared in the first `selector { … }` block. */
export function tokenBlock(css: string, selector: string): Map<string, string> {
  const text = blankComments(css);
  const at = text.search(new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  const out = new Map<string, string>();
  if (at < 0) return out;
  const body = text.slice(text.indexOf("{", at) + 1, text.indexOf("}", at));
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  return out;
}
