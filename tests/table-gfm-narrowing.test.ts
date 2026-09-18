/**
 * WI-C1 + WI-C2 — narrowing mdpro's table detector toward GFM.
 *
 * Plan: `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` §5.1
 * (FIX-A, FIX-B) and Part 6. Prior records: ADR-0007 (the scanner emits
 * non-overlapping models), ADR-0008 (the non-candidate-delimiter class,
 * measured against GFM).
 *
 * EVERY "GFM says N" number in this file is a MEASUREMENT, not a reading
 * of the spec. Reference parser: `micromark-extension-gfm-table@2.1.2`,
 * which is the same parser mdpro's own WYSIWYG half runs
 * (`@milkdown/preset-gfm` -> `remark-gfm@4.0.1` ->
 * `micromark-extension-gfm@3.0.0`). Measured 2026-09-17, re-measured
 * against the patched detector 2026-09-18. The case labels (S1, S2, S3,
 * A1..A4, U1) are the plan's §1.1 table, kept verbatim so a failure here
 * points at a row of that table.
 *
 * The two rules being added, and why they are BLOCK-level rules rather
 * than table rules:
 *
 *  - WI-C1 / FIX-A. `---` under a paragraph line is a setext H2
 *    underline. CommonMark resolves the collision with a pipe-less
 *    delimiter row in setext's favour, so `| a |` / `---` / `| b |` is a
 *    heading plus a paragraph and yields ZERO tables. It only bites on a
 *    SINGLE-column header: a pipe-less line splits into exactly one cell,
 *    so a 2+-column header already failed the column-count check (§1.2,
 *    pinned below as `S1-neg`).
 *  - WI-C2 / FIX-B. Indentation is measured in CommonMark COLUMNS before
 *    any trim. `isDelimiterLine` used to `.trim()` first, so a 4-space
 *    delimiter escaped the `MAX_INDENT` rule its neighbours obeyed; and
 *    `countLeadingSpaces` counted only U+0020, so a TAB-indented line —
 *    delimiter (S3) or header (S3') — measured as indent 0. `.trim()`
 *    eats tabs too, so an indent check bolted onto the old order would
 *    have fixed S2 and left S3 standing. Both are gone here.
 *
 * What this file deliberately does NOT assert away — see the report and
 * the plan §5.3 / §5.4:
 *
 *  - `NARROW-phantom-to-nothing` records that some documents that render
 *    a table in Source mode TODAY now render none. That is the intended
 *    effect and it is a user-visible loss; it is pinned, not hidden.
 *  - `NARROW-underdetection-remains` records that mdpro still does not
 *    match GFM. The larger class — GFM finds a paragraph-interrupting
 *    table where mdpro finds none — is untouched by WI-C1 / WI-C2 and is
 *    asserted to still be broken, so nobody reads this file as a claim of
 *    parity.
 *
 * Gate G0: no new dependency. No mocks — every value is the real
 * function's real return.
 */

import { describe, expect, it } from "vitest";

import { findAllTables } from "../src/utils/cursorSync/table";
import { countIndentColumns, countLeadingSpaces } from "../src/utils/tableParser/commonmark";
import { parseTableAt } from "../src/utils/tableParser/parse";
import type { TableModel } from "../src/utils/tableParser/types";
import { legacyFindAllTables } from "./support/legacyTableScan";
import { makeCorpus, SEED } from "./support/tableCorpus";

const spans = (models: readonly TableModel[]): [number, number][] =>
  models.map((m) => [m.start, m.end]);

describe("table detector narrowed to GFM (WI-C1 / WI-C2)", () => {
  // -------------------------------------------------------------------
  // WI-C1 — setext beats the table delimiter row
  // -------------------------------------------------------------------

  it("NARROW-setext: every single-column `-`-only delimiter now yields zero tables", () => {
    // [src, what the FROZEN pre-WI-C1 scanner emitted]. GFM emits zero
    // tables for all seven (micromark-extension-gfm-table@2.1.2,
    // 2026-09-17); the second column is what mdpro used to emit, restated
    // so the regression this closes is visible in the case itself.
    const cases: [string, [number, number][]][] = [
      ["| a |\n---\n| b |\n", [[0, 15]]], //        S1   plain
      ["| a |\n----\n| b |\n", [[0, 16]]], //       S1'  longer run
      ["| a |\n ---\n| b |\n", [[0, 16]]], //       S1'' 1 space
      ["| a |\n   ---\n| b |\n", [[0, 18]]], //     S1'' 3 spaces
      ["| a |\n    ---\n| b |\n", [[0, 19]]], //    4 spaces: C1 and C2 both
      ["| a |\n--- \n| b |\n", [[0, 16]]], //       trailing space
      ["| a |\n---\n", [[0, 9]]], //                S1''' no body row
    ];

    for (const [src, legacySpans] of cases) {
      expect(spans(legacyFindAllTables(src)), `frozen copy on ${JSON.stringify(src)}`).toEqual(
        legacySpans,
      );
      expect(parseTableAt(src, 0), `parseTableAt on ${JSON.stringify(src)}`).toBeNull();
      expect(spans(findAllTables(src)), `findAllTables on ${JSON.stringify(src)}`).toEqual([]);
    }
  });

  it("NARROW-setext-guard: colon-bearing single-column delimiters are untouched", () => {
    // The over-correction guard. These three are REAL GFM delimiter rows
    // — GFM emits one table for each — and none of them is a setext
    // underline. Losing them would be a worse bug than the one WI-C1
    // fixes, so they are asserted equal on BOTH sides.
    for (const delim of [":-:", "--:", ":--"]) {
      const src = `| a |\n${delim}\n| b |\n`;
      const model = parseTableAt(src, 0);
      expect(model, `parseTableAt on ${JSON.stringify(src)}`).not.toBeNull();
      expect(spans(findAllTables(src)), `live on ${JSON.stringify(src)}`).toEqual([[0, 15]]);
      expect(spans(legacyFindAllTables(src)), `frozen on ${JSON.stringify(src)}`).toEqual([
        [0, 15],
      ]);
    }
  });

  it("NARROW-setext-neg: a two-column header with `---` was already zero and still is", () => {
    // Plan §1.2. `---` splits into ONE cell, so the column-count check in
    // `parse.ts` rejected this before WI-C1 existed. Pinned so nobody
    // reads WI-C1 as having changed it, and so the "single-column only"
    // narrowing in the rule's doc comment has a witness.
    const src = "| a | b |\n---\n| 1 | 2 |\n";
    expect(spans(legacyFindAllTables(src)), "frozen copy: already zero").toEqual([]);
    expect(spans(findAllTables(src)), "live: still zero").toEqual([]);
    expect(parseTableAt(src, 0)).toBeNull();
  });

  // -------------------------------------------------------------------
  // WI-C2 — indentation in CommonMark columns, tabs included
  // -------------------------------------------------------------------

  it("NARROW-indent: 4+ columns of indent on delimiter or header yields zero tables", () => {
    const cases: [string, string, [number, number][]][] = [
      ["S2", "| a | b |\n    | - | - |\n| 1 | 2 |\n", [[0, 33]]],
      ["S2'''", "| a | b |\n     | - | - |\n| 1 | 2 |\n", [[0, 34]]],
      ["S3", "| a | b |\n\t| - | - |\n| 1 | 2 |\n", [[0, 30]]],
      ["S3'", "\t| a | b |\n| - | - |\n| 1 | 2 |\n", [[0, 30]]],
    ];

    for (const [label, src, legacySpans] of cases) {
      expect(spans(legacyFindAllTables(src)), `${label}: frozen copy`).toEqual(legacySpans);
      expect(parseTableAt(src, 0), `${label}: parseTableAt`).toBeNull();
      expect(spans(findAllTables(src)), `${label}: findAllTables`).toEqual([]);
    }

    // S3' is the half ADR-0008 missed and the half an indent check inside
    // `isDelimiterLine` cannot reach: its DELIMITER row is perfectly
    // ordinary, and it is the HEADER that carries the tab. It is fixed
    // here only because the measurement moved into `countIndentColumns`,
    // which `isTableCandidateLine` also uses.
    const s3prime = "\t| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(parseTableAt(s3prime, s3prime.indexOf("| - |")), "S3': probed at the delimiter")
      .toBeNull();
  });

  it("NARROW-indent-guard: 3 columns of indent still parses — the boundary is 3/4", () => {
    // A3. CommonMark's limit is "up to 3"; 4 starts an indented code
    // block. A fix that moved the boundary by one would pass every case
    // above and break every legitimately-indented table in the wild.
    const src = "| a | b |\n   | - | - |\n| 1 | 2 |\n";
    expect(spans(findAllTables(src)), "3 spaces: still a table").toEqual([[0, 32]]);
    expect(spans(legacyFindAllTables(src)), "3 spaces: unchanged from frozen").toEqual([
      [0, 32],
    ]);
    // A2 — a pipe-bearing pipe-less-edge delimiter, unindented. Nothing in
    // WI-C1 / WI-C2 touches it; asserted so "narrowing" cannot creep.
    const a2 = "| a | b |\n--- | ---\n| 1 | 2 |\n";
    expect(spans(findAllTables(a2)), "A2: unaffected").toEqual([[0, 29]]);
  });

  it("NARROW-columns: countIndentColumns measures columns, countLeadingSpaces measures characters", () => {
    // WI-C2 acceptance 3. A tab advances to the NEXT multiple of 4, so
    // its width depends on what precedes it — which is exactly why a
    // character count cannot stand in for it.
    const columns: [string, number][] = [
      ["", 0],
      [" ", 1],
      ["   ", 3],
      ["    ", 4],
      ["\t", 4], //        col 0 -> 4
      [" \t", 4], //       col 1 -> 4
      ["   \t", 4], //     col 3 -> 4
      ["    \t", 8], //    col 4 -> 8
      ["\t\t", 8],
      ["\t ", 5],
      ["x   ", 0], //      stops at the first non-whitespace
      ["| a |", 0],
      ["  x  ", 2], //     trailing whitespace is not indentation
    ];
    for (const [s, cols] of columns) {
      expect(countIndentColumns(s), `columns of ${JSON.stringify(s)}`).toBe(cols);
    }

    // The other half of the pair, pinned so a future "simplification"
    // that deletes one of the two functions fails here. `parse.ts`
    // derives every `TableCell.start/end` from this one; see
    // `NARROW-cell-offsets` for the consequence.
    const chars: [string, number][] = [
      ["", 0],
      [" ", 1],
      ["   ", 3],
      ["    ", 4],
      ["\t", 0], //        <- differs from countIndentColumns("\t") === 4
      [" \t", 1], //       <- differs from 4
      ["\t\t", 0],
      ["x   ", 0],
    ];
    for (const [s, n] of chars) {
      expect(countLeadingSpaces(s), `leading spaces of ${JSON.stringify(s)}`).toBe(n);
    }
    expect(countIndentColumns("\t")).not.toBe(countLeadingSpaces("\t"));
  });

  it("NARROW-cell-offsets: every TableCell offset is unchanged by WI-C2", () => {
    // Plan §2.3's trap, as a regression test. `parseRowCells` adds a
    // CHARACTER count to `LineRange.start`; substituting the column count
    // would move every cell offset on any line containing a tab.
    //
    // Measured deviation from the acceptance criterion as written: it
    // asks for "a real table with a TAB-indented body row". No such table
    // exists after FIX-B — any leading tab is >= 4 columns, so the row is
    // not a candidate line and never reaches `parseRowCells`. The trap is
    // therefore real in principle and currently unobservable through the
    // parser. What is asserted instead is the reachable maximum: rows at
    // 0, 1, 2 and 3 columns of indent, every offset by literal.
    const src = "| a | b |\n | - | - |\n  | 1 | 2 |\n   | 3 | 4 |\n";
    const model = parseTableAt(src, 0);
    expect(model).not.toBeNull();
    expect([model!.start, model!.end, model!.rowCount, model!.colCount]).toEqual([
      0, 45, 3, 2,
    ]);
    expect(model!.cells.map((c) => [c.row, c.col, c.start, c.end, c.text])).toEqual([
      [0, 0, 1, 4, "a"],
      [0, 1, 5, 8, "b"],
      [1, 0, 24, 27, "1"],
      [1, 1, 28, 31, "2"],
      [2, 0, 37, 40, "3"],
      [2, 1, 41, 44, "4"],
    ]);
    // Each cell really is the text at that offset in the source — the
    // check a swapped-in column count would fail.
    for (const c of model!.cells) {
      expect(src.slice(c.start, c.end).trim(), `cell ${c.row},${c.col}`).toBe(c.text);
    }
  });

  // -------------------------------------------------------------------
  // The costs, recorded rather than fixed
  // -------------------------------------------------------------------

  it("NARROW-phantom-to-nothing: documents that show a table today now show none", () => {
    // Plan §3.2's `docA`, the document that proved the BLOCK-level
    // data-loss path: an MCP client counting tables the way GFM does
    // sends `tableIndex: 0` and hits the phantom instead of the real
    // table. After WI-C1 the phantom is gone and index 0 IS the real
    // table — the enumeration and GFM finally agree on this document.
    const docA = "Intro\n\n| a |\n---\n\n| x | y |\n| - | - |\n| 1 | 2 |\n";
    expect(
      legacyFindAllTables(docA).map((m) => [m.start, m.end, m.raw]),
      "frozen copy: a phantom at 7, then the real table",
    ).toEqual([
      [7, 16, "| a |\n---"],
      [18, 47, "| x | y |\n| - | - |\n| 1 | 2 |"],
    ]);
    expect(
      findAllTables(docA).map((m) => [m.start, m.end, m.raw]),
      "live: only the real table, and it is now index 0",
    ).toEqual([[18, 47, "| x | y |\n| - | - |\n| 1 | 2 |"]]);

    // The cost side of the same coin, plan §5.3. Corpus document 10
    // enumerates ONE table today and ZERO after the narrowing. It is not
    // a swap: the table it used to find was never the real one, and
    // `scan.ts`'s run-level pruning means failing at the run's first line
    // skips the rest of the run. A user who sees a table rendered in
    // Source mode in a document of this shape will stop seeing it.
    const doc10 = makeCorpus(SEED, 200)[10];
    expect(spans(legacyFindAllTables(doc10.source)), "frozen copy: one phantom").toEqual([
      [160, 223],
    ]);
    expect(spans(findAllTables(doc10.source)), "live: no table at all").toEqual([]);
  });

  it("NARROW-underdetection-remains: WI-C1 / WI-C2 do not make mdpro match GFM", () => {
    // Plan §1.4 / §5.4. This is the class NEITHER fix addresses: GFM
    // finds a table that interrupts a paragraph, mdpro finds none. It is
    // asserted to be STILL BROKEN so this file cannot be read as a parity
    // claim, and so the day it is fixed, this case fails and gets
    // rewritten deliberately.

    // U1: GFM emits one table starting at offset 12 (the `| h0 |...` line
    // that interrupts the `| b0 | b1 |` paragraph). mdpro emits none.
    const u1 =
      "| b0 | b1 |\n| h0 | h1 | h2 |\n| :-- | :-: | :-- |\n| r0 | r1 | r2 |\n";
    expect(u1.indexOf("| h0 |"), "GFM's table starts here").toBe(12);
    expect(spans(findAllTables(u1)), "mdpro still finds nothing").toEqual([]);
    expect(spans(legacyFindAllTables(u1)), "and found nothing before either").toEqual([]);

    // Corpus document 10 again, from the other side: it contains a
    // perfectly ordinary aligned table at offset 269 that mdpro has never
    // enumerated, before or after this work.
    const doc10 = makeCorpus(SEED, 200)[10];
    expect(doc10.source.lastIndexOf("| h0 | h1 | h2 |"), "the real table's header").toBe(269);
    expect(doc10.source.slice(286, 305), "and its alignment row").toBe("| :-- | :-: | :-- |");
    expect(
      findAllTables(doc10.source).some((m) => m.start === 269),
      "still not enumerated",
    ).toBe(false);
  });
});
