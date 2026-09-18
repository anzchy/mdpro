/**
 * WI-3 — the linear block scanner (`src/utils/tableParser/scan.ts#scanTables`)
 * and the `findAllTables` delegation in `src/utils/cursorSync/table.ts`.
 *
 * Two things are being specified here at once:
 *
 *  1. **Enumeration identity.** Probing once per maximal run of
 *     table-candidate lines must enumerate exactly what probing once per
 *     line enumerated. `SCAN-oracle` asserts that against
 *     `tests/support/legacyTableScan.ts`, a FROZEN byte-copy of the shipped
 *     implementation. That file is never updated to match new behaviour.
 *
 *     WI-C1 / WI-C2 (2026-09-18) made that identity CONDITIONAL, and the
 *     condition is written into `SCAN-oracle` rather than papered over:
 *     outside the divergence class the two are still exactly equal, and
 *     inside it the only permitted difference is the removal of a model
 *     whose delimiter row GFM rejects. See that case for what it now
 *     asserts and why.
 *
 *  2. **The characterized divergence, as narrowed by WI-C1 / WI-C2.** A
 *     delimiter row that mdpro's `isDelimiterLine` accepts while
 *     `isTableCandidateLine` rejects it makes a model's line span exceed
 *     its candidate run. ADR-0008 measured all three historical spellings
 *     against `micromark-extension-gfm-table@2.1.2` and found that GFM
 *     accepts only ONE of them:
 *
 *       - `---`            setext H2 underline; GFM emits zero tables.
 *       - `    | - | - |`  4+ columns of indent; a paragraph. Zero tables.
 *       - `:-:`            a real GFM delimiter row. One table.
 *
 *     `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` §5.1 closed
 *     the first two: the setext spelling loses to setext in `parse.ts`, and
 *     indentation is now measured in CommonMark columns before trimming, so
 *     tabs count too. The class is therefore no longer empty — `:-:`
 *     survives — but every member of it is now valid GFM.
 *
 *     The shipped scanner re-enters through the `offset === line.end + 1`
 *     resolver fudge and emits a SECOND, OVERLAPPING model. ADR-0007
 *     (Accepted 2026-09-17) decided the rewritten scanner resumes after the
 *     last line of the model it emitted, so emitted models never overlap.
 *     `SCAN-noncandidate-delimiter` pins BOTH sides by literal value, so the
 *     divergence is asserted to exist and cannot quietly disappear.
 *
 * `src/utils/tableParser/scan.ts` is loaded per case with a dynamic import
 * rather than at file scope. That is deliberate: this suite was written
 * before that module existed, and a file-scope import of a missing module
 * turns every case in the file into one unresolved-import error — which
 * would have drowned the `SCAN-noncandidate-delimiter` red instead of
 * showing it. The file is byte-identical either side of that receipt.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  captureCellFromSource,
  findAllTables,
  locateCellInSource,
  type IsFenced,
} from "../src/utils/cursorSync/table";
import { linesFromString, type TableLineSource } from "../src/utils/tableParser/lines";
import type { LineRange, TableModel } from "../src/utils/tableParser/types";
import { legacyFindAllTables } from "./support/legacyTableScan";
import { makeCorpus, SEED, type CorpusDoc } from "./support/tableCorpus";

const CORPUS: CorpusDoc[] = makeCorpus(SEED, 200);

type ScanTables = (source: TableLineSource, isFenced?: IsFenced) => TableModel[];

/** See the module header for why this is not a file-scope import. */
async function loadScanTables(): Promise<ScanTables> {
  const mod = await import("../src/utils/tableParser/scan");
  return mod.scanTables as ScanTables;
}

// ---------------------------------------------------------------------------
// Helpers — no mocks anywhere in this file. `countingSource` DECORATES the
// real `linesFromString`; every value it hands back is the real value.
// ---------------------------------------------------------------------------

const spans = (models: readonly TableModel[]): [number, number][] =>
  models.map((m) => [m.start, m.end]);

interface CountedSource {
  source: TableLineSource;
  reads: () => number;
}

/**
 * A pass-through decorator over the real string line source whose
 * `LineRange.text` is a counting getter. Counts how many times the scan
 * goes back to the LINE SOURCE for a line's text — which is all it can
 * see. Work done on a cached array is invisible here; the growth law is
 * carried by `SCAN-bigrun-completes`, not by any read count.
 */
function countingSource(src: string): CountedSource {
  const real = linesFromString(src);
  let reads = 0;

  const wrap = (line: LineRange): LineRange => {
    const out = { start: line.start, end: line.end } as LineRange;
    Object.defineProperty(out, "text", {
      enumerable: true,
      get(): string {
        reads += 1;
        return line.text;
      },
    });
    return out;
  };

  const decorated: TableLineSource = {
    get length(): number {
      return real.length;
    },
    get lineCount(): number {
      return real.lineCount;
    },
    line: (index: number) => wrap(real.line(index)),
    lineIndexAt: (offset: number) => real.lineIndexAt(offset),
    iterLines: function* iterLines(): Iterable<LineRange> {
      for (const line of real.iterLines()) yield wrap(line);
    },
    slice: (start: number, end: number) => real.slice(start, end),
  };

  return { source: decorated, reads: () => reads };
}

/** `n` pipe-bearing lines with NO delimiter row — one maximal candidate run. */
function oneRunOf(lines: number): string {
  return "|a|b|\n".repeat(lines);
}

/** The same line count, with every tenth line REPLACED (not inserted) by a blank. */
function choppedRunOf(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) out.push(i % 10 === 9 ? "" : "|a|b|");
  return `${out.join("\n")}\n`;
}

/**
 * A synthetic offset-range fence predicate over the corpus's fenced
 * blocks. Not a mock: `isFenced` is a parameter of the public signature,
 * and this is the same seam `tests/cursor-sync-table.test.ts:70` uses.
 */
function syntheticIsFenced(src: string): IsFenced {
  const ranges: [number, number][] = [];
  let open: number | null = null;
  let pos = 0;
  for (const raw of src.split("\n")) {
    const text = raw.replace(/\r$/, "");
    if (/^(```|~~~)/.test(text)) {
      if (open === null) open = pos;
      else {
        ranges.push([open, pos + text.length]);
        open = null;
      }
    }
    pos += raw.length + 1;
  }
  if (open !== null) ranges.push([open, src.length]);
  return (offset: number) => ranges.some(([a, b]) => offset >= a && offset < b);
}

/**
 * The delimiter row of `model` — the line directly below its header.
 *
 * Found by scanning for the line whose `start` IS `model.start`, not via
 * `lineIndexAt`, because that resolver treats an offset equal to
 * `line.end + 1` as belonging to the line above and would hand back the
 * paragraph line before the header.
 */
function delimiterRowOf(src: string, model: TableModel): string {
  const lines = linesFromString(src);
  let i = 0;
  while (i < lines.lineCount && lines.line(i).start !== model.start) i += 1;
  return lines.line(i + 1).text.replace(/\r$/, "");
}

/**
 * The two delimiter spellings WI-C1 and WI-C2 took away from the detector,
 * restated here from the shapes rather than imported from the source under
 * test: a `-`-only line is a setext H2 underline, and 4+ CommonMark columns
 * of indent (a tab counts as up to 4) is a paragraph continuation. Both
 * yield zero GFM tables — measured against
 * `micromark-extension-gfm-table@2.1.2` on 2026-09-17.
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

/** Legacy's list with every model that overlaps its predecessor dropped. */
function suppressOverlaps(models: readonly TableModel[]): TableModel[] {
  const out: TableModel[] = [];
  for (const m of models) {
    if (out.length > 0 && m.start < out[out.length - 1].end) continue;
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SCAN-noncandidate-delimiter — the ADR-0007 class
// ---------------------------------------------------------------------------

const NCD = {
  /** pipe-less delimiter — `isDelimiterLine` accepts, `isTableCandidateLine` rejects */
  F1: "| a |\n---\n| b |\n",
  /** 4+ spaces of indent — accepted by the delimiter check, rejected on MAX_INDENT */
  F2: "| a | b |\n    | - | - |\n| 1 | 2 |\n",
  /** the overlap: `| 1 | 2 |` is a body row of table 1 AND the header of table 2 */
  F3: "| a | b |\n    | - | - |\n| 1 | 2 |\n    | - | - |\n| 3 | 4 |\n",
  /** a delimiter-shaped body row inside an already-open table */
  F4: "|a|\n---\n|b|\n|-|\n|d|\n",
  /**
   * WI-C1/C2 addition: the same overlap shape spelled with the ONE
   * non-candidate delimiter GFM accepts. `:-:` carries a colon, so it is
   * not a setext underline and is not indented — it survives the
   * narrowing, and it is what keeps the ADR-0007 class non-empty.
   */
  F5: "| a |\n:-:\n| 1 |\n:-:\n| 3 |\n",
} as const;

/** Measured against the shipped code on 2026-09-17. Never relaxed. */
const LEGACY_SPANS: Record<keyof typeof NCD, [number, number][]> = {
  F1: [[0, 15]],
  F2: [[0, 33]],
  F3: [
    [0, 33],
    [24, 57],
  ],
  F4: [[0, 19]],
  F5: [
    [0, 15],
    [10, 25],
  ],
};

/**
 * Measured against the live detector on 2026-09-18, after WI-C1 (setext
 * beats the table delimiter) and WI-C2 (indentation in CommonMark columns,
 * tabs included). Four of these five literals CHANGED with that work, and
 * the change is the point of the work item, not a regression:
 *
 *   F1 `[[0, 15]]` -> `[]`     `---` is a setext H2 underline (GFM: 0 tables)
 *   F2 `[[0, 33]]` -> `[]`     4 columns of indent is a paragraph (GFM: 0)
 *   F3 `[[0, 33]]` -> `[]`     same, twice over
 *   F4 `[[0, 19]]` -> `[[8, 19]]`
 *   F5 `[[0, 15], [10, 25]]` -> `[[0, 15]]`  unchanged by the narrowing
 *
 * F4 is the one worth reading twice: dropping the phantom does not simply
 * subtract a model, it UNCOVERS a different one. `|a|` / `---` stops being
 * a table, so the scanner reaches `|b|` / `|-|` / `|d|` — a real GFM table
 * the old detector had swallowed into the phantom's span. A span that
 * legacy never emitted therefore appears, which is why nothing here claims
 * the new output is a subset of legacy in general.
 *
 * ADR-0007 (re-affirmed unchanged by ADR-0008) still governs F5: the
 * scanner resumes after the last line of the model it emitted, so emitted
 * models never overlap. Legacy's overlapping pair is still asserted below,
 * by literal, against the frozen copy — the divergence is pinned on BOTH
 * sides.
 */
// Resolved by ADR-0007 (Accepted 2026-09-17): the scanner resumes after the
// last line of the model it emitted, so emitted models never overlap.
// Legacy's overlapping output is still asserted, against the frozen copy.
//
// WI-C1/C2 changed which fixture this constant governs, and nothing else
// about it. It used to select `EXPECTED_SPANS.F3`; F3 now yields no table on
// either side of the decision — its delimiter rows are 4 CommonMark columns
// of indent, so there is no overlap left there to have a policy about. F5,
// the `:-:` spelling GFM accepts, carries it instead. The constant is NOT
// deleted: it is the named record of what was decided, it is no longer an
// open question, and flipping it back would contradict an Accepted ADR —
// which is a new ADR's job, not an edit to this file.
const OVERLAP_POLICY = "suppress" as "preserve-legacy" | "suppress";

const EXPECTED_SPANS: Record<keyof typeof NCD, [number, number][]> = {
  F1: [],
  F2: [],
  F3: [],
  F4: [[8, 19]],
  F5: OVERLAP_POLICY === "preserve-legacy" ? [[0, 15], [10, 25]] : [[0, 15]],
};

describe("table scan enumeration (WI-3)", () => {
  // -------------------------------------------------------------------
  // The divergence class
  // -------------------------------------------------------------------

  it("SCAN-noncandidate-delimiter: a valid delimiter that is not a candidate line", () => {
    // Every fixture, both sides by literal. The frozen copy is unchanged —
    // it is a byte-copy of the pre-WI-3 implementation and is never updated
    // — so LEGACY_SPANS still holds and every difference below is the live
    // detector moving, which is exactly what is being recorded.
    for (const key of ["F1", "F2", "F3", "F4", "F5"] as const) {
      const src = NCD[key];
      expect(spans(legacyFindAllTables(src)), `legacy ${key}`).toEqual(LEGACY_SPANS[key]);
      expect(spans(findAllTables(src)), `next ${key}`).toEqual(EXPECTED_SPANS[key]);
    }

    // WI-C1: `---` under a one-column header is a setext H2 underline, so
    // the whole document is a heading plus a paragraph and mdpro now agrees
    // with GFM that it holds no table. This literal was `"| a |\n---\n| b |"`.
    expect(findAllTables(NCD.F1), "F1 is an <h2> and a paragraph").toEqual([]);

    // WI-C1 again, and the case §5.3 of the plan insisted must not be
    // discovered by accident: F4's phantom is not merely subtracted. With
    // `|a|` / `---` no longer opening a table, the scanner reaches the real
    // table below it, which the phantom's span had swallowed. This literal
    // was `"|a|\n---\n|b|\n|-|\n|d|"` — a span starting at 0.
    expect(findAllTables(NCD.F4)[0].raw).toBe("|b|\n|-|\n|d|");
    expect(findAllTables(NCD.F4)[0].start, "the <h2> is no longer inside a table").toBe(8);

    // F3 — still the fixture that separates the two implementations, but
    // now on a stronger claim than before: the new detector finds NOTHING
    // here, so the overlap cannot arise in the first place.
    //
    // Mechanism (never in an `expect`): after emitting `[0, 33]` the shipped
    // loop sets `pos = 48`, and offset resolution matches the INDENTED
    // DELIMITER line first because the `end + 1` fudge makes `48 <= 47 + 1`
    // true. The probe then walks up to `| 1 | 2 |` and builds a second
    // table. WI-C2 removes the input to that mechanism: `    | - | - |` is 4
    // CommonMark columns of indent, so it is not a delimiter row at all.
    const legacyF3 = legacyFindAllTables(NCD.F3);
    expect(spans(legacyF3), "frozen legacy still overlaps on F3").toEqual([
      [0, 33],
      [24, 57],
    ]);
    expect(legacyF3[1].raw).toBe("| 1 | 2 |\n    | - | - |\n| 3 | 4 |");
    expect(findAllTables(NCD.F3), "WI-C2: an indented delimiter is a paragraph").toEqual(
      [],
    );

    // F5 — the ADR-0007 overlap, on the one spelling that survives WI-C1
    // and WI-C2. `:-:` is a real GFM delimiter row, so this divergence is
    // still live and still pinned on BOTH sides.
    const legacyF5 = legacyFindAllTables(NCD.F5);
    const nextF5 = findAllTables(NCD.F5);
    expect(spans(legacyF5), "frozen legacy still overlaps on F5").toEqual([
      [0, 15],
      [10, 25],
    ]);
    expect(legacyF5[1].raw).toBe("| 1 |\n:-:\n| 3 |");
    expect(spans(nextF5), "ADR-0007: emitted models never overlap").toEqual(
      EXPECTED_SPANS.F5,
    );
    expect(nextF5[0].raw).toBe("| a |\n:-:\n| 1 |");
    expect(
      nextF5,
      "the divergence must exist — a green here with both sides equal means the exemption went dead",
    ).not.toEqual(legacyF5);
  });

  it("SCAN-noncandidate-delimiter: ADR-0007 tier 2 — tableIndex and the cursor-sync round-trip on F5", () => {
    // Re-targeted from F3 to F5 by WI-C1/C2. F3 no longer contains a table
    // on either side of the fudge, so it can no longer carry a round-trip
    // claim; F5 is the same shape spelled with the delimiter GFM accepts.
    const src = NCD.F5;

    // The single surviving model is tables[0]; `| 1 |` is its row 1.
    const captured = captureCellFromSource(src, 11);
    expect(captured).toEqual({ tableIndex: 0, rowIndex: 1, colIndex: 0 });
    expect(locateCellInSource(src, captured!)).toBe(11);

    // The consequence the ADR was weighed against, asserted rather than
    // assumed: legacy enumerated a second table covering `| 3 |`, so a
    // cursor at offset 22 captured into it. Under ADR-0007 no model covers
    // that offset and the capture is null.
    const legacyModels = legacyFindAllTables(src);
    expect(legacyModels[1].start <= 22 && 22 <= legacyModels[1].end).toBe(true);
    expect(findAllTables(src).some((m) => m.start <= 22 && 22 <= m.end)).toBe(false);
    expect(captureCellFromSource(src, 22)).toBeNull();
  });

  // -------------------------------------------------------------------
  // The oracle
  // -------------------------------------------------------------------

  it("SCAN-oracle: identity outside the class, and only phantom removal inside it", () => {
    const divergent: number[] = [];
    const dropped: { doc: number; delimiter: string }[] = [];
    const invented: number[] = [];

    for (const doc of CORPUS) {
      for (const fenced of [undefined, syntheticIsFenced(doc.source)]) {
        const next = findAllTables(doc.source, fenced);
        const legacy = legacyFindAllTables(doc.source, fenced);

        if (doc.tags.hasNonCandidateDelimiter) {
          // WI-C1/C2 re-scoped this branch. It used to demand
          // `next === suppressOverlaps(legacy)` — ADR-0007's tier 2, the
          // only difference then permitted. The narrowing adds a SECOND
          // permitted difference: a model whose delimiter row GFM rejects
          // is no longer emitted at all. Both are still positive exceptions
          // with causal predicates, never an "ignore differences"
          // tolerance, so the accounting below is by value and by cause.
          if (fenced === undefined && !divergent.includes(doc.index)) {
            if (JSON.stringify(next) !== JSON.stringify(legacy)) divergent.push(doc.index);
          }
          if (fenced === undefined) {
            const survivors = new Set(next.map((m) => JSON.stringify(m)));
            const legacySet = new Set(legacy.map((m) => JSON.stringify(m)));
            for (const m of suppressOverlaps(legacy)) {
              if (!survivors.has(JSON.stringify(m))) {
                dropped.push({ doc: doc.index, delimiter: delimiterRowOf(doc.source, m) });
              }
            }
            for (const m of next) {
              if (!legacySet.has(JSON.stringify(m))) invented.push(doc.index);
            }
          }
          // What the new detector DOES emit must still be exactly a legacy
          // model — same span, same cells, same raw. Removal is permitted;
          // silently re-shaping a table is not.
          const legacySpans = new Set(
            suppressOverlaps(legacy).map((m) => JSON.stringify(m)),
          );
          for (const m of next) {
            expect(
              legacySpans.has(JSON.stringify(m)),
              `doc ${doc.index}: emitted model ${m.start}-${m.end} must be one legacy also emitted`,
            ).toBe(true);
          }
          continue;
        }

        expect(
          next,
          `doc ${doc.index} (outside the divergence class — exact identity required)`,
        ).toEqual(legacy);
      }
    }

    // Pinned by literal, and this literal CHANGED with WI-C1/C2.
    //
    // It used to be `[]`, with a comment explaining that ADR-0007's tier-2
    // exemption was vacuous over this corpus: `makeCorpus(SEED, 200)` tags
    // 138 documents with dimension 11 but none of them reaches the overlap
    // sub-shape, so every document was exactly identical to legacy. That is
    // still true of the OVERLAP exemption — `tests/table-scan-overlap-corpus.test.ts`
    // is where it is exercised. What is no longer true is "exactly identical
    // to legacy": the narrowing removes phantom tables, and these 38
    // documents are where it does so. Reviewed as a set on 2026-09-18.
    expect(
      divergent,
      "corpus documents where the narrowing changes the enumeration",
    ).toEqual([
      5, 9, 10, 12, 13, 14, 19, 20, 29, 31, 34, 39, 47, 49, 59, 69, 78, 79, 89, 97, 99,
      109, 119, 127, 129, 139, 144, 149, 159, 164, 167, 169, 172, 174, 179, 189, 195, 199,
    ]);

    // The cause, not just the count: every one of the 42 models that stopped
    // being emitted had a delimiter row GFM rejects. Nothing was lost for
    // any other reason ON THIS CORPUS — that is a measured fact about these
    // 200 documents, not a theorem. `NCD.F4` above is a document where the
    // narrowing changes a span rather than removing one, which is why the
    // claim is scoped to the corpus and asserted rather than assumed.
    expect(dropped.length, "models the narrowing stopped emitting").toBe(42);
    expect(
      dropped.filter((d) => !gfmRejectsDelimiter(d.delimiter)),
      "every dropped model's delimiter row must be one GFM rejects",
    ).toEqual([]);
    expect(invented, "no corpus document gains a model legacy never emitted").toEqual([]);
  });

  it("SCAN-delegation: findAllTables(source) is exactly scanTables(linesFromString(source))", async () => {
    const scanTables = await loadScanTables();
    for (const doc of CORPUS) {
      for (const fenced of [undefined, syntheticIsFenced(doc.source)]) {
        expect(
          findAllTables(doc.source, fenced),
          `doc ${doc.index}`,
        ).toEqual(scanTables(linesFromString(doc.source), fenced));
      }
    }
  });

  // -------------------------------------------------------------------
  // Enumeration correctness
  // -------------------------------------------------------------------

  it("SCAN-broken-between-valid: a failing run between two tables swallows neither", () => {
    const src =
      "| a | b |\n| - | - |\n| 1 | 2 |\n\nprose\n\n| x | y | z |\n| - | - |\n| 1 | 2 | 3 |\n\nprose\n\n| p | q |\n| - | - |\n| 5 | 6 |\n";
    const models = findAllTables(src);

    expect(models).toHaveLength(2);
    expect(models[0].raw).toBe("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(models[1].raw).toBe("| p | q |\n| - | - |\n| 5 | 6 |");
    expect(models[0].start).toBe(0);
    expect(models[1].start).toBe(src.indexOf("| p | q |"));
    expect(models[0].end).toBeLessThan(models[1].start);
  });

  it("SCAN-run-semantics: a table cannot interrupt a paragraph", () => {
    expect(findAllTables("x|y\na|b\n-|-\n1|2\n")).toHaveLength(0);

    const models = findAllTables("a|b\n-|-\n1|2\n");
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      colCount: 2,
      rowCount: 2,
      raw: "a|b\n-|-\n1|2",
    });
  });

  it("SCAN-adjacency: one blank apart, one prose line apart, at offset 0, at EOF", () => {
    const blankApart =
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n| x | y |\n| - | - |\n| 3 | 4 |\n";
    const proseApart =
      "| a | b |\n| - | - |\n| 1 | 2 |\nprose\n| x | y |\n| - | - |\n| 3 | 4 |\n";
    const atZero = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const atEof = "hi\n\n| a | b |\n| - | - |\n| 1 | 2 |";

    for (const [label, src] of [
      ["blank-separated", blankApart],
      ["prose-separated", proseApart],
    ] as const) {
      const models = findAllTables(src);
      expect(models, label).toHaveLength(2);
      expect(models[1].start, label).toBe(src.indexOf("| x | y |"));
      expect(models[0].end, label).toBeLessThanOrEqual(models[1].start);
    }
    expect(spans(findAllTables(blankApart))).toEqual([
      [0, 29],
      [31, 60],
    ]);
    expect(spans(findAllTables(proseApart))).toEqual([
      [0, 29],
      [36, 65],
    ]);

    expect(findAllTables(atZero)).toHaveLength(1);
    expect(findAllTables(atZero)[0].start).toBe(0);

    const eof = findAllTables(atEof);
    expect(eof).toHaveLength(1);
    expect(eof[0].end).toBe(atEof.length);
    expect(atEof.slice(eof[0].start, eof[0].end)).toBe(eof[0].raw);
  });

  it("SCAN-fence-ordering: a table-shaped fenced run does not shift tableIndex", () => {
    const src =
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n```\n| f | f |\n| - | - |\n| 0 | 0 |\n```\n\n| x | y |\n| - | - |\n| 3 | 4 |\n";
    const fenceStart = src.indexOf("```");
    const fenceEnd = src.lastIndexOf("```") + 3;
    const isFenced: IsFenced = (o) => o >= fenceStart && o < fenceEnd;

    const filtered = findAllTables(src, isFenced);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].rows[0][0].text).toBe("a");
    expect(filtered[1].rows[0][0].text).toBe("x");

    const unfiltered = findAllTables(src);
    expect(unfiltered).toHaveLength(3);

    // The filtered starts are a strict subsequence of the unfiltered starts.
    const unfilteredStarts = unfiltered.map((m) => m.start);
    const filteredStarts = filtered.map((m) => m.start);
    expect(filteredStarts.length).toBeLessThan(unfilteredStarts.length);
    let cursor = 0;
    for (const start of filteredStarts) {
      const at = unfilteredStarts.indexOf(start, cursor);
      expect(at, `start ${start} must appear in order`).toBeGreaterThanOrEqual(0);
      cursor = at + 1;
    }
  });

  it("SCAN-isfenced-callcount: isFenced is invoked only for models that parse", () => {
    const blocks: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      blocks.push(`| h${i} | k |\n| - | - |\n| ${i} | y |\n`);
    }
    const fiveTables = blocks.join("\nprose\n\n");

    const calls: number[] = [];
    const models = findAllTables(fiveTables, (o) => {
      calls.push(o);
      return false;
    });
    expect(models).toHaveLength(5);
    expect(calls).toEqual(models.map((m) => m.start));

    const noneCalls: number[] = [];
    const nothing = findAllTables(oneRunOf(2000), (o) => {
      noneCalls.push(o);
      return false;
    });
    expect(nothing).toEqual([]);
    expect(noneCalls).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Cost
  // -------------------------------------------------------------------

  it(
    "SCAN-bigrun-completes: a 200 000-line candidate run terminates",
    { timeout: 20_000 },
    async () => {
      const scanTables = await loadScanTables();
      expect(scanTables(linesFromString(oneRunOf(200_000)))).toEqual([]);
    },
  );

  it("SCAN-textreads-linear: line-text reads grow linearly, not quadratically", async () => {
    const scanTables = await loadScanTables();
    const reads: Record<number, number> = {};

    for (const L of [1000, 2000, 4000]) {
      const src = oneRunOf(L);
      const counted = countingSource(src);
      const result = scanTables(counted.source);

      // The count claim never stands alone (policy-core rule 2).
      expect(result, `L=${L} must yield no tables`).toEqual([]);
      expect(result, `L=${L} decorated vs undecorated`).toEqual(
        scanTables(linesFromString(src)),
      );

      reads[L] = counted.reads();
      expect(reads[L], `L=${L}: ${reads[L]} line-text reads`).toBeLessThanOrEqual(5 * L);
    }

    expect(
      reads[4000] / reads[2000],
      `doubling the document must not more than double the line-source reads (${reads[2000]} -> ${reads[4000]})`,
    ).toBeLessThanOrEqual(2.2);
  });

  it("SCAN-shape-independence: one long run costs the same as many short runs", async () => {
    const scanTables = await loadScanTables();

    const one = countingSource(oneRunOf(2000));
    const chopped = countingSource(choppedRunOf(2000));

    expect(scanTables(one.source)).toEqual([]);
    expect(scanTables(chopped.source)).toEqual([]);

    expect(
      one.reads(),
      `one run: ${one.reads()} reads vs chopped: ${chopped.reads()} reads`,
    ).toBeLessThanOrEqual(1.3 * chopped.reads());
  });

  it("SCAN-nodelim-run: a 50-line run without a delimiter costs no more than one with", async () => {
    const scanTables = await loadScanTables();

    const noDelimSrc = oneRunOf(50);
    const withDelimSrc = `|a|b|\n|-|-|\n${"|a|b|\n".repeat(48)}`;

    const noDelim = countingSource(noDelimSrc);
    const withDelim = countingSource(withDelimSrc);

    expect(scanTables(noDelim.source)).toEqual([]);
    expect(scanTables(withDelim.source)).toHaveLength(1);

    expect(
      noDelim.reads(),
      `no-delimiter run: ${noDelim.reads()} reads vs with-delimiter: ${withDelim.reads()}`,
    ).toBeLessThanOrEqual(withDelim.reads() * 1.5);
  });

  // -------------------------------------------------------------------
  // Invariants over the corpus
  // -------------------------------------------------------------------

  it("SCAN-invariants: enumeration well-formedness and determinism over the corpus", () => {
    for (const doc of CORPUS) {
      const src = doc.source;
      const models = findAllTables(src);

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
          // ADR-0007: unscoped on the new scanner.
          expect(
            models[i - 1].end,
            `doc ${doc.index} model ${i}: emitted models must not overlap`,
          ).toBeLessThanOrEqual(m.start);
        }
      }

      expect(findAllTables(src), `doc ${doc.index}: determinism`).toEqual(models);

      // Still scoped, and it must stay scoped: pairwise non-overlap is NOT
      // an invariant of the frozen legacy implementation. The scoping
      // predicate is read from the corpus tag, never inferred by re-parsing.
      if (!doc.tags.hasNonCandidateDelimiter) {
        const legacy = legacyFindAllTables(src);
        for (let i = 1; i < legacy.length; i += 1) {
          expect(
            legacy[i - 1].end,
            `doc ${doc.index} legacy model ${i}`,
          ).toBeLessThanOrEqual(legacy[i].start);
        }
      }
    }
  });

  it("SCAN-metamorphic-crlf: rewriting the document in CRLF changes nothing but the \\r's", () => {
    for (const doc of CORPUS) {
      const lf = doc.source.replace(/\r\n/g, "\n");
      const crlf = lf.replace(/\n/g, "\r\n");

      const a = findAllTables(lf);
      const b = findAllTables(crlf);

      expect(b.length, `doc ${doc.index}: model count`).toBe(a.length);
      expect(
        b.map((m) => m.raw.replace(/\r/g, "")),
        `doc ${doc.index}: raws`,
      ).toEqual(a.map((m) => m.raw));
      expect(
        b.map((m) => [m.colCount, m.rowCount, m.alignments]),
        `doc ${doc.index}: shape`,
      ).toEqual(a.map((m) => [m.colCount, m.rowCount, m.alignments]));
      expect(
        b.map((m) => m.cells.map((c) => c.text)),
        `doc ${doc.index}: cell text`,
      ).toEqual(a.map((m) => m.cells.map((c) => c.text)));
    }
  });

  // -------------------------------------------------------------------
  // Structure
  // -------------------------------------------------------------------

  it("SCAN-nocycle: tableParser/ imports neither cursorSync/ nor @codemirror/state", () => {
    const dir = join(process.cwd(), "src", "utils", "tableParser");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length, "the parser folder must not be empty").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const line of text.split("\n")) {
        if (!/^\s*(import|export)\b/.test(line)) continue;
        if (/@codemirror\/state/.test(line)) offenders.push(`${file}: ${line.trim()}`);
        if (/cursorSync/.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);

    // The scanner is the file this guard exists for; assert it is in scope
    // rather than trusting the directory listing to have contained it.
    expect(
      existsSync(join(dir, "scan.ts")),
      "src/utils/tableParser/scan.ts must exist for this guard to mean anything",
    ).toBe(true);
  });
});
