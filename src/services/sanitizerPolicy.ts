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
 * Risk controls (kept identical to the Rust side):
 *   - `style` is never allowed → no `url(http…)` exfiltration.
 *   - `<script>`, `on*`, `<foreignObject>`, `<iframe>` are stripped.
 *   - href schemes limited to the safe set; in-doc `#anchor` passes through.
 *
 * @coordinates-with src-tauri/src/services/markdown.rs (MATH_TAGS / SVG_TAGS /
 *   SVG_ATTRS — keep both lists in sync; tests/sanitizer-policy.test.ts guards
 *   the frontend half).
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

/** Math-specific attributes. */
const MATH_ATTRS: string[] = ["xmlns", "display", "encoding", "aria-hidden"];

const ADD_TAGS = [
  "mark", "u", "section",
  ...MATH_TAGS,
  ...SVG_TAGS,
];

const ADD_ATTR = [
  "data-heading-id", "class",
  ...MATH_ATTRS,
  ...SVG_ATTRS,
];

/**
 * Sanitize rendered Markdown HTML with the shared allow-list policy.
 *
 * `USE_PROFILES.svg` is intentionally NOT used (it would re-admit
 * `<foreignObject>` and a broader attribute surface). We curate the SVG tag/attr
 * set explicitly to keep the Mermaid profile tight.
 */
export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS,
    ADD_ATTR,
    // Defense-in-depth: forbid the HTML-in-SVG escape hatch and inline frames
    // even if a future ADD_TAGS edit slips one in.
    FORBID_TAGS: ["foreignObject", "iframe", "script", "style"],
    FORBID_ATTR: ["style"],
  });
}
