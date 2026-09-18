/**
 * WI-3C — ADR-0007's tier 2, made non-vacuous.
 *
 * ADR-0007 justified the WI-3 resume rule against a divergence class and
 * promised a tier-2 fixture set inside it. ADR-0008 then retired the claim
 * that the seeded corpus makes that class generable: `makeCorpus` tags 138
 * of 200 documents with `hasNonCandidateDelimiter`, but it emits every
 * non-candidate-delimiter block in ISOLATION, so it never reaches the
 * overlap sub-shape. `SCAN-oracle` consequently pinned `divergent === []`
 * — the exemption was real but never fired, which is why
 * `tests/table-scan-enumeration.test.ts` said so in as many words. (It now
 * pins 38 divergent documents there, but for the unrelated WI-C1 / WI-C2
 * reason: phantom REMOVAL, not overlap suppression.)
 *
 * `makeOverlapCorpus` closes that gap. It is a SECOND generator with its
 * own seed and its own `mulberry32` instance: extending `makeCorpus` would
 * shift its PRNG stream and invalidate `CORPUS_TOTAL_BYTES = 64_568`,
 * asserted in `tests/table-line-index.test.ts` under an open red receipt.
 * `OVERLAP-generators-independent` asserts both totals side by side, so a
 * stream that leaked across fails here rather than three suites away.
 *
 * What this corpus generates is the CHAIN: a table whose delimiter row is
 * not a candidate line, followed by another body row and another
 * non-candidate delimiter, so one body row is a body row of table N and
 * the header of table N+1. ADR-0007's measured F3 —
 *   "| a | b |\n    | - | - |\n| 1 | 2 |\n    | - | - |\n| 3 | 4 |\n"
 * legacy `[[0, 33], [24, 57]]`, WI-3 scanner `[[0, 33]]`
 * — is the two-delimiter, two-column member of exactly this family, and is
 * pinned by literal below as the anchor tying the generator to the ADR.
 *
 * WI-C1 / WI-C2 (2026-09-18) rewrote what this corpus DIVERGES about, and
 * the rewrite is the honest part of this file. ADR-0008 measured the three
 * shapes against `micromark-extension-gfm-table@2.1.2` and they do not
 * agree with each other: `---` / `----` lose to the setext H2 underline
 * and a 4+-column indent is a paragraph — both yield ZERO GFM tables — but
 * `:-:` is a real delimiter row and yields ONE. mdpro over-detected all
 * three; it now detects only the third.
 *
 * Two consequences this file records rather than hides:
 *
 *  - The `indented` half of the corpus (100 documents) and the `---` /
 *    `----` delimiters in the `pipeless` half now yield NO table at all.
 *    118 of the 200 documents are empty enumerations. That is a real loss
 *    of Source-mode detection on documents that showed a table yesterday;
 *    it is the intended effect (they were never GFM tables) and it is
 *    pinned by literal, not smoothed over.
 *  - F3 itself is one of those documents. Its old live value `[[0, 33]]`
 *    is gone; it is `[]` now. Rather than delete the ADR anchor, both
 *    values are asserted below — the frozen copy's overlap AND the live
 *    empty — and the live tier-2 overlap moves to the `:-:` chain, which
 *    IS valid GFM and which this same generator emits.
 *
 * Gate G0: no new dependency. `mulberry32` is the only entropy source; the
 * frozen `legacyTableScan` copy is the only oracle. No mocks.
 */

import { describe, expect, it } from "vitest";

import { findAllTables } from "../src/utils/cursorSync/table";
import { linesFromString } from "../src/utils/tableParser/lines";
import { scanTables } from "../src/utils/tableParser/scan";
import type { LineRange, TableModel } from "../src/utils/tableParser/types";
import {
  legacyFindAllTables,
  legacyIsDelimiterLine,
  legacyIsTableCandidateLine,
} from "./support/legacyTableScan";
import {
  makeCorpus,
  makeOverlapCorpus,
  OVERLAP_CORPUS_COUNT,
  OVERLAP_CORPUS_TOTAL_BYTES,
  OVERLAP_SEED,
  SEED,
  type OverlapCorpusDoc,
} from "./support/tableCorpus";

const CORPUS: OverlapCorpusDoc[] = makeOverlapCorpus(OVERLAP_SEED, OVERLAP_CORPUS_COUNT);

/**
 * `makeCorpus`'s byte total, restated from `tests/table-line-index.test.ts:47`.
 * Restated rather than imported ON PURPOSE: the point of asserting it here is
 * that this file's generator did not perturb that one's PRNG stream, and an
 * assertion that reads its expectation from the same place the other suite
 * does would agree with itself after a shared edit.
 */
const BASE_CORPUS_TOTAL_BYTES = 64_568;

const spans = (models: readonly TableModel[]): [number, number][] =>
  models.map((m) => [m.start, m.end]);

/** Legacy's list with every model that overlaps its predecessor dropped. */
function suppressOverlaps(models: readonly TableModel[]): TableModel[] {
  const out: TableModel[] = [];
  for (const m of models) {
    if (out.length > 0 && m.start < out[out.length - 1].end) continue;
    out.push(m);
  }
  return out;
}

/** Does this model list contain a pair where the later one starts early? */
function hasOverlap(models: readonly TableModel[]): boolean {
  for (let i = 1; i < models.length; i += 1) {
    if (models[i].start < models[i - 1].end) return true;
  }
  return false;
}

/** A standalone `LineRange` for the frozen line predicates. */
const asLine = (text: string): LineRange => ({ start: 0, end: text.length, text });

/**
 * The delimiter row of `model` — the line directly below its header.
 *
 * Located by scanning for the line whose `start` IS `model.start`, never
 * via `lineIndexAt`: that resolver treats an offset equal to `line.end + 1`
 * as belonging to the line above, so it would hand back the line before the
 * header and quietly mis-classify every model.
 */
function delimiterRowOf(src: string, model: TableModel): string {
  const lines = linesFromString(src);
  let i = 0;
  while (i < lines.lineCount && lines.line(i).start !== model.start) i += 1;
  return lines.line(i + 1).text.replace(/\r$/, "");
}

/**
 * The two reasons GFM refuses a delimiter row that mdpro used to accept,
 * restated from the SHAPES (ADR-0008's measurements) rather than imported
 * from `src/utils/tableParser/commonmark.ts`. Importing the implementation
 * would make the assertions below agree with themselves.
 *
 *  - a run of `-` alone on the line is a setext H2 underline (WI-C1);
 *  - 4+ columns of indent, tabs advancing to the next multiple of 4, is an
 *    indented code block or a paragraph continuation (WI-C2).
 */
function gfmRejectsDelimiter(text: string): boolean {
  if (/^\s*-+\s*$/.test(text)) return true;
  let col = 0;
  for (const ch of text) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
  }
  return col > 3;
}

interface Scanned {
  doc: OverlapCorpusDoc;
  /** The frozen copy's enumeration. */
  legacy: TableModel[];
  /** The WI-3 scanner's enumeration. */
  next: TableModel[];
}

/**
 * Both enumerations, computed ONCE per document.
 *
 * Not an optimisation for its own sake: `legacyFindAllTables` is the
 * quadratic implementation WI-1 exists to replace, and re-running it in
 * each case put enough CPU on a parallel worker to flip
 * `tests/table-scan-scaling.test.ts`'s wall-clock `WI1-growth` ratio.
 * Every value below is still the real value from the real function; only
 * the number of times it is computed changed.
 */
const SCANNED: Scanned[] = CORPUS.map((doc) => ({
  doc,
  legacy: legacyFindAllTables(doc.source),
  next: scanTables(linesFromString(doc.source)),
}));

/** ADR-0007's F3, measured against the shipped code on 2026-09-17. */
const F3 = "| a | b |\n    | - | - |\n| 1 | 2 |\n    | - | - |\n| 3 | 4 |\n";

/**
 * The `:-:` member of the same chain family, measured 2026-09-18. This is
 * the anchor that carries ADR-0007's tier 2 after WI-C2 took F3 away: a
 * single-column header, a valid GFM delimiter row with no pipe, and a
 * second delimiter that makes the frozen copy re-enter and overlap.
 */
const F5 = "| a |\n:-:\n| 1 |\n:-:\n| 3 |\n";

describe("table scan overlap corpus (WI-3C)", () => {
  // -------------------------------------------------------------------
  // The generator itself
  // -------------------------------------------------------------------

  it("OVERLAP-generators-independent: the second generator leaves the first byte-identical", () => {
    const overlapBytes = CORPUS.reduce((sum, doc) => sum + doc.source.length, 0);
    expect(overlapBytes).toBe(OVERLAP_CORPUS_TOTAL_BYTES);

    // The whole reason this file exists rather than a new `BLOCK_KIND`.
    // `tests/table-line-index.test.ts` asserts this same number against its
    // own local literal; asserting it here too is what makes a leak between
    // the two `mulberry32` streams fail at the generator, not downstream.
    const base = makeCorpus(SEED, 200);
    expect(base.reduce((sum, doc) => sum + doc.source.length, 0)).toBe(
      BASE_CORPUS_TOTAL_BYTES,
    );
  });

  it("OVERLAP-deterministic: the generator is stable and every dimension is present", () => {
    const first = makeOverlapCorpus(OVERLAP_SEED, OVERLAP_CORPUS_COUNT);
    const second = makeOverlapCorpus(OVERLAP_SEED, OVERLAP_CORPUS_COUNT);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.length).toBe(200);

    const count = (pick: (doc: OverlapCorpusDoc) => boolean): number =>
      first.filter(pick).length;

    // Both sub-shapes are guaranteed by `i % 2`, so these are exact.
    expect(count((d) => d.shape === "pipeless")).toBe(100);
    expect(count((d) => d.shape === "indented")).toBe(100);

    // PRNG-driven dimensions: present, pinned by literal so drift is loud.
    expect(count((d) => d.crlf)).toBe(48);
    expect(count((d) => !d.trailingNewline)).toBe(34);
    expect(count((d) => d.chains === 2)).toBe(102);
    expect(count((d) => d.delimitersPerChain.some((n) => n >= 3))).toBeGreaterThan(0);

    // Every chain carries at least the two delimiters the overlap needs.
    for (const doc of first) {
      expect(doc.delimitersPerChain.length, `doc ${doc.index}: chain count`).toBe(
        doc.chains,
      );
      for (const n of doc.delimitersPerChain) {
        expect(n, `doc ${doc.index}: delimiters per chain`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("OVERLAP-shape: every generated delimiter is a delimiter row that is NOT a candidate line", () => {
    // The class is defined by the two frozen predicates disagreeing. Read
    // from the frozen copy, never re-derived here, so this cannot drift
    // with the live implementation.
    let delimiters = 0;

    for (const doc of CORPUS) {
      const lines = doc.source.split("\n").map((raw) => raw.replace(/\r$/, ""));
      let inDoc = 0;
      for (const text of lines) {
        const line = asLine(text);
        if (!legacyIsDelimiterLine(line) || legacyIsTableCandidateLine(line)) continue;
        inDoc += 1;
        delimiters += 1;
        if (doc.shape === "pipeless") {
          expect(text, `doc ${doc.index}: pipe-less delimiter`).toMatch(/^:?-+:?$/);
        } else {
          expect(text, `doc ${doc.index}: indented delimiter`).toMatch(/^ {4}\|/);
        }
      }
      // Exactly the declared delimiters fall into the class — no more (a
      // body row that drifted into delimiter shape) and no fewer.
      expect(inDoc, `doc ${doc.index}: non-candidate delimiter count`).toBe(
        doc.delimitersPerChain.reduce((a, b) => a + b, 0),
      );
    }

    expect(delimiters, "the corpus must actually reach the class").toBeGreaterThan(400);
  });

  // -------------------------------------------------------------------
  // The divergence, on generated documents
  // -------------------------------------------------------------------

  it("OVERLAP-legacy-overlaps: the frozen copy emits overlapping models on every document", () => {
    let overlapping = 0;
    const byShape = { pipeless: 0, indented: 0 };

    for (const { doc, legacy } of SCANNED) {
      if (!hasOverlap(legacy)) continue;
      overlapping += 1;
      byShape[doc.shape] += 1;

      // Characterize the overlap rather than merely counting it: the
      // offending model starts strictly inside its predecessor, on the body
      // row the two tables share.
      const at = legacy.findIndex((m, i) => i > 0 && m.start < legacy[i - 1].end);
      expect(legacy[at].start, `doc ${doc.index}: starts after its predecessor`)
        .toBeGreaterThan(legacy[at - 1].start);
      expect(
        doc.source.slice(legacy[at].start, legacy[at - 1].end).length,
        `doc ${doc.index}: the shared bytes`,
      ).toBeGreaterThan(0);
    }

    // Pinned by literal. This is the number `SCAN-oracle` could not produce:
    // there, the tier-2 exemption fires on 0 of 200 documents.
    expect(overlapping, "documents where the frozen copy overlaps").toBe(200);
    expect(byShape).toEqual({ pipeless: 100, indented: 100 });
  });

  /**
   * WI-C1 / WI-C2 changed the premise of this case.
   *
   * It used to open with `models.length > 0` on every document, which was
   * true when mdpro detected all three delimiter spellings. It is false
   * now: the `indented` half and the `---` / `----` delimiters are no
   * longer tables, so 118 of 200 documents enumerate to nothing. The
   * assertion is rewritten rather than deleted — the new literal says
   * exactly which documents still carry a table and which no longer do,
   * so a regression in EITHER direction fails here.
   */
  it("OVERLAP-nonoverlapping: scanTables emits pairwise non-overlapping models", () => {
    let withTables = 0;
    const withByShape = { pipeless: 0, indented: 0 };
    const withoutByShape = { pipeless: 0, indented: 0 };

    for (const { doc, next: models } of SCANNED) {
      const src = doc.source;

      if (models.length > 0) {
        withTables += 1;
        withByShape[doc.shape] += 1;
      } else {
        withoutByShape[doc.shape] += 1;
      }

      for (let i = 0; i < models.length; i += 1) {
        const m = models[i];
        expect(m.start, `doc ${doc.index} model ${i}: start < end`).toBeLessThan(m.end);
        expect(src.slice(m.start, m.end), `doc ${doc.index} model ${i}: slice === raw`).toBe(
          m.raw,
        );
        if (i > 0) {
          expect(
            models[i - 1].start,
            `doc ${doc.index} model ${i}: starts strictly increasing`,
          ).toBeLessThan(m.start);
          // ADR-0007's Decision, asserted on documents that can actually
          // violate it. Unscoped: this is an invariant of the new scanner.
          expect(
            models[i - 1].end,
            `doc ${doc.index} model ${i}: emitted models must not overlap`,
          ).toBeLessThanOrEqual(m.start);
        }
      }

      // `findAllTables` must be exactly the string-source delegation, and a
      // second scan of the same document must be byte-for-byte the first.
      // These are fresh calls, not the cached ones.
      expect(findAllTables(src), `doc ${doc.index}: delegation and determinism`).toEqual(
        models,
      );
    }

    // Pinned by literal, measured 2026-09-18. `pipeless` documents draw
    // their delimiters from `["---", ":-:", "----"]`, so 82 of the 100 of
    // them happen to contain at least one `:-:` chain and still yield a
    // table; the other 18 and all 100 `indented` documents now yield none.
    expect(withTables, "documents that still enumerate at least one table").toBe(82);
    expect(withByShape).toEqual({ pipeless: 82, indented: 0 });
    expect(withoutByShape).toEqual({ pipeless: 18, indented: 100 });
  });

  /**
   * This case used to assert `next === suppressOverlaps(legacy)` — one
   * permitted difference, overlap suppression. WI-C1 / WI-C2 added a
   * SECOND permitted difference (dropping a model whose delimiter row GFM
   * rejects), so the old equation is false and is replaced by the
   * composition of the two, in order: reject the phantoms, THEN suppress
   * the overlaps that remain. It is still an exact equality with a causal
   * predicate on each step, not a tolerance, and each step's contribution
   * is counted separately so neither can quietly absorb the other.
   */
  it("OVERLAP-tier2-fires: the new scanner drops exactly legacy's phantoms and overlaps", () => {
    let divergent = 0;
    let tier2Docs = 0;
    let droppedPhantom = 0;
    let droppedOverlap = 0;
    let totalNext = 0;
    let totalLegacy = 0;

    for (const { doc, legacy, next } of SCANNED) {
      const src = doc.source;
      const gfmValid = legacy.filter((m) => !gfmRejectsDelimiter(delimiterRowOf(src, m)));

      expect(
        next,
        `doc ${doc.index}: next === suppressOverlaps(gfm-valid subset of legacy)`,
      ).toEqual(suppressOverlaps(gfmValid));

      totalNext += next.length;
      totalLegacy += legacy.length;
      if (JSON.stringify(next) !== JSON.stringify(legacy)) divergent += 1;

      // Attribute every dropped model to exactly one of the two causes.
      const kept = new Set(next.map((m) => `${m.start},${m.end}`));
      let firedHere = false;
      for (const m of legacy) {
        if (kept.has(`${m.start},${m.end}`)) continue;
        if (gfmRejectsDelimiter(delimiterRowOf(src, m))) droppedPhantom += 1;
        else {
          droppedOverlap += 1;
          firedHere = true;
        }
      }
      if (firedHere) tier2Docs += 1;
    }

    // The point of the whole file: the tier-2 exemption is exercised, not
    // merely declared. `SCAN-oracle` reaches it on 0 of `makeCorpus`'s 200
    // documents; here 29 documents drop a model for overlap alone, on a
    // `:-:` chain that is valid GFM — so the exemption survives WI-C1 /
    // WI-C2 rather than being an artefact of the phantoms they removed.
    expect(tier2Docs, "documents where overlap suppression alone drops a model").toBe(29);
    expect(droppedOverlap, "models dropped for overlap alone").toBe(37);

    // The other cause, pinned so the two can never trade places.
    expect(droppedPhantom, "models dropped because GFM rejects the delimiter").toBe(727);
    expect(totalLegacy - totalNext, "every dropped model is accounted for").toBe(
      droppedPhantom + droppedOverlap,
    );
    expect([totalLegacy, totalNext], "frozen total vs live total").toEqual([891, 127]);

    // Unchanged claim, unchanged value: every document differs somehow.
    expect(divergent, "documents where the two enumerations differ").toBe(200);
  });

  it("OVERLAP-survivors-are-gfm: every model that survives has a delimiter GFM accepts", () => {
    const delimiters = new Set<string>();
    for (const { doc, next } of SCANNED) {
      for (const m of next) delimiters.add(delimiterRowOf(doc.source, m));
    }
    // The strongest statement WI-C1 / WI-C2 earn on this corpus: of the
    // three spellings the generator emits, only the GFM-valid one is left.
    expect([...delimiters]).toEqual([":-:"]);
  });

  it("OVERLAP-canonical-f3: the generated family's measured member, and where the anchor moved", () => {
    expect(spans(legacyFindAllTables(F3)), "frozen legacy still overlaps on F3").toEqual([
      [0, 33],
      [24, 57],
    ]);
    // WI-C2. Was `[[0, 33]]`. F3's delimiter rows are `    | - | - |` —
    // four indent columns — so GFM sees a paragraph and emits no table,
    // and so, now, does mdpro. The ADR-0007 anchor is NOT deleted: the
    // frozen overlap above is still asserted, and the live tier-2 claim
    // moves to F5 below, which is the same chain in a spelling GFM accepts.
    expect(spans(findAllTables(F3)), "WI-C2: F3 is an indented paragraph").toEqual([]);

    expect(spans(legacyFindAllTables(F5)), "frozen legacy overlaps on F5 too").toEqual([
      [0, 15],
      [10, 25],
    ]);
    expect(spans(findAllTables(F5)), "ADR-0007: emitted models never overlap").toEqual([
      [0, 15],
    ]);

    // F3 is the two-delimiter `indented` member of what the generator
    // emits. Asserted as a line-kind sequence read from the FROZEN
    // predicates, so "same family" means the same alternation of candidate
    // row and non-candidate delimiter, not a resemblance claimed in prose.
    const kinds = (src: string): string[] =>
      src
        .replace(/\r\n/g, "\n")
        .replace(/\n$/, "")
        .split("\n")
        .map((text) => {
          const line = asLine(text);
          if (legacyIsDelimiterLine(line) && !legacyIsTableCandidateLine(line)) return "ncd";
          return legacyIsTableCandidateLine(line) ? "row" : "other";
        });

    expect(kinds(F3)).toEqual(["row", "ncd", "row", "ncd", "row"]);
    // F5 is the same line-kind sequence, which is the point: the anchor
    // moved spelling, not family.
    expect(kinds(F5)).toEqual(kinds(F3));

    const sample = CORPUS.find(
      (d) => d.shape === "indented" && d.chains === 1 && d.delimitersPerChain[0] === 2,
    );
    expect(sample, "the generator must reach F3's exact arity").toBeDefined();
    expect(kinds(sample!.source)).toEqual(kinds(F3));

    // And the generator reaches F5's arity too, in the pipeless shape —
    // so the live anchor is a member of this corpus and not a one-off.
    const colon = CORPUS.find(
      (d) =>
        d.shape === "pipeless" &&
        d.chains === 1 &&
        d.delimitersPerChain[0] === 2 &&
        d.source.includes(":-:"),
    );
    expect(colon, "the generator must reach F5's exact arity").toBeDefined();
    expect(kinds(colon!.source)).toEqual(kinds(F5));
  });
});
