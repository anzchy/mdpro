/**
 * WI-1 — the position-law acceptance harness for
 * `src/services/tocService.ts#parseHeadingsFromContent` (ADR-0012).
 *
 * ADR-0012 refused a separate `headingPosition.ts` module; these laws are the
 * harness instead. They assert on the *output* of `parseHeadingsFromContent`
 * only — never on an internal, never on the parser's identity — so the Lezer
 * swap in WI-3 is a change of implementation and not of specification.
 *
 * No `vi.mock("@tauri-apps/api/core")` here on purpose:
 * `parseHeadingsFromContent` never calls `invoke`, so mocking that boundary
 * would mock a boundary this unit does not use.
 *
 * EVERY ONE OF P1-P5 IS SATISFIED BY `return []`. L0 is what kills that, and it
 * can only do so because `expectedHeadingCount` is computed by the generator
 * from its block templates, independently of this parser.
 */
import { describe, expect, it } from "vitest";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { DEFAULT_SEED, SHAPE_RE } from "./helpers/headingCorpus";
import {
  FRONTMATTER_BLOCK,
  LAW_DOCS,
  type LawDocument,
  generateLawDocuments,
  toCRLF,
} from "./helpers/headingDocumentCorpus";

const GENERATED = generateLawDocuments();

/** The 113-document base domain: 100 seeded + 13 hand-written. */
const BASE_DOCS: readonly LawDocument[] = [...GENERATED, ...LAW_DOCS];

/**
 * L6's unstated precondition, made explicit 2026-09-18.
 *
 * L6 prepends `FRONTMATTER_BLOCK` and asserts the heading set is unchanged. That
 * only holds when the base document does not *itself* open with a fence:
 * `stripFrontmatter` is a single anchored replacement, so for a self-fenced
 * document the inner block survives into the body, where `---\ntitle: T\n---` is
 * a thematic break plus a setext H2 under CommonMark. Both export faces render
 * that heading (`marked` emits `<hr><h2>title: T</h2>`), so a parser that omits
 * it would be the wrong one. The law was over-broad, not the implementation.
 *
 * Excluded documents are not dropped — L7 pins what they actually produce.
 */
const SELF_FENCED = (markdown: string): boolean => /^---(\r\n|\n)/.test(markdown);
const L6_DOCS: readonly LawDocument[] = BASE_DOCS.filter((d) => !SELF_FENCED(d.markdown));
const SELF_FENCED_DOCS: readonly LawDocument[] = BASE_DOCS.filter((d) =>
  SELF_FENCED(d.markdown),
);

interface LawRun {
  label: string;
  source: string;
  doc: LawDocument;
}

const runsOf = (suffix: string, transform: (markdown: string) => string): LawRun[] =>
  BASE_DOCS.map((doc) => ({
    label: `${doc.name}[${suffix}]`,
    source: transform(doc.markdown),
    doc,
  }));

/** The L0 domain: every document in LF and in CRLF form. 113 × 2 = 226 runs. */
const LF_CRLF_RUNS: readonly LawRun[] = [
  ...runsOf("lf", (m) => m),
  ...runsOf("crlf", toCRLF),
];

/** L1 additionally rides the frontmatter-prefixed variants (452 runs total). */
const L1_RUNS: readonly LawRun[] = [
  ...LF_CRLF_RUNS,
  ...runsOf("lf+fm", (m) => FRONTMATTER_BLOCK + m),
  ...runsOf("crlf+fm", (m) => toCRLF(FRONTMATTER_BLOCK + m)),
];

const seedTag = `seed=0x${DEFAULT_SEED.toString(16)}`;

/** Failure context: reproducible seed, the document, and a source excerpt. */
function where(run: LawRun, extra = ""): string {
  return `${seedTag} document=${run.label}${extra}\nmarkdown=${JSON.stringify(
    run.source.slice(0, 200),
  )}`;
}

/**
 * L1's normalization. Line endings are folded to `\n` and a **lone `\r` becomes a
 * space**, matching the heading-text normalization rule (B6/B17). Both sides of
 * every L1 comparison are normalized; comparing normalized text against the raw
 * source is the mistake that false-reds a correct implementation.
 */
const norm = (s: string): string => s.replace(/\r\n/g, "\n").replace(/\r/g, " ");

describe("tocService position laws (ADR-0012)", () => {
  it("L0: every law document yields its declared heading count", () => {
    // Non-vacuity: the domain must be populated and must actually contain
    // headings, or every law below passes by describing nothing.
    expect(LF_CRLF_RUNS).toHaveLength(226);
    expect(
      LF_CRLF_RUNS.reduce((n, run) => n + run.doc.expectedHeadingCount, 0),
    ).toBeGreaterThan(0);

    for (const run of LF_CRLF_RUNS) {
      const headings = parseHeadingsFromContent(run.source);
      expect(headings.length, where(run)).toBe(run.doc.expectedHeadingCount);
    }
  });

  it("L1: offset round-trips to the source (ATX and setext branches)", () => {
    for (const run of L1_RUNS) {
      const src = run.source;
      for (const h of parseHeadingsFromContent(src)) {
        const tail = src.slice(h.offset);
        const ctx = where(
          run,
          `\nheading=${JSON.stringify(h)}\nwindow=${JSON.stringify(
            src.slice(h.offset, h.offset + 40),
          )}`,
        );

        // Clause 1: branch by ATX-OPENER SHAPE, not by first character.
        // MEASURED: `"#x\n===\n"` is a SetextHeading1 at from=0 whose first
        // source character is `#`. `src[h.offset] === "#"` would route a correct
        // implementation into the ATX branch and false-red.
        const atx = /^(#{1,6})(?=[ \t\r\n]|$)/.exec(tail);

        if (atx) {
          // Clause 2.
          expect(atx[1].length, ctx).toBe(h.level);
          expect(h.offset === 0 || src[h.offset - 1] !== "#", ctx).toBe(true);
          // `\n` only, consistent with P2 — a lone `\r` is not a line start.
          const lineStart = src.lastIndexOf("\n", h.offset - 1) + 1;
          expect(src.slice(lineStart, h.offset), ctx).toMatch(
            /^[ \t>\-*+0-9.)]*$/,
          );
        } else {
          // Clause 3. Setext has no opening marker, so the law is restated:
          // the normalized tail begins with the first LINE of the heading text.
          // NORMALIZED ON BOTH SIDES — MEASURED, `"a\rb\n===\n"` has text
          // `"a b"`, which is not a prefix of the raw source.
          const textLines = h.text.split("\n");
          const firstTextLine = textLines[0];
          expect(h.level, ctx).toBeLessThanOrEqual(2);
          expect(firstTextLine.length, ctx).toBeGreaterThan(0);
          expect(norm(tail).startsWith(firstTextLine), ctx).toBe(true);

          // Clause 4: the position really is a setext heading, not a mis-parked
          // ATX offset. BOTH the split and the match are taken from `norm(tail)`,
          // never from the raw tail: `/^(=+|-+)[ \t]*$/.test("===\r")` is false,
          // which would false-red every CRLF setext document.
          const lines = norm(tail).split("\n");
          const underline = lines[textLines.length] ?? "";
          // The blockquote-prefix strip is deliberate defensive code: generator
          // constraint 3 excludes nested setext, so it is dead over this domain
          // and becomes reachable the moment that constraint is relaxed.
          expect(
            underline.replace(/^[ \t]*(?:>[ \t]?)*/, ""),
            ctx,
          ).toMatch(/^(=+|-+)[ \t]*$/);
        }
      }
    }
  });

  it("L2: offset and line agree", () => {
    for (const run of LF_CRLF_RUNS) {
      const src = run.source;
      for (const h of parseHeadingsFromContent(src)) {
        // `\n` only. A lone `\r` is not a line terminator on either side of the
        // change (WI-3 parity decision), which is what the `lone-cr` documents
        // are in the domain to pin.
        const newlines = src.slice(0, h.offset).match(/\n/g)?.length ?? 0;
        expect(newlines + 1, where(run, `\nheading=${JSON.stringify(h)}`)).toBe(
          h.line,
        );
      }
    }
  });

  it("L3: CRLF metamorphic relation", () => {
    for (const doc of BASE_DOCS) {
      const lf = parseHeadingsFromContent(doc.markdown);
      const crlf = parseHeadingsFromContent(toCRLF(doc.markdown));
      const base = `${seedTag} document=${doc.name}\nmarkdown=${JSON.stringify(
        doc.markdown.slice(0, 200),
      )}`;

      expect(crlf.length, base).toBe(lf.length);

      for (let i = 0; i < lf.length; i++) {
        const ctx = `${base}\nindex=${i}\nlf=${JSON.stringify(
          lf[i],
        )}\ncrlf=${JSON.stringify(crlf[i])}`;
        expect(
          {
            offset: crlf[i].offset,
            line: crlf[i].line,
            id: crlf[i].id,
            text: crlf[i].text,
            level: crlf[i].level,
          },
          ctx,
        ).toEqual({
          // One extra `\r` per preceding line.
          offset: lf[i].offset + (lf[i].line - 1),
          line: lf[i].line,
          id: lf[i].id,
          text: lf[i].text,
          level: lf[i].level,
        });
      }
    }
  });

  it("L4: offsets and lines are strictly increasing", () => {
    for (const run of LF_CRLF_RUNS) {
      const headings = parseHeadingsFromContent(run.source);
      for (let i = 1; i < headings.length; i++) {
        const ctx = where(
          run,
          `\nprev=${JSON.stringify(headings[i - 1])}\nnext=${JSON.stringify(
            headings[i],
          )}`,
        );
        expect(headings[i].offset, ctx).toBeGreaterThan(headings[i - 1].offset);
        // Strict, not `>=`: ATX and setext both consume their line, so two
        // headings can never share one.
        expect(headings[i].line, ctx).toBeGreaterThan(headings[i - 1].line);
      }
    }
  });

  it("L5: per-document ids are unique, non-empty and well-shaped", () => {
    for (const run of LF_CRLF_RUNS) {
      const ids = parseHeadingsFromContent(run.source).map((h) => h.id);
      const ctx = where(run, `\nids=${JSON.stringify(ids)}`);
      expect(new Set(ids).size, ctx).toBe(ids.length);
      for (const id of ids) {
        expect(id.length, ctx).toBeGreaterThan(0);
        expect(id, ctx).toMatch(SHAPE_RE);
      }
    }
  });

  it("L6: frontmatter metamorphic relation", () => {
    const variants: ReadonlyArray<{
      suffix: string;
      fm: string;
      wrap: (markdown: string) => string;
    }> = [
      { suffix: "lf", fm: FRONTMATTER_BLOCK, wrap: (m) => m },
      { suffix: "crlf", fm: toCRLF(FRONTMATTER_BLOCK), wrap: toCRLF },
    ];

    // The exclusion is itself asserted, so it can never widen unnoticed: a
    // later document that happens to start with `---` would have to be
    // acknowledged here rather than quietly leaving the domain.
    expect(SELF_FENCED_DOCS.map((d) => d.name).sort()).toEqual([
      "frontmatter",
      "frontmatter-setext",
    ]);
    expect(L6_DOCS.length).toBe(BASE_DOCS.length - 2);

    for (const doc of L6_DOCS) {
      for (const variant of variants) {
        const plainSrc = variant.wrap(doc.markdown);
        const withFmSrc = variant.wrap(FRONTMATTER_BLOCK + doc.markdown);
        const plain = parseHeadingsFromContent(plainSrc);
        const withFm = parseHeadingsFromContent(withFmSrc);
        const base = `${seedTag} document=${doc.name}[${variant.suffix}] fmLength=${variant.fm.length}\nmarkdown=${JSON.stringify(
          plainSrc.slice(0, 200),
        )}`;

        expect(withFm.length, base).toBe(plain.length);

        for (let i = 0; i < plain.length; i++) {
          const ctx = `${base}\nindex=${i}\nplain=${JSON.stringify(
            plain[i],
          )}\nwithFm=${JSON.stringify(withFm[i])}`;
          expect(
            {
              offset: withFm[i].offset,
              line: withFm[i].line,
              id: withFm[i].id,
              text: withFm[i].text,
              level: withFm[i].level,
            },
            ctx,
          ).toEqual({
            offset: plain[i].offset + variant.fm.length,
            // FRONTMATTER_BLOCK carries exactly four `\n`.
            line: plain[i].line + 4,
            id: plain[i].id,
            text: plain[i].text,
            level: plain[i].level,
          });
        }
      }
    }
  });

  /**
   * The documents L6 excludes, pinned rather than dropped.
   *
   * Prepending frontmatter to an already-fenced document produces two stacked
   * blocks. `stripFrontmatter` removes one, and the survivor becomes a thematic
   * break plus a setext H2 — which is what CommonMark says it is, and what both
   * export faces render. The count relation L6 asserts therefore cannot hold
   * here; everything else about the relation still does, and is asserted below.
   */
  it("L7: stacked frontmatter yields the inner block as a setext H2", () => {
    const EXPECTED_INNER: Readonly<Record<string, { text: string; id: string }>> = {
      frontmatter: { text: "title: T", id: "title-t" },
      "frontmatter-setext": { text: "a: 1", id: "a-1" },
    };
    // `FRONTMATTER_BLOCK` is 22 chars in LF and 26 in CRLF; the inner fence's
    // first line ends 4 chars in (5 with the `\r`).
    const EXPECTED_OFFSET: Readonly<Record<string, number>> = { lf: 26, crlf: 31 };

    expect(Object.keys(EXPECTED_INNER).sort()).toEqual(
      SELF_FENCED_DOCS.map((d) => d.name).sort(),
    );

    for (const doc of SELF_FENCED_DOCS) {
      for (const variant of [
        { suffix: "lf", fm: FRONTMATTER_BLOCK, wrap: (m: string) => m },
        { suffix: "crlf", fm: toCRLF(FRONTMATTER_BLOCK), wrap: toCRLF },
      ]) {
        const plain = parseHeadingsFromContent(variant.wrap(doc.markdown));
        const withFm = parseHeadingsFromContent(
          variant.wrap(FRONTMATTER_BLOCK + doc.markdown),
        );
        const ctx = `${seedTag} document=${doc.name}[${variant.suffix}]\nplain=${JSON.stringify(
          plain,
        )}\nwithFm=${JSON.stringify(withFm)}`;

        // Exactly one extra heading, at the front — not "at least one".
        expect(withFm.length, ctx).toBe(plain.length + 1);
        expect(
          {
            level: withFm[0].level,
            text: withFm[0].text,
            id: withFm[0].id,
            offset: withFm[0].offset,
            line: withFm[0].line,
          },
          ctx,
        ).toEqual({
          level: 2,
          text: EXPECTED_INNER[doc.name].text,
          id: EXPECTED_INNER[doc.name].id,
          offset: EXPECTED_OFFSET[variant.suffix],
          line: 6,
        });

        // The rest still obeys L6's shift relation exactly — the rebasing is
        // intact, which is the part of L6 that was never in doubt.
        const tail = withFm.slice(1);
        expect(tail.length, ctx).toBe(plain.length);
        for (let i = 0; i < plain.length; i++) {
          expect(
            { offset: tail[i].offset, line: tail[i].line, id: tail[i].id },
            `${ctx}\nindex=${i}`,
          ).toEqual({
            offset: plain[i].offset + variant.fm.length,
            line: plain[i].line + 4,
            id: plain[i].id,
          });
        }
      }
    }
  });
});
