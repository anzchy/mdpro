/**
 * Shared heading-identity corpus — JS runner.
 *
 * Reads tests/render-fixtures/heading-identity.json, shared with
 * src-tauri/tests/heading_identity_parity.rs. The Rust renderer is not callable
 * from jsdom, so parity is enforced as one fixture with two independent runners
 * — the same mechanism tests/render-golden.test.ts already uses for phase1.json.
 * This is deliberately NOT the tests/sanitizer-rust-js-parity.test.ts approach of
 * parsing Rust source text from TS: decision E26 moved this repo away from
 * source-text assertions, and they cannot characterize behavior in any case.
 *
 * PARITY SURFACE — THREE LIVE SLUG GENERATORS OWNED BY mdpro: `rust`, `toc`,
 * `exportFallback`. They are not every face in the running app.
 *
 * A FOURTH LIVE FACE exists on the WYSIWYG surface: the heading DOM ids
 * `@milkdown/preset-commonmark@7.18.0` writes — `defaultHeadingIdGenerator`
 * (`lib/index.js:521-523`, punctuation preserved) composed with
 * `syncHeadingIdPlugin`'s own `-#n` dedupe (`:2119-2161`). Measured, do not
 * re-derive: the two dedupe schemes disagree (`intro-#2` there, `intro-1` here),
 * empty headings get no `id` at all, and the ids are rewritten by a dispatched
 * transaction on every doc change. It is UNOWNED and, after WI-3.6, read by no mdpro
 * code — addressing is document-order correspondence
 * (`src/utils/tocElementResolution.ts`, ADR-0014), pinned by the DOM-id-independence
 * case `E-L5` in `tests/toc-element-resolution.test.ts`. It is deliberately NOT
 * admitted to this corpus: mdpro neither produces nor consumes those ids, and
 * pinning a third party's output with no product contract behind it would break on
 * their patch releases for no behavioural reason. The full measurement is in the
 * header of `tests/heading-identity-faces.test.ts`.
 *
 * One further generator exists in the tree and is DELIBERATELY OUT OF SCOPE because
 * it is dead code, not a face (plan M `:413-420`):
 * `src-tauri/src/commands/toc.rs:36` (zero callers; takes `content` while the TS
 * wrapper passes `document_id`). A second dead generator lived in `src/stores/` until
 * WI-3.5.8 deleted it (zero references; it stripped CJK) — see
 * `tests/dead-slug-removal.test.ts`. Nothing here says anything about the dead one
 * that remains, or about the Milkdown face — a reader must not conclude parity
 * covers all five.
 *
 * This file owns three faces; the Rust runner owns `rust`:
 *   toc             tocService.parseHeadingsFromContent — the TOC sidebar's own
 *                   parser and slug generator.
 *   tocOffsets      the `offset` field of that same parse, asserted only where
 *                   the fixture supplies expectedTocOffsets.
 *   exportCanonical exportService.renderMarkdown with the Rust IPC RESOLVING.
 *                   Owns anchor PRESERVATION, not slug generation: it is fed
 *                   Rust-shaped HTML synthesized from expectedSlugs, so a
 *                   slug-generation bug is invisible here and is attributed to
 *                   `rust` instead. Synthesizing rather than storing real Rust
 *                   HTML keeps the fixture from rotting on innocuous render
 *                   changes and avoids a snapshot test (rule 10).
 *   exportFallback  the same function with the IPC REJECTING — the `marked`
 *                   degradation path (plan decision A1), not a path users hit.
 *
 * expectedSlugs is the CORRECT answer, not today's behavior. A face absent from
 * currentlyFailsOn must match it. A face listed there must match
 * currentlyProduces[face] EXACTLY — the output measured from the live code —
 * and that recording must itself still differ from expectedSlugs.
 *
 * Asserting only "not equal to expected" for a pinned defect would accept every
 * wrong answer equally: deleting every heading from a defective case, or
 * emptying its output entirely, would still satisfy it. Pinning the exact output
 * makes each defect the specific defect it is. WI-3.2 deletes a face from
 * currentlyFailsOn AND from currentlyProduces together, and the assertion flips
 * to demanding correctness.
 */
import * as fs from "fs";
import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { exportService } from "../src/services/exportService";
import { invoke } from "@tauri-apps/api/core";
import { collectionCases } from "./support/collectionCases";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

type FaceValue = Array<string | number>;

interface Case {
  name: string;
  markdown: string;
  expectedSlugs: string[];
  expectedTocOffsets?: number[];
  currentlyFailsOn?: string[];
  currentlyProduces?: Record<string, FaceValue>;
  note?: string;
}

const fixtures = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "render-fixtures/heading-identity.json"),
    "utf-8",
  ),
) as { cases: Case[] };

/**
 * Extract the id of every <h1>–<h6> in document order.
 *
 * Deliberately NOT every id in the document. Footnote references and
 * definitions carry ids of their own, and raw HTML passes arbitrary ids through
 * the sanitizer, so a whole-document sweep reports a valid document as having
 * extra headings — the `non-heading-ids` case measures exactly that. A sweep is
 * equally blind in the other direction: an id MOVED off a heading onto a
 * wrapper still shows up, so the anchor stops being a heading anchor with no
 * test failing.
 *
 * The `\sid="` requires a real `id` attribute, so `data-heading-id="…"` is not
 * mistaken for an anchor — a heading left with only the data attribute
 * correctly contributes nothing. That shape was routinely produced by DOMPurify's
 * clobbering defense until WI-3.2 B3 set `SANITIZE_DOM: false` (ADR-0003 B′); it
 * is no longer expected on any face, and this extractor is what would make its
 * return visible rather than counting the data attribute as an anchor.
 */
function headingIdsFrom(html: string): string[] {
  return [...html.matchAll(/<h[1-6][^>]*\sid="([^"]*)"/g)].map((m) => m[1]);
}

function fails(c: Case, face: string): boolean {
  return (c.currentlyFailsOn ?? []).includes(face);
}

/**
 * Assert a face against its expected value, or against its RECORDED current
 * output when the fixture pins the face as a known defect. Keeping both
 * directions in one helper is what makes a fixed defect fail loudly instead of
 * silently passing.
 */
function assertFace(
  c: Case,
  face: string,
  actual: unknown,
  expected: unknown,
): void {
  if (fails(c, face)) {
    const recorded = c.currentlyProduces?.[face];
    expect(
      recorded,
      `[${c.name}] pins \`${face}\` in currentlyFailsOn but records no ` +
        `currentlyProduces["${face}"]. A pinned defect must record the exact output ` +
        `it produces today, or the pin accepts any wrong answer at all.`,
    ).toBeDefined();
    expect(
      recorded,
      `[${c.name}] currentlyProduces["${face}"] equals the expected value, so the ` +
        `recorded "defect" IS the correct answer. Delete "${face}" from ` +
        `currentlyFailsOn and from currentlyProduces.\n  note: ${c.note ?? ""}`,
    ).not.toEqual(expected);
    expect(
      actual,
      `[${c.name}] \`${face}\` is pinned as DEFECTIVE with a recorded output, but it ` +
        `now produces something else. If WI-3.2 fixed it, delete "${face}" from ` +
        `currentlyFailsOn and currentlyProduces; if the behavior merely changed, ` +
        `re-measure and update the recording.\n  note: ${c.note ?? ""}`,
    ).toEqual(recorded);
  } else {
    expect(
      actual,
      `[${c.name}] \`${face}\` must produce the expected value.\n  note: ${c.note ?? ""}`,
    ).toEqual(expected);
  }
}

describe("heading identity corpus — JS faces of the three LIVE slug generators (toc, exportFallback, rust; commands/toc.rs is dead code and out of scope)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads a non-empty fixtures file shared with the Rust runner", () => {
    expect(fixtures.cases.length).toBeGreaterThan(0);
  });

  for (const c of collectionCases("tests/heading-identity-parity.test.ts:171", fixtures.cases)) {
    it(`toc slugs for "${c.name}"`, () => {
      const actual = parseHeadingsFromContent(c.markdown).map((h) => h.id);
      assertFace(c, "toc", actual, c.expectedSlugs);
    });

      it.skipIf(!c.expectedTocOffsets)(`toc offsets for "${c.name}"`, () => {
        if (!c.expectedTocOffsets) return;
        const actual = parseHeadingsFromContent(c.markdown).map((h) => h.offset);
        assertFace(c, "tocOffsets", actual, c.expectedTocOffsets);
      });

    it(`canonical export preserves anchors for "${c.name}"`, async () => {
      // Shape the IPC result like what Rust really emits for the expected slugs,
      // then assert the JS post-processing does not drop the anchor.
      const rustShaped = c.expectedSlugs
        .map((s) => `<h1 id="${s}" data-heading-id="${s}">x</h1>\n`)
        .join("");
      invokeMock.mockResolvedValue({ html: rustShaped });
      const html = await exportService.renderMarkdown(c.markdown);
      assertFace(c, "exportCanonical", headingIdsFrom(html), c.expectedSlugs);
    });

    it(`fallback export slugs for "${c.name}"`, async () => {
      invokeMock.mockRejectedValue(new Error("force marked fallback"));
      const html = await exportService.renderMarkdown(c.markdown);
      assertFace(c, "exportFallback", headingIdsFrom(html), c.expectedSlugs);
    });
  }
});
