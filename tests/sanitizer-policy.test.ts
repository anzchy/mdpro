/**
 * WI-0.1 — Sanitizer policy redesign (frontend DOMPurify half).
 *
 * The frontend `sanitizeExportFragment` must mirror the Rust `sanitize_html`
 * allow-list matrix (docs/plans/20260628-plan-typora-parity.md):
 *   - legitimate KaTeX math, footnote anchors, and Mermaid SVG survive
 *   - script-injection (math/mermaid/footnote/CSS) payloads are neutralized
 *
 * jsdom is available in this Vitest setup, so we exercise DOMPurify for real
 * rather than asserting on source text.
 */
import { describe, expect, it } from "vitest";
import { sanitizeExportFragment } from "../src/services/sanitizerPolicy";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** The full set of ids DOMPurify's `SANITIZE_DOM` used to strip from a heading. */
const CLOBBER_NAMES = ["title", "name", "body", "location", "forms"];

describe("sanitizeExportFragment — legitimate output survives", () => {
  it("preserves KaTeX math (math/semantics/annotation/mi + class)", () => {
    const html =
      '<span class="katex"><span class="katex-mathml">' +
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics>' +
      "<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>" +
      '<annotation encoding="application/x-tex">x+1</annotation>' +
      "</semantics></math></span></span>";
    const result = sanitizeExportFragment(html);
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
    const result = sanitizeExportFragment(html);
    expect(result).toContain('href="#fn1"');
    expect(result).toContain('id="fn1"');
    expect(result).toContain("footnote-reference");
  });

  it("preserves Mermaid SVG (svg/g/path/text + geometry attrs)", () => {
    const html =
      '<svg viewBox="0 0 100 100" class="mermaid"><g>' +
      '<path d="M0 0 L10 10"></path><text x="5" y="5">node</text></g></svg>';
    const result = sanitizeExportFragment(html);
    expect(result).toContain("<svg");
    expect(result).toContain("<path");
    expect(result).toContain('d="M0 0 L10 10"');
    expect(result).toContain("<text");
  });

  it("preserves <mark> and <u> (pre-existing behavior)", () => {
    const result = sanitizeExportFragment("<p><mark>hi</mark> <u>u</u></p>");
    expect(result).toContain("<mark>hi</mark>");
    expect(result).toContain("<u>u</u>");
  });

  it("preserves align on td/th (table column alignment survives export)", () => {
    // The WYSIWYG export path is renderer → sanitizeExportFragment → build_html.
    // `align` is allow-listed in BASE_ATTRS; dropping it would strip alignment
    // from every exported table while html_template.rs kept shipping
    // [align="…"] rules that then match nothing. The Rust leg of the same
    // pipeline is covered by markdown.rs's test_table_alignment_survives_
    // sanitize_html; this is the JS leg, which previously had no guard.
    const result = sanitizeExportFragment(
      '<table><tbody><tr><td align="center">c</td><th align="right">r</th></tr></tbody></table>',
    );
    expect(result).toContain('align="center"');
    expect(result).toContain('align="right"');
  });
});

describe("sanitizeExportFragment — payloads neutralized on every surface", () => {
  it("strips <script> embedded in a math annotation", () => {
    const html =
      "<span class=\"katex\"><math><semantics>" +
      "<annotation><script>alert(1)</script></annotation>" +
      "</semantics></math></span>";
    const result = sanitizeExportFragment(html);
    expect(result).not.toContain("<script");
  });

  it("strips javascript: href in a footnote anchor", () => {
    const html = '<sup><a href="javascript:alert(1)">1</a></sup>';
    const result = sanitizeExportFragment(html);
    expect(result).not.toContain("javascript:");
  });

  it("strips <script>, on* handlers, and foreignObject from SVG", () => {
    const html =
      '<svg viewBox="0 0 10 10"><script>alert(1)</script>' +
      '<path d="M0 0" onload="alert(2)"></path>' +
      '<foreignObject><iframe src="javascript:alert(3)"></iframe></foreignObject></svg>';
    const result = sanitizeExportFragment(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("onload");
    expect(result.toLowerCase()).not.toContain("<foreignobject");
    expect(result).not.toContain("<iframe");
  });

  it("strips a url(http…) exfiltration vector in a style attribute", () => {
    const html =
      '<span class="katex" style="background:url(http://evil.example/x)">x</span>';
    const result = sanitizeExportFragment(html);
    expect(result).not.toContain("evil.example");
  });
});

/**
 * ADR-0003 decision B′ — `SANITIZE_DOM: false`, so an export anchor whose slug
 * collides with a built-in document/form property survives to the file.
 *
 * The full enumerated set, not one representative: `location` is the
 * highest-severity clobber target and `forms` the one most likely to be
 * forgotten. Parsed-DOM rather than substring, because a substring assertion
 * would match `data-heading-id="title"` and pass against the unfixed code.
 *
 * NOT to be "fixed" by restoring `id` from `data-heading-id` after sanitizing —
 * that is ADR-0003 option E2, held as second choice and REJECTED: on a raw-HTML
 * heading `data-heading-id` is attacker-controlled, so it would route trust
 * through an untrusted side channel to undo a DOMPurify decision.
 */
describe("sanitizeExportFragment — clobber-name anchors survive (ADR-0003 B′)", () => {
  for (const name of CLOBBER_NAMES) {
    it(`keeps id="${name}" on a heading`, () => {
      const out = sanitizeExportFragment(
        `<h1 id="${name}" data-heading-id="${name}">t</h1>`,
      );
      expect(
        parse(out).querySelector("h1")?.getAttribute("id"),
        `the export anchor #${name} must survive; got: ${out}`,
      ).toBe(name);
    });
  }
});

/**
 * ADR-0003's `<form>` precondition, converted from prose into a guard.
 *
 * `sanitizerPolicy.ts` states in a comment that `form` is deliberately absent
 * from the allow-list, and until now nothing checked it. That exclusion is not an
 * incidental detail: a detached `<form>` clobbers named properties through form
 * ownership WITHOUT ever entering a document tree, which is the one case
 * `SANITIZE_DOM: false` has no answer for. ADR-0011 makes it load-bearing twice
 * over — `form` is one of the four remaining `Document` named-property elements
 * that decision relies on being absent.
 *
 * Deliberately says nothing about `<input>`: `input` IS allow-listed (task-list
 * checkboxes), so asserting it disappears would pin a false claim and go red for
 * the wrong reason.
 */
describe("sanitizeExportFragment — ADR-0003 preconditions", () => {
  it("never emits a <form> element", () => {
    const out = sanitizeExportFragment('<form id="x"><input name="y"></form>');
    expect(
      parse(out).querySelector("form"),
      "ADR-0003 (docs/adr/0003-export-fragment-sanitizer-scope.md) makes <form>'s " +
        "exclusion from ALLOWED_TAGS a load-bearing precondition of SANITIZE_DOM:false — " +
        "a detached <form> clobbers named properties through form ownership without ever " +
        "entering a document tree. Revisit the ADR BEFORE landing any change that " +
        `allowlists form. Got: ${out}`,
    ).toBeNull();
  });
});

/**
 * ADR-0011 decision 2 — `name` is not in the attribute allow-list.
 *
 * This is a POLICY assertion, not a clobbering reproduction, and the distinction
 * is the whole point (ADR-0011 decision 3). `exportService` routes this output
 * through `highlightSyntax.ts`, which calls `DOMParser.parseFromString` and then
 * reads `doc.body` and `doc.createTreeWalker` — and a `DOMParser` result IS a
 * document tree, the condition ADR-0003's clobbering analysis named but never
 * applied to that second post-processor. A non-empty `name` on an allow-listed
 * `<img>` would make it a supported property name of that `Document`.
 *
 * A behavioural clobbering test would be WORSE THAN NOTHING here: jsdom 26 was
 * measured on 2026-09-18 across six probes and does not implement
 * [LegacyOverrideBuiltIns] named access on `Document` — `doc.body` was never
 * shadowed — so such a test would pass green in Vitest while the condition stayed
 * live in WKWebView. Only a WKWebView probe could prove the defense, and WI-3.2
 * does not build a native lane to get one. So assert the attribute is gone, which
 * is a claim this lane CAN settle.
 */
describe("sanitizeExportFragment — `name` is not allow-listed (ADR-0011)", () => {
  for (const html of [
    '<img name="body" src="./x.png" alt="a">',
    '<img name="createTreeWalker" src="./x.png" alt="a">',
    '<a name="legacy-anchor" href="#x">l</a>',
  ]) {
    it(`drops the name attribute from ${html}`, () => {
      const out = sanitizeExportFragment(html);
      const el = parse(out).querySelector("img, a");
      expect(el, `the element itself must survive; got: ${out}`).not.toBeNull();
      expect(
        el?.getAttribute("name"),
        "`name` was removed from BASE_ATTRS by ADR-0011 because the export fragment " +
          "is re-parsed into a real Document by highlightSyntax.ts. Re-adding it " +
          `supersedes that decision and needs its own ADR. Got: ${out}`,
      ).toBeNull();
    });
  }

  it("keeps id, the supported form, on the same elements", () => {
    // Non-vacuity: proves the assertions above fail because `name` is filtered,
    // not because the whole element or every attribute was dropped.
    const out = sanitizeExportFragment('<a id="legacy-anchor" href="#x">l</a>');
    expect(parse(out).querySelector("a")?.getAttribute("id")).toBe("legacy-anchor");
  });
});
