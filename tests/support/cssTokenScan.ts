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
 * - Every colour literal is a finding (D278, user Q3: 「Every literal, rgba
 *   too」): hex and colour functions on any property, after quoted strings
 *   are blanked; named and system colours on colour-bearing properties and
 *   custom properties; a `var(--x, <colour>)` fallback, declared or not; and
 *   colours inside an SVG `data:` URI (percent-encoded or base64). There is
 *   no browser-fallback exemption any more. `color-mix()` is scanned like
 *   any other value, so a literal argument inside it is a finding.
 * - Token values are exempt only as declarations, and only in the token
 *   files: `exemptTokenDeclarations(rel, css)` blanks the custom properties
 *   inside `globals.css :root`, `light.css .theme-light` and
 *   `dark.css .theme-dark`, and scans everything else, a `:root` block in a
 *   section file included (D278-FIX-1).
 * - Custom-property declarations outside the token blocks are scanned like
 *   any other (`parseDeclarations(css, { customProperties: true })`).
 * - `scanTsColours` is the TS/TSX pass: colour literals in string and
 *   template literals (a colour function whatever its first argument), and
 *   named colours in inline style objects and `style.setProperty` values
 *   outside comments.
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

/** CSS Color 4 named colours and the CSS system colours, lower case. */
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
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen " +
    "canvas canvastext buttonface buttontext buttonborder field fieldtext highlight highlighttext " +
    "linktext visitedtext activetext graytext mark marktext accentcolor accentcolortext selecteditem " +
    "selecteditemtext"
  ).split(" "),
);

/** Properties whose words can be colours: named colours count here (hex and functions count everywhere). */
const COLOUR_PROPERTIES = new Set([
  "text-shadow",
  "background-image",
  "filter",
  "backdrop-filter",
  "accent-color",
  "column-rule",
  "column-rule-color",
  "-webkit-text-fill-color",
  "-webkit-text-stroke",
  "-webkit-text-stroke-color",
  "scrollbar-color",
  "flood-color",
  "stop-color",
  "lighting-color",
  "mask",
  "mask-image",
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

/**
 * Every declaration in `css`, in source order. Custom-property declarations
 * (`--x: …`) are skipped unless `customProperties` is set: callers that read
 * rendered rules rely on that (colorBorderFills, motion-dr12); `scanCss` sets
 * it so a local `--x: #fff` outside the token blocks is scanned (D278).
 */
export function parseDeclarations(css: string, { customProperties = false } = {}): CssDeclaration[] {
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
    const custom = customProperties && /^--[\w-]+$/.test(property);
    if (!custom && !/^-?[a-z][a-z0-9-]*$/.test(property)) return;
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

const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** True when `text` has a named or system colour among its words. */
function hasNamedColour(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z-]+/)
    .some((word) => NAMED_COLOURS.has(word));
}

/** The payload of a `data:image/svg+xml` URI, decoded, or null. */
function svgPayload(uri: string): string | null {
  const m = /^data:image\/svg\+xml(;base64)?,([\s\S]*)$/i.exec(uri.trim());
  if (!m) return null;
  if (m[1]) return atob(m[2].trim());
  try {
    return decodeURIComponent(m[2]);
  } catch {
    return m[2];
  }
}

/** True when an SVG document paints with a colour literal. */
function svgHasColour(svg: string): boolean {
  if (new RegExp(HEX.source, "i").test(svg) || COLOUR_FN.test(svg)) return true;
  const paint = /\b(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*[:=]\s*["']?([^"';>\s]+)/gi;
  return [...svg.matchAll(paint)].some((m) => hasNamedColour(m[1]));
}

/**
 * True when `property: value` carries a colour literal (D278, Q3). A `var()`
 * fallback counts, declared token or not; quoted strings are blanked; an SVG
 * `data:` URI is decoded and scanned.
 */
export function colourLiteralIn(property: string, value: string): boolean {
  let v = value.replace(/\s*!important$/i, "");
  let svg = false;
  v = v.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/g, (_, a, b, c) => {
    const payload = svgPayload(a ?? b ?? c ?? "");
    if (payload !== null && svgHasColour(payload)) svg = true;
    return " ";
  });
  if (svg) return true;
  v = v.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ").replace(/var\(\s*--[\w-]+/g, "var(");
  if (new RegExp(HEX.source, "i").test(v) || COLOUR_FN.test(v)) return true;
  const named = COLOUR_PROPERTIES.has(property) || property.startsWith("border") || property.startsWith("--");
  return named && hasNamedColour(v);
}

/** True when the value carries a colour literal, read as a colour property (`var()` fallbacks included). */
export function hasColourLiteral(value: string, _declared?: ReadonlySet<string>): boolean {
  return colourLiteralIn("color", value);
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
  if (colourLiteralIn(property, value)) return "colour";
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

/** Every A5 finding in `css`. There is no browser-fallback exemption (D278, Q3). */
export function scanCss(css: string, declared?: ReadonlySet<string>): CssFinding[] {
  return parseDeclarations(css, { customProperties: true }).flatMap((decl) => {
    const category = categorize(decl, declared);
    return category ? [{ ...decl, category }] : [];
  });
}

/** The token block each token file may declare tokens in (rule 31), keyed by its path under `src/`. */
const TOKEN_BLOCKS: Record<string, string> = {
  "styles/globals.css": ":root",
  "styles/themes/light.css": ".theme-light",
  "styles/themes/dark.css": ".theme-dark",
};

/**
 * `css` with the custom-property declarations inside the `blocks` (default
 * `:root`, `.theme-light` and `.theme-dark`) blanked, newlines kept: token
 * values are exempt as declarations, and anything else is scanned (D278).
 * Only a rule whose whole selector is the block counts: the selector must
 * start after a `}`, a `{` (inside `@media`) or the start of the file, so a
 * list (`.x, .theme-light`, `.theme-light, .x`) or a compound or descendant
 * selector is scanned like any other rule (D278-FIX-2).
 */
export function blankTokenDeclarations(css: string, blocks: readonly string[] = Object.values(TOKEN_BLOCKS)): string {
  const text = blankComments(css);
  let out = css;
  const heads = blocks.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  for (const m of text.matchAll(new RegExp(`(?:^|[{}])\\s*(${heads})\\s*\\{`, "g"))) {
    const open = (m.index ?? 0) + m[0].length;
    const close = text.indexOf("}", open);
    const body = text.slice(open, close).replace(/--[\w-]+\s*:[^;{}]*;?/g, (d) => d.replace(/[^\n]/g, " "));
    out = out.slice(0, open) + body + out.slice(close);
  }
  return out;
}

/**
 * `css`, the file `rel` (relative to `src/`), with its token declarations
 * exempted: only the three token files, and in each only its own block, so a
 * `:root { --x: #fff }` in a section file is still a finding (D278-FIX-1).
 */
export function exemptTokenDeclarations(rel: string, css: string): string {
  const block = TOKEN_BLOCKS[rel];
  return block ? blankTokenDeclarations(css, [block]) : css;
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

/**
 * The string and template literals of TS source with their start offsets,
 * comments and regex literals skipped, and the comment ranges `[start, end)`.
 */
function tsScan(src: string): { strings: { at: number; text: string }[]; comments: [number, number][] } {
  const out: { at: number; text: string }[] = [];
  const comments: [number, number][] = [];
  let prev = "";
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const start = i;
      i = src.indexOf("\n", i);
      comments.push([start, i < 0 ? src.length : i]);
      if (i < 0) break;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const start = i;
      i = src.indexOf("*/", i + 2) + 1;
      comments.push([start, i <= 0 ? src.length : i + 1]);
      if (i <= 0) break;
      continue;
    }
    if (ch === "/" && /^$|[(,=:[!&|?{};]/.test(prev)) {
      let inClass = false;
      for (i += 1; i < src.length && src[i] !== "\n"; i += 1) {
        if (src[i] === "\\") i += 1;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
      }
      prev = "/";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      for (i += 1; i < src.length && src[i] !== ch; i += 1) if (src[i] === "\\") i += 1;
      out.push({ at: start, text: src.slice(start + 1, i) });
      prev = ch;
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
  }
  return { strings: out, comments };
}

/** `src` with its comments blanked, newlines and offsets kept. */
function blankTsComments(src: string, comments: [number, number][]): string {
  let out = src;
  for (const [a, b] of comments) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, " ") + out.slice(b);
  return out;
}

/** CSS property names, kebab case, for an inline style key. */
const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Colour literals in TS/TSX source (D278, Q3): hex and colour functions in
 * string and template literals, and named colours in the values of inline
 * style objects and `style.setProperty(name, value)` where `name` is a colour
 * property or a custom property.
 */
export function scanTsColours(source: string): { line: number; literal: string }[] {
  const lineAt = (at: number) => source.slice(0, at).split("\n").length;
  const found = new Map<string, { line: number; literal: string }>();
  const add = (at: number, literal: string) => found.set(`${at}:${literal}`, { line: lineAt(at), literal });
  const { strings, comments } = tsScan(source);
  // The named-colour passes read code only: a colour in a comment is not a literal (D278-FIX-1).
  const code = blankTsComments(source, comments);
  for (const { at, text } of strings) {
    for (const m of text.matchAll(HEX)) add(at, m[0]);
    // Any argument, signed or interpolated: `hsl(-20 …)` and `rgb(${r}, …)` are colours too (D278-FIX-1).
    for (const m of text.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\bcolor\(\s*(?:srgb|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz)/gi)) add(at, m[0]);
  }
  for (const m of code.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    for (const kv of m[1].matchAll(/(\w+)\s*:\s*["'`]([^"'`]*)["'`]/g)) {
      const property = kebab(kv[1]);
      const named = COLOUR_PROPERTIES.has(property) || property.startsWith("border");
      if (named && hasNamedColour(kv[2].replace(/var\(\s*--[\w-]+/g, "var("))) add((m.index ?? 0) + (kv.index ?? 0), kv[2]);
    }
  }
  for (const m of code.matchAll(/\.setProperty\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]*)["'`]/g)) {
    const property = m[1];
    const named = COLOUR_PROPERTIES.has(property) || property.startsWith("border") || property.startsWith("--");
    if (named && hasNamedColour(m[2].replace(/var\(\s*--[\w-]+/g, "var("))) add(m.index ?? 0, m[2]);
  }
  return [...found.values()];
}
