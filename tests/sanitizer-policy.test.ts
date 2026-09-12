/**
 * WI-0.1 — Sanitizer policy redesign (frontend DOMPurify half).
 *
 * The frontend `sanitizeRenderedHtml` must mirror the Rust `sanitize_html`
 * allow-list matrix (docs/plans/20260628-plan-typora-parity.md):
 *   - legitimate KaTeX math, footnote anchors, and Mermaid SVG survive
 *   - script-injection (math/mermaid/footnote/CSS) payloads are neutralized
 *
 * jsdom is available in this Vitest setup, so we exercise DOMPurify for real
 * rather than asserting on source text.
 */
import { describe, expect, it } from "vitest";
import { sanitizeRenderedHtml } from "../src/services/sanitizerPolicy";

describe("sanitizeRenderedHtml — legitimate output survives", () => {
  it("preserves KaTeX math (math/semantics/annotation/mi + class)", () => {
    const html =
      '<span class="katex"><span class="katex-mathml">' +
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics>' +
      "<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>" +
      '<annotation encoding="application/x-tex">x+1</annotation>' +
      "</semantics></math></span></span>";
    const result = sanitizeRenderedHtml(html);
    expect(result).toContain("<math");
    expect(result).toContain("<semantics>");
    expect(result).toContain("<annotation");
    expect(result).toContain("x+1");
    expect(result).toContain('class="katex"');
  });

  it("preserves footnote reference + definition anchors (in-doc href)", () => {
    const html =
      '<sup class="footnote-reference"><a href="#fn1">1</a></sup>' +
      '<div class="footnote-definition" id="fn1"><p>note <a href="#fnref1">↩</a></p></div>';
    const result = sanitizeRenderedHtml(html);
    expect(result).toContain('href="#fn1"');
    expect(result).toContain('id="fn1"');
    expect(result).toContain("footnote-reference");
  });

  it("preserves Mermaid SVG (svg/g/path/text + geometry attrs)", () => {
    const html =
      '<svg viewBox="0 0 100 100" class="mermaid"><g>' +
      '<path d="M0 0 L10 10"></path><text x="5" y="5">node</text></g></svg>';
    const result = sanitizeRenderedHtml(html);
    expect(result).toContain("<svg");
    expect(result).toContain("<path");
    expect(result).toContain('d="M0 0 L10 10"');
    expect(result).toContain("<text");
  });

  it("preserves <mark> and <u> (pre-existing behavior)", () => {
    const result = sanitizeRenderedHtml("<p><mark>hi</mark> <u>u</u></p>");
    expect(result).toContain("<mark>hi</mark>");
    expect(result).toContain("<u>u</u>");
  });

  it("preserves align on td/th (table column alignment survives export)", () => {
    // The WYSIWYG export path is renderer → sanitizeRenderedHtml → build_html.
    // `align` is allow-listed in BASE_ATTRS; dropping it would strip alignment
    // from every exported table while html_template.rs kept shipping
    // [align="…"] rules that then match nothing. The Rust leg of the same
    // pipeline is covered by markdown.rs's test_table_alignment_survives_
    // sanitize_html; this is the JS leg, which previously had no guard.
    const result = sanitizeRenderedHtml(
      '<table><tbody><tr><td align="center">c</td><th align="right">r</th></tr></tbody></table>',
    );
    expect(result).toContain('align="center"');
    expect(result).toContain('align="right"');
  });
});

describe("sanitizeRenderedHtml — payloads neutralized on every surface", () => {
  it("strips <script> embedded in a math annotation", () => {
    const html =
      "<span class=\"katex\"><math><semantics>" +
      "<annotation><script>alert(1)</script></annotation>" +
      "</semantics></math></span>";
    const result = sanitizeRenderedHtml(html);
    expect(result).not.toContain("<script");
  });

  it("strips javascript: href in a footnote anchor", () => {
    const html = '<sup><a href="javascript:alert(1)">1</a></sup>';
    const result = sanitizeRenderedHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("strips <script>, on* handlers, and foreignObject from SVG", () => {
    const html =
      '<svg viewBox="0 0 10 10"><script>alert(1)</script>' +
      '<path d="M0 0" onload="alert(2)"></path>' +
      '<foreignObject><iframe src="javascript:alert(3)"></iframe></foreignObject></svg>';
    const result = sanitizeRenderedHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("onload");
    expect(result.toLowerCase()).not.toContain("<foreignobject");
    expect(result).not.toContain("<iframe");
  });

  it("strips a url(http…) exfiltration vector in a style attribute", () => {
    const html =
      '<span class="katex" style="background:url(http://evil.example/x)">x</span>';
    const result = sanitizeRenderedHtml(html);
    expect(result).not.toContain("evil.example");
  });
});
