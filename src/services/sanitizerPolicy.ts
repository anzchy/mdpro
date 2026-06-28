/**
 * Purpose: single authoritative DOMPurify configuration for rendered Markdown,
 * mirroring the Rust `sanitize_html` allow-list matrix in
 * `src-tauri/src/services/markdown.rs` (WI-0.1, plan
 * `docs/plans/20260628-plan-typora-parity.md`).
 *
 * The two surfaces ([3] JS Marked fallback / preview, [2] export via Rust) must
 * neutralize the same payloads and preserve the same legitimate output:
 *   - Math (KaTeX HTML + MathML)
 *   - Footnotes (in-doc anchors)
 *   - Mermaid (specific inline-SVG profile, no foreignObject/script/on*)
 *
 * Allow-list, not additive (Fix 4):
 *   The previous config used DOMPurify's *additive* `ADD_TAGS` / `ADD_ATTR`
 *   on top of DOMPurify's permissive defaults plus a `FORBID_*` blacklist.
 *   That re-admitted things the Rust profile strips — external-resource SVG
 *   (`<image href=…>`, `<feImage>`, `<filter>`, `<mask>`), `srcset`,
 *   `xlink:href`, and extra URI schemes — because additive mode keeps every
 *   default tag/attr and only adds more. We now pin an explicit
 *   `ALLOWED_TAGS` / `ALLOWED_ATTR` (baseline markdown output + the WI-0.1
 *   matrix only) and `ALLOWED_URI_REGEXP` matching exactly the Rust scheme
 *   set. Anything not on the list is dropped by default.
 *
 * Risk controls (kept identical to the Rust side):
 *   - `style` is never allowed → no `url(http…)` exfiltration.
 *   - `<script>`, `on*`, `<foreignObject>`, `<iframe>` are never on the list.
 *   - `image`/`feImage`/`filter`/`mask` SVG external-resource tags excluded.
 *   - `srcset`/`href`-on-image/`xlink:href` excluded.
 *   - URI schemes limited to: relative, http, https, mailto, tel, ftp.
 *
 * @coordinates-with src-tauri/src/services/markdown.rs (MATH_TAGS / SVG_TAGS /
 *   SVG_ATTRS / url_schemes — keep both lists in sync; tests/sanitizer-policy.test.ts
 *   and tests/sanitizer-rust-js-parity.test.ts guard the frontend half).
 */
import DOMPurify from "dompurify";

/** Math (KaTeX HTML + MathML) tags. Mirrors Rust `MATH_TAGS`. */
export const MATH_TAGS: string[] = [
  "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms", "mtext",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "munder", "mover",
  "munderover", "mtable", "mtr", "mtd", "mspace", "mpadded", "mphantom",
  "menclose", "mstyle", "merror", "annotation-xml",
];

/** Mermaid / inline-SVG diagram tags. Mirrors Rust `SVG_TAGS`. */
export const SVG_TAGS: string[] = [
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
  "polygon", "text", "tspan", "defs", "marker", "use", "symbol", "title",
  "desc", "clipPath", "linearGradient", "radialGradient", "stop", "pattern",
];

/** SVG presentation/geometry attributes (no script surface). Mirrors Rust `SVG_ATTRS`. */
export const SVG_ATTRS: string[] = [
  "d", "viewBox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "points", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity",
  "opacity", "offset", "stop-color", "gradientUnits", "gradientTransform",
  "marker-end", "marker-start", "text-anchor", "dominant-baseline", "font-size",
  "font-family", "preserveAspectRatio", "dx", "dy",
];

/** Math-specific attributes. Mirrors the Rust per-tag math attributes. */
const MATH_ATTRS: string[] = ["xmlns", "display", "encoding", "aria-hidden"];

/**
 * Baseline HTML tags produced by the Markdown renderer (CommonMark + GFM
 * tables, task lists, footnotes, highlight `<mark>`). Explicit so additive
 * defaults can't smuggle extra tags through.
 *
 * Deliberately ABSENT: `iframe`, `object`, `embed`, `form`, `button`,
 * `foreignObject`, `style`, `script`, and the external-resource SVG tags
 * (`image`, `feImage`, `filter`, `mask`).
 */
const BASE_TAGS: string[] = [
  "a", "p", "div", "span", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "b", "i", "u", "s", "del", "ins", "sub", "sup", "mark",
  "blockquote", "pre", "code",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "img", "figure", "figcaption",
  "dl", "dt", "dd",
  "details", "summary", "section", "input", "abbr", "kbd", "samp", "var", "wbr",
];

/**
 * Baseline HTML attributes. Excludes `srcset` (responsive external loads) and
 * `style` (url() exfiltration). `href` is allowed only on anchors via the
 * default attribute model; we do NOT add `href`/`xlink:href` to the SVG attr
 * set so SVG `<image href=…>`-style external loads can't pass even if a tag
 * slipped through.
 */
const BASE_ATTRS: string[] = [
  "href", "title", "alt", "src", "width", "height",
  "id", "class", "name", "align",
  "colspan", "rowspan", "scope",
  "type", "checked", "disabled",
  "data-heading-id",
  "aria-hidden", "aria-label", "role",
];

const ALLOWED_TAGS: string[] = [
  ...BASE_TAGS,
  ...MATH_TAGS,
  ...SVG_TAGS,
];

const ALLOWED_ATTR: string[] = [
  ...BASE_ATTRS,
  ...MATH_ATTRS,
  ...SVG_ATTRS,
];

/**
 * URI scheme allow-list. Matches exactly the Rust `url_schemes` set
 * (http, https, mailto, tel, ftp) PLUS relative/in-doc references
 * (`#anchor`, `./path`, `foo.png`) which the Rust side allows via
 * `url_relative(PassThrough)`.
 *
 * Explicitly NOT matched: `javascript:`, `data:`, `vbscript:`, `file:`,
 * `ftps:`, `callto:`, `sms:`, `cid:`, `xmpp:`, `matrix:`, etc.
 */
export const ALLOWED_URI_SCHEMES: string[] = [
  "http", "https", "mailto", "tel", "ftp",
];

// Allow EITHER one of the explicit safe schemes, OR a relative/in-doc
// reference (a value whose first path segment contains no `:`, i.e. no scheme
// at all — `#fn1`, `./img.png`, `foo/bar.png`, `?q=1`). Any value that starts
// with `scheme:` where scheme is not in the safe set (e.g. `javascript:`,
// `data:`, `ftps:`, `callto:`, `sms:`, `cid:`, `xmpp:`, `matrix:`) fails to
// match and is dropped.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|ftp):|[^a-z0-9+.-]|[^:]*$)/i;

/**
 * Sanitize rendered Markdown HTML with the shared allow-list policy.
 *
 * Uses an explicit `ALLOWED_TAGS`/`ALLOWED_ATTR` allow-list (not additive
 * `ADD_*`) so nothing outside the WI-0.1 matrix survives. `USE_PROFILES` is
 * intentionally NOT used.
 */
export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Defense-in-depth: even if a future edit adds one of these to ALLOWED_TAGS,
    // the forbid list still strips the HTML-in-SVG escape hatch, inline frames,
    // and the external-resource SVG tags.
    FORBID_TAGS: ["foreignObject", "iframe", "script", "style", "image", "feImage", "filter", "mask"],
    FORBID_ATTR: ["style", "srcset", "xlink:href"],
  });
}
