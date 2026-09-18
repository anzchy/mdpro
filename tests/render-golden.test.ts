/**
 * JS sanitizer contract for the shared render fixtures (plan decision A1).
 *
 * SCOPE — this is NOT a render-parity test. The canonical Rust surface
 * (render_markdown → sanitize_html) is covered by src-tauri/tests/render_golden.rs,
 * which reads the SAME fixtures file (tests/render-fixtures/phase1.json). The Rust
 * renderer is not callable from jsdom, so this file verifies the *JS sanitizer*
 * contract only:
 *   1. The Rust-shaped HTML (the `mustContain` needles each fixture expects the
 *      Rust renderer to emit) passes through DOMPurify (`sanitizeExportFragment`)
 *      INTACT — math wrappers, footnote anchors, and autolinks survive.
 *   2. The script / javascript-href payloads (the `mustNotContain` security
 *      needles) are neutralized by the same sanitizer.
 *
 * This does not claim to prove surface-3/4 *render* parity — only that the JS
 * sanitizer (the surface that runs in preview and the export fallback) keeps the
 * legitimate markup and drops the dangerous markup. Keeping both halves keyed off
 * one fixtures file is what makes "the sanitizer contract holds on every surface"
 * enforceable.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { sanitizeExportFragment } from "../src/services/sanitizerPolicy";

interface Case {
  name: string;
  markdown: string;
  mustContain?: string[];
  mustNotContain?: string[];
}

const fixtures = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "render-fixtures/phase1.json"),
    "utf-8",
  ),
) as { cases: Case[] };

/**
 * Needles that are PLAIN-TEXT markdown artifacts the Rust renderer reproduces
 * verbatim (e.g. literal `$x^2$`, `[^x]`, an un-rendered `:notanemoji:`). These
 * are not HTML markup, so feeding them through the sanitizer as standalone text
 * is not a meaningful "survives" assertion — they're covered by the Rust surface.
 * We only assert HTML-markup needles survive here.
 */
function isHtmlMarkupNeedle(needle: string): boolean {
  return needle.includes("<") || needle.includes("=\"") || needle.includes("=&");
}

describe("render fixtures — JS sanitizer contract", () => {
  it("loads a non-empty fixtures file shared with the Rust surface", () => {
    expect(fixtures.cases.length).toBeGreaterThan(0);
  });

  // POSITIVE: the Rust-surface HTML each fixture expects (its `mustContain`
  // markup needles) must SURVIVE the JS sanitizer. This is what genuinely
  // exercises the JS sanitizer surface — that it does not strip the legitimate
  // math / footnote / autolink markup the Rust renderer produces.
  for (const c of (fixtures.cases as Case[]).filter(
    (x) => (x.mustContain ?? []).some(isHtmlMarkupNeedle),
  )) {
    it(`preserves Rust-surface markup for "${c.name}" through the JS sanitizer`, () => {
      // Feed the expected Rust-emitted HTML needles (joined into a fragment)
      // through the sanitizer and assert each markup needle survives intact.
      const rustShapedHtml = (c.mustContain ?? [])
        .filter(isHtmlMarkupNeedle)
        .join("");
      const out = sanitizeExportFragment(rustShapedHtml);
      for (const needle of (c.mustContain ?? []).filter(isHtmlMarkupNeedle)) {
        expect(out).toContain(needle);
      }
    });
  }

  // NEGATIVE: every fixture carrying a script / javascript-href payload must be
  // neutralized by the JS sanitizer.
  for (const c of (fixtures.cases as Case[]).filter(
    (x) => x.mustNotContain && x.mustNotContain.length > 0,
  )) {
    it(`neutralizes payloads for "${c.name}" on the JS sanitizer`, () => {
      // The security-relevant fixtures embed raw HTML payloads in their
      // markdown; sanitize that as if it were rendered HTML and assert the
      // forbidden substrings are gone.
      const out = sanitizeExportFragment(c.markdown);
      for (const needle of c.mustNotContain ?? []) {
        // Only the security needles (script / javascript:) are JS-surface
        // contracts here; pure-markdown artifacts (e.g. `class="math-inline"`,
        // only the Rust renderer produces) are asserted on the Rust surface.
        if (needle === "<script" || needle === "javascript:") {
          expect(out).not.toContain(needle);
        }
      }
    });
  }

  // Explicit spot-checks for the wrappers the export/preview path depends on,
  // independent of the fixtures loop (regression guard).
  it("preserves math wrappers through the JS sanitizer", () => {
    expect(sanitizeExportFragment('<span class="math-inline">a+b</span>')).toContain(
      'class="math-inline"',
    );
    expect(sanitizeExportFragment('<div class="math-display">x</div>')).toContain(
      'class="math-display"',
    );
  });

  it("preserves footnote back-links through the JS sanitizer", () => {
    const html =
      '<sup class="footnote-reference" id="fnref-1"><a href="#1">1</a></sup>' +
      '<div class="footnote-definition" id="1"><p>n' +
      '<a href="#fnref-1" class="footnote-backref" aria-label="Back to reference">↩</a></p></div>';
    const out = sanitizeExportFragment(html);
    expect(out).toContain('href="#fnref-1"');
    expect(out).toContain("footnote-backref");
    expect(out).toContain('id="fnref-1"');
  });
});
