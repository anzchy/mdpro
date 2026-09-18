/**
 * WI-2 — characterization suite for `src/utils/tableParser/lines.ts`.
 *
 * This suite is GREEN against both the pre-WI-2 and post-WI-2 code, by
 * design: WI-2 is a behaviour-preserving extraction, so there is no
 * RED→GREEN receipt here and none should be manufactured. Rule 10's
 * red-first discipline is carried for this effort by WI-1
 * (`tests/table-scan-scaling.test.ts`), whose three timing cases stay
 * RED until WI-3.
 *
 * The oracle (`tests/support/legacyTableScan.ts`) is a frozen byte-copy
 * of the shipped implementation. It is never updated; a failure against
 * it means live behaviour changed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTableAt } from "../src/utils/tableParser";
import {
  isDelimiterLine,
  isTableCandidateLine,
  lineIndexAt,
  linesFromString,
  splitLines,
} from "../src/utils/tableParser/lines";
import type { LineRange } from "../src/utils/tableParser/types";
import {
  legacyFindLineIndex,
  legacyParseTableAt,
  legacySplitLines,
} from "./support/legacyTableScan";
import { makeCorpus, SEED, type CorpusDoc } from "./support/tableCorpus";

const CORPUS: CorpusDoc[] = makeCorpus(SEED, 200);

/**
 * Total byte length of `makeCorpus(SEED, 200)`.
 *
 * Update this DELIBERATELY when the generator changes — a silent change
 * invalidates every red receipt in this suite, because every property
 * case below would then be running against a different domain than the
 * one that was reviewed.
 */
const CORPUS_TOTAL_BYTES = 64_568;

/** The 4-line, one-table document the fudge cases are specified against. */
const FUDGE_DOC = "| a | b |\n| - | - |\n| 1 | 2 |\nafter\n";

/** Degenerate documents, shared by LINES-degenerate and LINES-oracle. */
const DEGENERATE = [
  "",
  "\n",
  "\n\n\n",
  "hello",
  "| a | b |",
  "a\r\n",
  "a\r\n\n",
  "x\n\r\n",
];

/** Build a single `LineRange` from a newline-free fixture string. */
function lineOf(text: string): LineRange {
  return splitLines(text)[0];
}

describe("tableParser/lines (WI-2 characterization)", () => {
  // -------------------------------------------------------------------
  // splitLines
  // -------------------------------------------------------------------

  it("LINES-reconstruct: every line's text is exactly its own slice, over the corpus", () => {
    let checkedLines = 0;

    for (const doc of CORPUS) {
      const src = doc.source;
      const lines = splitLines(src);

      expect(
        lines.length,
        `doc ${doc.index}: line count vs split("\\n") for ${JSON.stringify(src)}`,
      ).toBe(src.split("\n").length);

      expect(lines[0].start, `doc ${doc.index}: first line must start at 0`).toBe(0);

      for (let i = 0; i < lines.length; i += 1) {
        expect(
          lines[i].text,
          `doc ${doc.index} line ${i}: text must equal its own slice`,
        ).toBe(src.slice(lines[i].start, lines[i].end));
        if (i + 1 < lines.length) {
          expect(
            lines[i].start,
            `doc ${doc.index} line ${i}: starts must strictly increase`,
          ).toBeLessThan(lines[i + 1].start);
        }
        checkedLines += 1;
      }

      // The final entry is always pushed with `end: source.length` — the
      // CR-strip applies only at a `\n` boundary, so a document whose
      // last line ends in `\r` with no final `\n` still ends at length.
      expect(
        lines[lines.length - 1].end,
        `doc ${doc.index}: last line must end at source.length`,
      ).toBe(src.length);
    }

    expect(checkedLines).toBeGreaterThan(1000);
  });

  it("LINES-oracle: the indexOf rewrite is byte-identical to the character loop it replaces", () => {
    for (const doc of CORPUS) {
      expect(
        splitLines(doc.source),
        `corpus doc ${doc.index}: ${JSON.stringify(doc.source)}`,
      ).toEqual(legacySplitLines(doc.source));
    }
    for (const src of DEGENERATE) {
      expect(splitLines(src), `degenerate ${JSON.stringify(src)}`).toEqual(
        legacySplitLines(src),
      );
    }
    expect(splitLines(FUDGE_DOC)).toEqual(legacySplitLines(FUDGE_DOC));
  });

  it("LINES-degenerate: empty, newline-only, no-trailing-newline, and the CR edges", () => {
    expect(splitLines("")).toEqual([{ start: 0, end: 0, text: "" }]);

    expect(splitLines("\n")).toEqual([
      { start: 0, end: 0, text: "" },
      { start: 1, end: 1, text: "" },
    ]);

    expect(splitLines("\n\n\n")).toEqual([
      { start: 0, end: 0, text: "" },
      { start: 1, end: 1, text: "" },
      { start: 2, end: 2, text: "" },
      { start: 3, end: 3, text: "" },
    ]);

    expect(splitLines("hello")).toEqual([{ start: 0, end: 5, text: "hello" }]);

    expect(splitLines("| a | b |")).toEqual([
      { start: 0, end: 9, text: "| a | b |" },
    ]);

    expect(splitLines("a\r\n")).toEqual([
      { start: 0, end: 1, text: "a" },
      { start: 3, end: 3, text: "" },
    ]);

    // Three entries; `{start:3,end:3,text:""}` is INDEX 1, not index 2.
    expect(splitLines("a\r\n\n")).toEqual([
      { start: 0, end: 1, text: "a" },
      { start: 3, end: 3, text: "" },
      { start: 4, end: 4, text: "" },
    ]);
    expect(splitLines("a\r\n\n")[1]).toEqual({ start: 3, end: 3, text: "" });

    // A line whose entire text is a lone `\r`: the CR-strip at its edge.
    expect(splitLines("x\n\r\n")).toEqual([
      { start: 0, end: 1, text: "x" },
      { start: 2, end: 2, text: "" },
      { start: 4, end: 4, text: "" },
    ]);

    expect(parseTableAt("", 0)).toBeNull();
    expect(parseTableAt("| a | b |", 0)).toBeNull();
  });

  it("LINES-astral: cell offsets stay code-unit based under CJK and astral-plane content", () => {
    const src = "| 汉字 | 𝄞 音 | café |\n| --- | --- | --- |\n| 👍🏽 | b | c |\n";

    const model = parseTableAt(src, 0);
    expect(model).not.toBeNull();
    if (!model) return;

    for (const cell of model.cells) {
      expect(
        src.slice(cell.start, cell.end).trim(),
        `cell (${cell.row},${cell.col}) slice must equal its text`,
      ).toBe(cell.text);
    }

    // Offsets are the same integers the shipped implementation produced.
    expect(parseTableAt(src, 0)).toEqual(legacyParseTableAt(src, 0));
  });

  // -------------------------------------------------------------------
  // linesFromString
  // -------------------------------------------------------------------

  it("LINES-nocache: repeated calls return fresh objects, never a shared cached graph", () => {
    const s = "| a | b |\n| - | - |\n| 1 | 2 |\n";

    const a = linesFromString(s);
    const b = linesFromString(s);

    expect(a).not.toBe(b);
    expect(a.line(0)).not.toBe(b.line(0));
    expect(a.line(a.lineCount - 1)).not.toBe(b.line(b.lineCount - 1));
    expect(a.iterLines()).not.toBe(b.iterLines());

    // Determinism is still required — this forbids caching, not purity.
    expect(a).toEqual(b);
    expect([...a.iterLines()]).toEqual([...b.iterLines()]);
    expect(a.lineCount).toBe(b.lineCount);
    expect(a.length).toBe(s.length);
  });

  // -------------------------------------------------------------------
  // lineIndexAt
  // -------------------------------------------------------------------

  it("LINEIDX-oracle: binary search agrees with the linear scan at every offset, over the corpus", () => {
    const mismatches: string[] = [];
    let comparisons = 0;
    let expectedComparisons = 0;

    for (const doc of CORPUS) {
      const src = doc.source;
      const lines = splitLines(src);
      const legacyLines = legacySplitLines(src);
      const index = linesFromString(src);
      expectedComparisons += src.length + 3; // -1 .. src.length + 1 inclusive

      for (let o = -1; o <= src.length + 1; o += 1) {
        const expectedIdx = legacyFindLineIndex(legacyLines, o);
        const viaFn = lineIndexAt(lines, o);
        const viaSource = index.lineIndexAt(o);
        comparisons += 1;
        if (viaFn !== expectedIdx || viaSource !== expectedIdx) {
          if (mismatches.length < 5) {
            mismatches.push(
              `doc ${doc.index}, offset ${o}: expected ${expectedIdx}, ` +
                `got ${viaFn} (free fn) / ${viaSource} (source)`,
            );
          }
        }
      }

      // Out-of-range below zero is -1 in both implementations.
      expect(lineIndexAt(lines, -1), `doc ${doc.index}: offset -1`).toBe(-1);
    }

    expect(mismatches).toEqual([]);
    // Non-vacuity: the sweep actually ran over the whole domain.
    expect(comparisons).toBe(expectedComparisons);
    expect(comparisons).toBeGreaterThan(50_000);
  });

  it("LINEIDX-monotonic: the result never decreases as the offset advances", () => {
    const violations: string[] = [];
    let sweptOffsets = 0;

    for (const doc of CORPUS) {
      const src = doc.source;
      const lines = splitLines(src);
      let previous = -1;

      for (let o = 0; o <= src.length; o += 1) {
        const idx = lineIndexAt(lines, o);
        sweptOffsets += 1;
        if (idx < 0 || idx > lines.length - 1) {
          if (violations.length < 5) {
            violations.push(
              `doc ${doc.index}, offset ${o}: ${idx} outside 0..${lines.length - 1}`,
            );
          }
        } else if (idx < previous) {
          if (violations.length < 5) {
            violations.push(
              `doc ${doc.index}, offset ${o}: ${idx} decreased from ${previous}`,
            );
          }
        }
        previous = Math.max(previous, idx);
      }
    }

    expect(violations).toEqual([]);
    expect(sweptOffsets).toBeGreaterThan(50_000);
  });

  it("LINEIDX-fudge-public: column 0 of the line after a table resolves into the table", () => {
    // Offset 30 is the `a` of `after`; it still resolves into the table
    // above, because the trailing `\n` of `| 1 | 2 |` is attributed to
    // that line (`offset <= line.end + 1`). This quirk is PRESERVED.
    expect(parseTableAt(FUDGE_DOC, 30)).toMatchObject({ start: 0, end: 29 });
    expect(parseTableAt(FUDGE_DOC, 31)).toBeNull();
  });

  it("LINEIDX-allsweep: parseTableAt at every offset matches the frozen reference", () => {
    for (let o = 0; o <= FUDGE_DOC.length + 1; o += 1) {
      expect(parseTableAt(FUDGE_DOC, o), `offset ${o}`).toEqual(
        legacyParseTableAt(FUDGE_DOC, o),
      );
    }
    // The live probe `findAllTables` actually makes, and one past it.
    expect(parseTableAt(FUDGE_DOC, FUDGE_DOC.length)).toEqual(
      legacyParseTableAt(FUDGE_DOC, FUDGE_DOC.length),
    );
    expect(parseTableAt(FUDGE_DOC, FUDGE_DOC.length + 1)).toBeNull();
  });

  it("LINEIDX-crlf: a CRLF document's offsets and raw match the LF equivalent modulo \\r", () => {
    const lf = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const crlf = lf.replace(/\n/g, "\r\n");

    const lfModel = parseTableAt(lf, 0);
    const crlfModel = parseTableAt(crlf, 0);
    expect(lfModel).not.toBeNull();
    expect(crlfModel).not.toBeNull();
    if (!lfModel || !crlfModel) return;

    expect(crlfModel.raw.replace(/\r/g, "")).toBe(lfModel.raw);
    expect(crlfModel.colCount).toBe(lfModel.colCount);
    expect(crlfModel.rowCount).toBe(lfModel.rowCount);
    expect(crlfModel.cells.map((c) => c.text)).toEqual(
      lfModel.cells.map((c) => c.text),
    );

    // `LineRange.end` excludes the CR, so the model's end lands ON it.
    expect(crlf[crlfModel.end]).toBe("\r");
  });

  it("LINEIDX-roundtrip: every returned model round-trips against its own source", () => {
    let modelsSeen = 0;

    for (const doc of CORPUS) {
      const src = doc.source;
      const lines = splitLines(src);

      const probes = new Set<number>([0, src.length]);
      for (const line of lines) {
        probes.add(line.start);
        probes.add(line.end);
        probes.add(line.end + 1);
      }

      for (const o of probes) {
        if (o < 0 || o > src.length) continue;
        const m = parseTableAt(src, o);
        if (!m) continue;
        modelsSeen += 1;

        const where = `doc ${doc.index}, offset ${o}`;
        expect(src.slice(m.start, m.end), `${where}: slice === raw`).toBe(m.raw);
        expect(m.rows.length, `${where}: rows.length === rowCount`).toBe(m.rowCount);
        expect(m.cells.length, `${where}: cells.length === rowCount * colCount`).toBe(
          m.rowCount * m.colCount,
        );
        expect(m.alignments.length, `${where}: alignments.length === colCount`).toBe(
          m.colCount,
        );

        for (let r = 0; r < m.rowCount; r += 1) {
          for (let c = 0; c < m.colCount; c += 1) {
            const cell = m.rows[r][c];
            expect(cell, `${where}: rows[${r}][${c}] === cells[flat]`).toBe(
              m.cells[r * m.colCount + c],
            );
            expect(cell.start, `${where}: cell (${r},${c}) start <= end`).toBeLessThanOrEqual(
              cell.end,
            );
            expect(
              src.slice(cell.start, cell.end).replace(/\r$/, "").trim(),
              `${where}: cell (${r},${c}) slice === text`,
            ).toBe(cell.text);
          }
        }
      }
    }

    // Non-vacuity: the corpus really does produce parseable tables.
    expect(modelsSeen).toBeGreaterThan(100);
  });

  it("LINEIDX-corpus-deterministic: the generator is stable and its drift is loud", () => {
    const first = makeCorpus(SEED, 200);
    const second = makeCorpus(SEED, 200);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.length).toBe(200);

    const totalBytes = first.reduce((sum, doc) => sum + doc.source.length, 0);
    expect(totalBytes).toBe(CORPUS_TOTAL_BYTES);

    const count = (pick: (doc: CorpusDoc) => boolean): number =>
      first.filter(pick).length;

    // Dimension 11 must be PRESENT, not merely declared.
    expect(count((d) => d.tags.hasNonCandidateDelimiter)).toBeGreaterThan(0);
    expect(count((d) => d.tags.nonCandidateDelimiterPipeless)).toBeGreaterThan(0);
    expect(count((d) => d.tags.nonCandidateDelimiterIndented)).toBeGreaterThan(0);

    // ...and so must the other ten.
    expect(count((d) => d.tags.prose)).toBeGreaterThan(0);
    expect(count((d) => d.tags.validTable)).toBeGreaterThan(0);
    expect(count((d) => d.tags.brokenHeader)).toBeGreaterThan(0);
    expect(count((d) => d.tags.brokenDelimiter)).toBeGreaterThan(0);
    expect(count((d) => d.tags.fence)).toBeGreaterThan(0);
    expect(count((d) => d.tags.blankRun)).toBeGreaterThan(0);
    expect(count((d) => d.tags.cjk)).toBeGreaterThan(0);
    expect(count((d) => d.tags.pipeAtColumn60)).toBeGreaterThan(0);
    expect(count((d) => d.tags.trailingNewline)).toBeGreaterThan(0);
    expect(count((d) => !d.tags.trailingNewline)).toBeGreaterThan(0);
    expect(count((d) => d.tags.crlf)).toBeGreaterThan(0);

    // Documents stay small enough for the O(L^2) offset sweeps above.
    for (const doc of first) {
      expect(
        doc.source.split("\n").length,
        `doc ${doc.index} must stay under the 60-line cap`,
      ).toBeLessThanOrEqual(60);
    }
  });

  // -------------------------------------------------------------------
  // isTableCandidateLine / isDelimiterLine
  // -------------------------------------------------------------------

  it("PRED-candidate-classes: the indent, blank, and escaped-pipe partitions", () => {
    const cases: [string, boolean][] = [
      ["| a | b |", true],
      ["a|b", true], // no edge pipes
      ["   | a |", true], // 3 spaces — at MAX_INDENT
      ["    | a |", false], // 4 spaces — indented code
      ["", false],
      ["   ", false], // whitespace only
      ["no pipes here", false],
      ["a\\|b", false], // escaped pipe only
      ["a\\\\|b", true], // escaped backslash, then a real pipe
      ["| a |\r", true], // trailing CR stripped
      ["---", false], // a delimiter that is NOT a candidate (no pipe)
      ["    | - | - |", false], // a delimiter that is NOT a candidate (4+ indent)
    ];

    for (const [text, expected] of cases) {
      expect(
        isTableCandidateLine(lineOf(text)),
        `isTableCandidateLine(${JSON.stringify(text)})`,
      ).toBe(expected);
    }
  });

  it("PRED-delimiter-classes: what the delimiter regex accepts and rejects", () => {
    // [line, isDelimiterLine, isTableCandidateLine] — both predicates in
    // one table so the rows where they DISAGREE are visible in one place.
    const cases: [string, boolean, boolean][] = [
      ["| --- | --- |", true, true],
      ["| :-- | --: | :-: |", true, true],
      ["|-|-|", true, true],
      ["---", true, false], // disagreement: pipe-less delimiter
      [":-:", true, false], // disagreement: pipe-less delimiter
      ["  | - | - |", true, true],
      // WI-C2 (plan 20260917 §5.1 FIX-B) rewrote this row. It was
      // `[true, false]` — the "4+ indent" disagreement — because
      // `isDelimiterLine` trimmed before splitting and never saw the
      // indent its neighbour rejects on. It now measures indentation in
      // CommonMark columns BEFORE trimming, so both predicates agree and
      // the disagreement is gone. GFM has always read this line as a
      // paragraph continuation (zero tables, measured against
      // `micromark-extension-gfm-table@2.1.2`, 2026-09-17).
      ["    | - | - |", false, false],
      // Tabs, the mechanism ADR-0008 missed: `countLeadingSpaces` counted
      // only U+0020, so a tab measured as indent 0 and MAX_INDENT never
      // fired — on the delimiter OR on the header. One tab is column 4.
      ["\t| - | - |", false, false],
      ["\t| a | b |", false, false],
      [" \t| - | - |", false, false], // space + tab -> column 4
      ["   \t| - | - |", false, false], // 3 spaces + tab -> column 4
      ["", false, false],
      ["| ---  --- | --- |", false, true], // a JOINED cell
      ["| -- x | --- |", false, true],
      ["| :: | --- |", false, true],
      ["| |", false, true],
    ];

    for (const [text, delim, candidate] of cases) {
      const lr = lineOf(text);
      expect(isDelimiterLine(lr), `isDelimiterLine(${JSON.stringify(text)})`).toBe(
        delim,
      );
      expect(
        isTableCandidateLine(lr),
        `isTableCandidateLine(${JSON.stringify(text)})`,
      ).toBe(candidate);
    }
  });

  /**
   * Added with WI-3. A structural guard on a WI-3 acceptance criterion:
   * copy-pasting the predicate into the scanner "for speed" is the drift
   * this exists to prevent. Renaming the function breaks it — accepted;
   * it carries no behavioural claim on its own.
   */
  it("PRED-single-definition: isTableCandidateLine is defined in lines.ts and nowhere else", () => {
    const dir = join(process.cwd(), "src", "utils", "tableParser");
    const owners: string[] = [];
    for (const file of ["parse.ts", "lines.ts", "scan.ts"]) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      if (readFileSync(path, "utf8").includes("function isTableCandidateLine")) {
        owners.push(file);
      }
    }
    expect(owners).toEqual(["lines.ts"]);
  });
});
