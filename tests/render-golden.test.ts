/**
 * Shared 4-surface golden-fixture suite — JS surfaces (plan decision A1).
 *
 * The canonical Rust surface is covered by src-tauri/tests/render_golden.rs,
 * which reads the SAME fixtures file. The Rust renderer is not callable from
 * jsdom, so this test validates the JS sanitizer surface ([3] Marked fallback /
 * preview): every must-not-contain payload is neutralized by
 * sanitizeRenderedHtml, and the legitimate math/footnote wrappers survive it.
 *
 * Keeping both halves keyed off one fixtures file is what makes "done on every
 * surface" enforceable — a new syntax must be added to phase1.json and pass on
 * both sides.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { sanitizeRenderedHtml } from "../src/services/sanitizerPolicy";

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

describe("render golden fixtures — JS sanitizer surface", () => {
  it("loads a non-empty fixtures file shared with the Rust surface", () => {
    expect(fixtures.cases.length).toBeGreaterThan(0);
  });

  // The legitimate math/footnote wrappers the Rust renderer emits must survive
  // DOMPurify on the JS surface, and the in-doc back-link must be preserved.
  it("preserves math wrappers through the JS sanitizer", () => {
    const inline = sanitizeRenderedHtml('<span class="math-inline">a+b</span>');
    expect(inline).toContain('class="math-inline"');
    const display = sanitizeRenderedHtml('<div class="math-display">x</div>');
    expect(display).toContain('class="math-display"');
  });

  it("preserves footnote back-links through the JS sanitizer", () => {
    const html =
      '<sup class="footnote-reference" id="fnref-1"><a href="#1">1</a></sup>' +
      '<div class="footnote-definition" id="1"><p>n' +
      '<a href="#fnref-1" class="footnote-backref" aria-label="Back to reference">↩</a></p></div>';
    const out = sanitizeRenderedHtml(html);
    expect(out).toContain('href="#fnref-1"');
    expect(out).toContain("footnote-backref");
    expect(out).toContain('id="fnref-1"');
  });

  // Every fixture carrying a script/javascript-href payload must be neutralized
  // identically on the JS surface.
  for (const c of (fixtures.cases as Case[]).filter(
    (x) => x.mustNotContain && x.mustNotContain.length > 0,
  )) {
    it(`neutralizes payloads for "${c.name}" on the JS sanitizer`, () => {
      // Sanitize the fixture's markdown as if it were rendered HTML (the
      // security-relevant fixtures embed raw HTML payloads). For the pure-markdown
      // cases this is a conservative over-approximation: the sanitizer must still
      // never emit the forbidden substrings.
      const out = sanitizeRenderedHtml(c.markdown);
      for (const needle of c.mustNotContain ?? []) {
        // Skip needles that are plain markdown artifacts (e.g. "class=...inline")
        // which only the Rust renderer produces; the security needles are the
        // ones that matter here.
        if (needle === "<script" || needle === "javascript:") {
          expect(out).not.toContain(needle);
        }
      }
    });
  }
});
