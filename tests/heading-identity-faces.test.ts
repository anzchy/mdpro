/**
 * WI-3.2 — behavioural laws of the two TypeScript slug faces.
 *
 * PARITY SURFACE — THREE LIVE FACES, and only three:
 *   1. `toc`            src/services/tocService.ts   parseHeadingsFromContent
 *   2. `exportFallback` src/services/exportService.ts renderMarkdown (Rust IPC rejecting)
 *   3. `rust`           src-tauri/src/services/markdown.rs generate_heading_id
 *
 * ONE FURTHER SLUG GENERATOR EXISTS AND IS DELIBERATELY OUT OF SCOPE — it is
 * DEAD CODE, not a face of this parity claim (plan M `:413-420`):
 *   - `src-tauri/src/commands/toc.rs:36` `get_document_headings` — zero callers; it
 *     takes `content` while the TS wrapper passes `document_id`, so it could not be
 *     called successfully even if something tried. Retirement is stage 5.
 * There used to be a second dead one in `src/stores/` (zero references, stripped CJK);
 * WI-3.5.8 deleted it, and `tests/dead-slug-removal.test.ts` fails if it returns.
 * Nothing here asserts anything about the remaining dead generator. A reader must not
 * conclude that "the slug generators agree" covers all four.
 *
 * The fixed-case corpus lives in tests/heading-identity-parity.test.ts. This file
 * carries the laws that 27 hand-picked cases cannot reach: document uniqueness over
 * a generated corpus, per-call and cross-await isolation of the module-level `marked`
 * parser, and three-way agreement between the two TS faces and the shared allocator.
 */
import { describe, expect, it, vi } from "vitest";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { exportService } from "../src/services/exportService";
import { createAnchorSlugAllocator } from "../src/utils/headingIdentity";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_SEED,
  SHAPE_RE,
  generateCorpus,
} from "./helpers/headingCorpus";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

/**
 * Same extraction as both corpus runners: `<h1>`–`<h6>` only, and a real ` id="`
 * so `data-heading-id="…"` is never mistaken for an anchor.
 */
function headingIdsFrom(html: string): string[] {
  return [...html.matchAll(/<h[1-6][^>]*\sid="([^"]*)"/g)].map((m) => m[1]);
}

const corpus = generateCorpus();

describe("toc face — document uniqueness over generated Corpus G (live face 1 of 3)", () => {
  it("parseHeadingsFromContent yields distinct, non-empty, shape-valid ids per document", () => {
    for (let d = 0; d < corpus.documents.length; d++) {
      const doc = corpus.documents[d];
      const ids = parseHeadingsFromContent(doc.markdown).map((h) => h.id);
      const where = `seed=0x${DEFAULT_SEED.toString(16)} document=${d}`;

      expect(ids.length, `${where}: every heading must produce an id`).toBe(
        doc.headings.length,
      );
      expect(
        new Set(ids).size,
        `${where}: duplicate id in ${JSON.stringify(ids)}`,
      ).toBe(ids.length);
      for (const id of ids) {
        expect(id, `${where}: empty id`).not.toBe("");
        expect(SHAPE_RE.test(id), `${where}: malformed id ${JSON.stringify(id)}`).toBe(
          true,
        );
      }
    }
  });
});

describe("exportFallback face — allocator state isolation (live face 2 of 3)", () => {
  it("repeated renderMarkdown calls do not continue the previous call's numbering", async () => {
    invokeMock.mockRejectedValue(new Error("force marked fallback"));
    const doc = "# 架构\n\n# 架构";

    const first = headingIdsFrom(await exportService.renderMarkdown(doc));
    const second = headingIdsFrom(await exportService.renderMarkdown(doc));
    const third = headingIdsFrom(await exportService.renderMarkdown(doc));

    expect(first).toEqual(["架构", "架构-1"]);
    expect(
      second,
      "call 2 continued call 1's numbering: the allocator is module-scoped, " +
        "or the per-parse reset that replaced idCounts.clear() was dropped",
    ).toEqual(["架构", "架构-1"]);
    expect(third).toEqual(["架构", "架构-1"]);
  });

  it("concurrently awaited renders do not share allocator state", async () => {
    // Stated honestly: JS is single-threaded and the `marked` parse is synchronous,
    // so there is no true mid-parse interleaving here. What this guards is reuse of
    // MODULE-LEVEL state across awaits, which is the real hazard.
    invokeMock.mockRejectedValue(new Error("force marked fallback"));
    const doc = "# x\n\n# x\n\n# x-1";

    const [a, b] = await Promise.all([
      exportService.renderMarkdown(doc),
      exportService.renderMarkdown(doc),
    ]);

    expect(headingIdsFrom(a)).toEqual(["x", "x-1", "x-1-1"]);
    expect(headingIdsFrom(b)).toEqual(["x", "x-1", "x-1-1"]);
  });
});

describe("three-way agreement: toc, exportFallback and the shared allocator", () => {
  // The exportFallback leg carried a DOMAIN RESTRICTION here until WI-3.2 batch
  // B3, together with a tripwire test asserting that the restriction was still
  // needed. Both are gone, deliberately and on schedule.
  //
  // What they existed for: `exportFallback` is not a bare slug generator — it
  // composes slug generation with `sanitizeExportFragment`, and DOMPurify's
  // default `SANITIZE_DOM` removed an `id` colliding with a built-in
  // document/form property. A heading slugging to `title` reached the output as
  // `<h1 data-heading-id="title">` with no anchor and contributed nothing to
  // `headingIdsFrom`; Corpus G's alphabet contains `Title`, so nearly every
  // generated document hit it. The filter narrowed the domain instead of relaxing
  // the equality, and the tripwire pinned the predicate so it could not quietly
  // outlive the defect.
  //
  // ADR-0003 decision B′ (`SANITIZE_DOM: false`) landed in B3 and the stripping is
  // gone, so the filter would now be a no-op and the tripwire would assert
  // something false. The equality is back to comparing against `allocIds` whole —
  // which is what the test matrix specified before the deferral split B3 out.
  it("agrees element-for-element over Corpus G", async () => {
    invokeMock.mockRejectedValue(new Error("force marked fallback"));

    for (let d = 0; d < corpus.documents.length; d++) {
      const doc = corpus.documents[d];
      const where = `seed=0x${DEFAULT_SEED.toString(16)} document=${d}`;

      // The third leg is load-bearing. A two-way `toc === fallback` comparison
      // passes vacuously when both faces are wrong in the SAME way — precisely the
      // situation before WI-3.2, where `suffix-collision` measured
      // ["x","x-1","x-1"] on both. Comparing each against the shared allocator
      // directly is what makes this property non-vacuous.
      const allocator = createAnchorSlugAllocator();
      const allocIds = doc.headings.map((t) => allocator.allocate(t) as string);

      const tocIds = parseHeadingsFromContent(doc.markdown).map((h) => h.id);
      const fallbackIds = headingIdsFrom(
        await exportService.renderMarkdown(doc.markdown),
      );

      expect(tocIds, `${where}: toc face diverged from the shared allocator`).toEqual(
        allocIds,
      );
      expect(
        fallbackIds,
        `${where}: exportFallback face diverged from the shared allocator`,
      ).toEqual(allocIds);
    }
  });
});

/**
 * FNV-1a 32-bit over the UTF-8 bytes of every slug of every Corpus G document, each
 * slug followed by a single 0x0A byte. Documents are not otherwise delimited — the
 * per-slug terminator is what keeps the stream unambiguous.
 *
 * Hand-rolled: G0 forbids a new dependency, and this must be expressible identically
 * in Rust (see src-tauri/tests/heading_slug_generation.rs::CORPUS_G_SLUG_DIGEST).
 */
function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Measured once on 2026-09-18 from src/utils/headingIdentity.ts, the normative
 * implementation. The identical literal is asserted by the Rust port in
 * src-tauri/tests/heading_identity_parity.rs — grep for CORPUS_G_SLUG_DIGEST.
 */
export const CORPUS_G_SLUG_DIGEST = 0x290f15a3;

describe("cross-language digest — TS half (the Rust half asserts the same literal)", () => {
  it("folds Corpus G's slugs to the recorded digest", () => {
    const encoder = new TextEncoder();
    const parts: number[] = [];
    for (const doc of corpus.documents) {
      const allocator = createAnchorSlugAllocator();
      for (const text of doc.headings) {
        for (const b of encoder.encode(allocator.allocate(text) as string)) {
          parts.push(b);
        }
        parts.push(0x0a);
      }
    }

    expect(
      fnv1a32(Uint8Array.from(parts)),
      "the TS and Rust allocators have diverged outside the fixed fixture cases, " +
        "or Corpus G's generator changed on one side only. Regenerate both and diff " +
        "the first mismatching document — the digest cannot tell you which half moved.",
    ).toBe(CORPUS_G_SLUG_DIGEST);
  });
});
