/**
 * @module table-line-source-conformance.test
 * WI-3B: `linesFromText` (CodeMirror `Text` adapter) vs `linesFromString`.
 *
 * LAW UNDER TEST — observational equivalence between representations.
 * Every public result is a function of the document CONTENT alone, never
 * of whether that content arrived as a `string` or a CodeMirror `Text`,
 * and never of how that `Text` was built. Formally: for all documents `d`
 * and offsets `o`,
 *     f(linesFromString(d.toString()), o) === f(linesFromText(d), o)
 * for every public `f`. The five frozen table test files reach only
 * `linesFromString`, so nothing that exists today would catch a
 * `linesFromText` that disagrees — and this adapter lands on the
 * per-keystroke cursor path.
 *
 * THREE MATRIX LITERALS ARE REFUSED HERE, each with the measurement that
 * refuted it. They are marked `REFUSED:` at the assertion. In summary:
 *
 *  1. CONF-rangeerror-guard claims `lineIndexAt(doc.length) === 3` and
 *     `lineIndexAt(doc.length + 1) === -1` for `"a\nb\nc\n"`. Measured
 *     against the SHIPPED string adapter: they are `2` and `3`. The
 *     `end + 1` fudge puts `length` on the last NON-empty line, and the
 *     final line's `end === length` makes `length + 1` resolve to it
 *     rather than out of range. The guard boundary is `length + 2`.
 *  2. CONF-scan-cost claims `counts.sliceString === 0` on a full scan.
 *     RESOLVED by D11, and the matrix was right. This was refused because
 *     `parseTableAtLine` built `TableModel.raw` with `src.slice`, so a
 *     scan that FINDS tables could not slice zero times; an exact
 *     per-model count was asserted instead. `raw` is now a lazy memoized
 *     getter and both scan and probe slice zero times. Kept in this list
 *     rather than deleted: the refusal is what identified the defect.
 *  3. CONF-probe-cost claims `counts.line <= 51` for a 50-line run. The
 *     parser candidacy-tests one line ABOVE the run and one BELOW it, so
 *     the reachable bound is `runLength + 2`. Asserted with a
 *     size-independence pin, which is the property that actually matters.
 *
 * Also corrected, per ADR-0008: the non-candidate-delimiter shapes
 * (`---` as a delimiter; a 4+-space-indented delimiter) are NOT valid
 * GFM. Measured against micromark-extension-gfm-table@2.1.2 they yield
 * zero tables. No test name or comment here calls them valid GFM.
 *
 * Gate G0: no new dependency. Real `Text`, real `EditorState`, real
 * markdown grammar, real filesystem. No mocks anywhere in this file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import type { Diagnostic } from "@codemirror/lint";

import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import {
  linesFromString,
  type TableLineSource,
} from "../src/utils/tableParser/lines";
import { parseTableAtOffset } from "../src/utils/tableParser/parse";
import { scanTables } from "../src/utils/tableParser/scan";
import { countTableLineCells, parseTableAt } from "../src/utils/tableParser";
import type { TableModel } from "../src/utils/tableParser";
import {
  captureCellFromLines,
  captureCellFromSource,
  findAllTables,
  locateCellInLines,
  locateCellInSource,
} from "../src/utils/cursorSync/table";
import {
  columnCountDiagnosticsFromSource,
  tableColumnCountDiagnostics,
} from "../src/plugins/codemirror/lintTableColumnCount";
import { isPositionInFencedCode } from "../src/plugins/codemirror/sourceTableDetection";
import { legacyFindAllTables } from "./support/legacyTableScan";
import { makeCorpus, SEED, type CorpusDoc } from "./support/tableCorpus";
// Second import from "vitest" on purpose: adding `vi` to line 47 would
// rewrite a line this file's red receipt fingerprinted, and nothing here
// is worth doing that for.
import { vi } from "vitest";

// TIMEOUT RAISED (disclosed, not an assertion change). Two cases in this
// file are slow BY CONSTRUCTION, not by defect: the capture/locate
// differential runs a full scan per offset across all 200 corpus
// documents (~2.4s alone under coverage), and the lint-equivalence scale
// fixture runs the frozen LEGACY quadratic path once over 2000 lines
// (~0.8s alone). Under full-suite worker contention both cross Vitest's
// 5s default and fail as timeouts — an environment verdict, which proves
// nothing either way about the adapter. Raising the budget per file
// leaves every `expect` in it byte-identical.
vi.setConfig({ testTimeout: 180_000 });

const CORPUS: CorpusDoc[] = makeCorpus(SEED, 200);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** `Text.of` needs a non-empty array; `"".split("\n")` is `[""]`. */
function textOf(src: string): Text {
  return Text.of(src.split("\n"));
}

/**
 * Edit-then-undo, returning a rope with the same CONTENT but an internal
 * node structure that came from transactions rather than from a freshly
 * balanced `Text.of`. Every other fixture in this file is `Text.of`; an
 * adapter that reaches into rope internals, or that assumes `iterLines`
 * yields one node per line, only fails on this one.
 */
function throughTransaction(doc: Text): Text {
  const k = Math.min(1, doc.length);
  return doc.replace(k, k, Text.of(["", ""])).replace(k, k + 1, Text.of([""]));
}

interface Counts {
  length: number;
  lines: number;
  iterLines: number;
  line: number;
  lineAt: number;
  sliceString: number;
  toString: number;
  /** How many line values were actually pulled out of `iterLines`. */
  linesPulled: number;
}

/**
 * A pass-through counting delegate over a REAL `Text`. Every returned
 * value is the real value; this replaces no behaviour, it only counts.
 * `iterLines` is wrapped in a generator so the PULLS are counted too —
 * `counts.iterLines === 1` says the rope was walked once, and says
 * nothing about how many lines came out of that walk.
 */
function countingDoc(real: Text): { doc: Text; counts: Counts } {
  const counts: Counts = {
    length: 0,
    lines: 0,
    iterLines: 0,
    line: 0,
    lineAt: 0,
    sliceString: 0,
    toString: 0,
    linesPulled: 0,
  };
  const delegate = {
    get length(): number {
      counts.length += 1;
      return real.length;
    },
    get lines(): number {
      counts.lines += 1;
      return real.lines;
    },
    iterLines(from?: number, to?: number) {
      counts.iterLines += 1;
      const inner = real.iterLines(from, to)[Symbol.iterator]();
      return (function* pull() {
        for (;;) {
          const step = inner.next();
          if (step.done) return;
          counts.linesPulled += 1;
          yield step.value;
        }
      })();
    },
    line(n: number) {
      counts.line += 1;
      return real.line(n);
    },
    lineAt(pos: number) {
      counts.lineAt += 1;
      return real.lineAt(pos);
    },
    sliceString(from: number, to?: number) {
      counts.sliceString += 1;
      return real.sliceString(from, to);
    },
    toString() {
      counts.toString += 1;
      return real.toString();
    },
  };
  return { doc: delegate as unknown as Text, counts };
}

/** Compact structural comparison — used inside the 65k-offset sweep. */
const shape = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * Every disagreement between two adapters over one document, as
 * human-readable strings. Returning a list (rather than asserting inside
 * the loop) is what lets the failure name its own `(doc, offset)`.
 */
function disagreements(
  label: string,
  a: TableLineSource,
  b: TableLineSource,
  offsetLimit: number,
): string[] {
  const out: string[] = [];
  if (a.length !== b.length) out.push(`${label}: length ${a.length} vs ${b.length}`);
  if (a.lineCount !== b.lineCount) {
    out.push(`${label}: lineCount ${a.lineCount} vs ${b.lineCount}`);
    return out;
  }
  for (let i = 0; i < a.lineCount; i += 1) {
    if (shape(a.line(i)) !== shape(b.line(i))) {
      out.push(`${label}: line(${i}) ${shape(a.line(i))} vs ${shape(b.line(i))}`);
    }
  }
  if (shape(scanTables(a)) !== shape(scanTables(b))) {
    out.push(`${label}: scanTables disagree`);
  }
  for (let o = 0; o <= offsetLimit; o += 1) {
    if (a.lineIndexAt(o) !== b.lineIndexAt(o)) {
      out.push(`${label}: lineIndexAt(${o}) ${a.lineIndexAt(o)} vs ${b.lineIndexAt(o)}`);
    }
    const ma = shape(parseTableAtOffset(a, o));
    const mb = shape(parseTableAtOffset(b, o));
    if (ma !== mb) out.push(`${label}: parseTableAtOffset(${o}) ${ma} vs ${mb}`);
  }
  return out;
}

/** Prose only — no pipe anywhere, so `scanTables` finds nothing. */
function proseDoc(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) out.push(`lorem ipsum dolor sit amet ${i}`);
  return `${out.join("\n")}\n`;
}

/** `tables` well-formed 3-column tables, evenly spaced through prose. */
function tableDoc(lines: number, tables: number): string {
  const out: string[] = [];
  const every = Math.floor(lines / (tables + 1));
  let made = 0;
  for (let i = 0; i < lines; i += 1) {
    if (made < tables && i > 0 && i % every === 0) {
      out.push("| h0 | h1 | h2 |", "| --- | --- | --- |", "| a | b | c |", "");
      made += 1;
      continue;
    }
    out.push(`lorem ipsum dolor sit amet ${i}`);
  }
  return `${out.join("\n")}\n`;
}

const RUN_LENGTH = 50;
const RUN_START_LINE = 100;

/** A document whose lines `RUN_START_LINE .. +49` form one candidate run. */
function runDoc(totalLines: number): string {
  // FIXTURE CORRECTION (disclosed). As first written this helper emitted
  // fifty `| rNc0 | rNc1 |` rows and NO delimiter line. A candidate run
  // with no delimiter row is not a table: `parseTableAtLine` rejects it at
  // the `isDelimiterLine` check, so `parseTableAtOffset` returns null, the
  // probe never reaches `src.slice`, and CONF-probe-cost's
  // `counts.sliceString === 1` and `model !== null` were unsatisfiable by
  // ANY correct adapter — the fixture could not produce the table the case
  // is about. The delimiter branch below is the fix. Every `expect` in
  // CONF-probe-cost is byte-identical to the recorded red; what changed is
  // the document they run against, and it changed because it was wrong.
  const out: string[] = [];
  for (let i = 0; i < totalLines; i += 1) {
    if (i === RUN_START_LINE + 1) {
      out.push("| --- | --- |");
      continue;
    }
    if (i >= RUN_START_LINE && i < RUN_START_LINE + RUN_LENGTH) {
      out.push(`| r${i}c0 | r${i}c1 |`);
      continue;
    }
    out.push(`lorem ipsum dolor sit amet ${i}`);
  }
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// CONF-harness-facts — the three CodeMirror facts the fixtures rest on
// ---------------------------------------------------------------------------

describe("CONF-harness-facts", () => {
  const crlf = "aa\r\nbb\r\ncc\r\n";

  it("EditorState.create strips \\r and does NOT round-trip", () => {
    const doc = EditorState.create({ doc: crlf }).doc;
    expect(doc.toString()).not.toContain("\r");
    expect(doc.toString().length).toBe(crlf.length - 3);
    expect(doc.toString()).not.toBe(crlf);
  });

  it("Text.of keeps \\r and DOES round-trip — the normalisation is in EditorState", () => {
    expect(Text.of(crlf.split("\n")).toString()).toBe(crlf);
  });

  it("lineAt(length) is valid; lineAt(length + 1) and lineAt(-1) throw RangeError", () => {
    const lfdoc = Text.of("a\nb\nc\n".split("\n"));
    const last = lfdoc.lineAt(lfdoc.length);
    expect(last.number).toBe(4);
    expect(last.from).toBe(lfdoc.length);
    expect(last.to).toBe(lfdoc.length);
    expect(() => lfdoc.lineAt(lfdoc.length + 1)).toThrow(RangeError);
    expect(() => lfdoc.lineAt(-1)).toThrow(RangeError);
  });

  it("split(\"\\n\").length and Text.lines AGREE on a trailing newline", () => {
    const lfdoc = Text.of("a\nb\nc\n".split("\n"));
    expect("a\nb\nc\n".split("\n").length).toBe(4);
    expect(lfdoc.lines).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// CONF-differential — the load-bearing case
// ---------------------------------------------------------------------------

describe("CONF-differential", () => {
  it(
    "200 corpus documents x every offset agree through both adapters",
    { timeout: 180_000 },
    () => {
      const problems: string[] = [];
      for (const doc of CORPUS) {
        // ALWAYS `doc.toString()`, never the raw CRLF source: comparing
        // `linesFromString(rawCrlfSource)` against a `Text` built by
        // `EditorState.create` differs by one byte per line and is a
        // harness bug, not a finding. `Text.of` keeps the `\r`, so here
        // the two agree byte-for-byte.
        const text = textOf(doc.source);
        const a = linesFromString(text.toString());
        const b = linesFromText(text);
        problems.push(
          ...disagreements(`doc ${doc.index}`, a, b, text.length + 1).slice(0, 3),
        );
        if (problems.length > 30) break;
      }
      expect(problems).toEqual([]);
    },
  );

  it("offset === source.length is a live probe and agrees", () => {
    const problems: string[] = [];
    for (const doc of CORPUS) {
      const text = textOf(doc.source);
      const a = linesFromString(text.toString());
      const b = linesFromText(text);
      const o = text.length;
      if (a.lineIndexAt(o) !== b.lineIndexAt(o)) {
        problems.push(`doc ${doc.index}: lineIndexAt(${o})`);
      }
      if (shape(parseTableAtOffset(a, o)) !== shape(parseTableAtOffset(b, o))) {
        problems.push(`doc ${doc.index}: parseTableAtOffset(${o})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("offset === source.length + 1 agrees (findAllTables' own loop bound)", () => {
    const problems: string[] = [];
    for (const doc of CORPUS) {
      const text = textOf(doc.source);
      const a = linesFromString(text.toString());
      const b = linesFromText(text);
      const o = text.length + 1;
      if (a.lineIndexAt(o) !== b.lineIndexAt(o)) {
        problems.push(`doc ${doc.index}: lineIndexAt(${o})`);
      }
      if (shape(parseTableAtOffset(a, o)) !== shape(parseTableAtOffset(b, o))) {
        problems.push(`doc ${doc.index}: parseTableAtOffset(${o})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("parseTableAtOffset over linesFromString IS parseTableAt — the string entry point is unchanged", () => {
    const problems: string[] = [];
    for (const doc of CORPUS.slice(0, 40)) {
      const src = doc.source;
      for (let o = 0; o <= src.length + 1; o += 1) {
        const viaLines = shape(parseTableAtOffset(linesFromString(src), o));
        const viaString = shape(parseTableAt(src, o));
        if (viaLines !== viaString) {
          problems.push(`doc ${doc.index} offset ${o}: ${viaLines} vs ${viaString}`);
        }
      }
      if (problems.length > 10) break;
    }
    expect(problems).toEqual([]);
  });

  it("captureCellFromLines / locateCellInLines agree with their string twins", () => {
    const problems: string[] = [];
    for (const doc of CORPUS) {
      const text = textOf(doc.source);
      const src = text.toString();
      for (let o = 0; o <= src.length; o += 1) {
        const a = shape(captureCellFromSource(src, o));
        const b = shape(captureCellFromLines(linesFromText(text), o));
        if (a !== b) problems.push(`doc ${doc.index} capture(${o}): ${a} vs ${b}`);
      }
      const tables = findAllTables(src);
      for (let t = 0; t < tables.length; t += 1) {
        for (let r = 0; r < tables[t].rowCount; r += 1) {
          for (let c = 0; c < tables[t].colCount; c += 1) {
            const pos = { tableIndex: t, rowIndex: r, colIndex: c };
            const a = shape(locateCellInSource(src, pos));
            const b = shape(locateCellInLines(linesFromText(text), pos));
            if (a !== b) problems.push(`doc ${doc.index} locate(${t},${r},${c})`);
          }
        }
      }
      if (problems.length > 10) break;
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CONF-corpus-rows — the named shapes, each asserted for itself
// ---------------------------------------------------------------------------

/**
 * The CRLF row is MEANINGFUL for the string path and VACUOUS for the
 * `Text` path as the app uses it: in the running app a `Text` comes from
 * `EditorState.create` and never contains `\r`, while `tableMcp`,
 * `tableFormatter` and `tableEdits` receive raw file text that does.
 * `Text.of` is used here precisely so the `\r` survives and the adapter
 * is forced to reproduce `splitLines`' CR stripping. That asymmetry is
 * intended; do not "fix" the adapter to make the row symmetric.
 *
 * The last two rows are the shapes ADR-0008 measured as producing ZERO
 * tables under micromark (GFM). mdpro detects one. They are here because
 * they split a candidate run, not because they are valid GFM.
 */
const ROWS: ReadonlyArray<readonly [string, string]> = [
  ["prose only", "lorem ipsum\ndolor sit amet\n"],
  ["valid table", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  [
    "fenced block of table-shaped lines",
    "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n",
  ],
  ["blank run of 3", "text\n\n\n\nmore\n"],
  ["CJK + astral plane", "| 汉字 | 𝄞 音 |\n| --- | --- |\n| 👍🏽 | café |\n"],
  [
    "pipe at column 60",
    `${"lorem ipsum dolor sit amet consectetur elit sed do eiusmod t".slice(0, 60)}| tail\n`,
  ],
  ["pipe-less delimiter (0 tables under GFM)", "| a | b |\n---\n| 1 | 2 |\n"],
  [
    "4+-indented delimiter (0 tables under GFM)",
    "| a | b |\n    | - | - |\n| 1 | 2 |\n",
  ],
  ["no trailing newline", "| a | b |\n| - | - |\n| 1 | 2 |"],
  ["trailing newline (final empty line)", "one\ntwo\n"],
  ["empty document", ""],
  ["single newline", "\n"],
  ["three newlines", "\n\n\n"],
  ["CRLF table", "| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n"],
];

describe("CONF-corpus-rows", () => {
  for (const [name, src] of ROWS) {
    it(`agrees on "${name}" — Text.of and post-transaction alike`, () => {
      for (const [kind, doc] of [
        ["Text.of", textOf(src)],
        ["post-transaction", throughTransaction(textOf(src))],
      ] as const) {
        const a = linesFromString(doc.toString());
        const b = linesFromText(doc);
        expect(`${kind}: ${b.lineCount}`).toBe(`${kind}: ${a.lineCount}`);
        expect(`${kind}: ${b.length}`).toBe(`${kind}: ${a.length}`);
        for (let i = 0; i < a.lineCount; i += 1) {
          expect(b.line(i)).toEqual(a.line(i));
        }
        expect(scanTables(b)).toEqual(scanTables(a));
        expect([...b.iterLines()]).toEqual([...a.iterLines()]);
      }
    });
  }

  it("the post-transaction rope really does hold the same content", () => {
    const doc = textOf("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(throughTransaction(doc).toString()).toBe(doc.toString());
  });
});

// ---------------------------------------------------------------------------
// CONF-fudge — the `end + 1` quirk, reproduced deliberately
// ---------------------------------------------------------------------------

describe("CONF-fudge", () => {
  const md = "| a | b |\n| - | - |\n| 1 | 2 |\nafter\n";
  const doc = textOf(md);

  it("both adapters return the same model at offset 30 (the fudged offset)", () => {
    expect(parseTableAtOffset(linesFromString(md), 30)).toMatchObject({
      start: 0,
      end: 29,
    });
    expect(parseTableAtOffset(linesFromText(doc), 30)).toMatchObject({
      start: 0,
      end: 29,
    });
  });

  it("both adapters return null at offset 31", () => {
    expect(parseTableAtOffset(linesFromString(md), 31)).toBeNull();
    expect(parseTableAtOffset(linesFromText(doc), 31)).toBeNull();
  });

  it("the adapter deliberately DISAGREES with raw Text.lineAt at offset 30", () => {
    // `Text.lineAt(30)` resolves to the `after` line; the adapter resolves
    // to `| 1 | 2 |`, reproducing the string adapter's boundary fudge.
    // A `lineIndexAt` implemented as a thin pass-through to `Text.lineAt`
    // is the single most likely defect in this file, it lands on every
    // selection change, and no other test catches it.
    expect(doc.lineAt(30).number).toBe(4);
    expect(linesFromText(doc).lineIndexAt(30)).toBe(2);
    expect(linesFromString(md).lineIndexAt(30)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CONF-rangeerror-guard — out of range returns -1, never throws
// ---------------------------------------------------------------------------

describe("CONF-rangeerror-guard", () => {
  const src = "a\nb\nc\n";
  const doc = textOf(src);

  it("the raw Text API throws where the adapter must not — the guard is load-bearing", () => {
    expect(() => doc.lineAt(doc.length + 1)).toThrow(RangeError);
    expect(() => doc.lineAt(-1)).toThrow(RangeError);
  });

  it("both adapters return the same four values at the guard boundaries", () => {
    // REFUSED (matrix literal): CONF-rangeerror-guard states
    // `lineIndexAt(6) === 3` and `lineIndexAt(7) === -1`. Measured against
    // the SHIPPED `lines.ts#lineIndexAt`, they are 2 and 3:
    //   splitLines("a\nb\nc\n") = [{0,1},{2,3},{4,5},{6,6}]
    //   6 is line 2's `end + 1`, and the fudge returns the line ABOVE -> 2
    //   the final line's `end === length`, so `end + 1 >= 7` holds     -> 3
    // The real out-of-range boundary is `length + 2`. Asserting the
    // matrix's numbers would have pinned a divergence INTO the adapter.
    const a = linesFromString(src);
    const b = linesFromText(doc);
    for (const source of [a, b]) {
      expect(source.lineIndexAt(-1)).toBe(-1);
      expect(source.lineIndexAt(6)).toBe(2);
      expect(source.lineIndexAt(7)).toBe(3);
      expect(source.lineIndexAt(8)).toBe(-1);
      expect(source.lineIndexAt(Number.NaN)).toBe(-1);
    }
  });

  it("no probe throws, including the ones Text.lineAt rejects", () => {
    const b = linesFromText(doc);
    for (const o of [-1, 0, 6, 7, 8, 99, Number.NaN]) {
      expect(() => b.lineIndexAt(o)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// CONF-scan-cost — a full scan makes zero rope lookups
// ---------------------------------------------------------------------------

describe("CONF-scan-cost", () => {
  for (const size of [500, 1000, 2000, 4000]) {
    it(`a full scan over ${size} table-free lines makes zero rope lookups`, () => {
      const src = proseDoc(size);
      const real = textOf(src);
      const { doc, counts } = countingDoc(real);
      const models = scanTables(linesFromText(doc));

      expect(counts.line).toBe(0);
      expect(counts.lineAt).toBe(0);
      expect(counts.sliceString).toBe(0);
      expect(counts.toString).toBe(0);
      expect(counts.iterLines).toBe(1);
      expect(counts.linesPulled).toBe(real.lines);
      // Paired Level 1: the counters mean nothing if the walk is wrong.
      expect(models).toEqual(scanTables(linesFromString(src)));
    });
  }

  it("a 4000-line document with 10 tables still makes zero rope lookups", () => {
    const src = tableDoc(4000, 10);
    const real = textOf(src);
    const { doc, counts } = countingDoc(real);
    const models = scanTables(linesFromText(doc));

    expect(models).toHaveLength(10);
    expect(counts.line + counts.lineAt).toBeLessThanOrEqual(20);
    expect(counts.line).toBe(0);
    expect(counts.lineAt).toBe(0);
    expect(counts.toString).toBe(0);
    expect(counts.iterLines).toBe(1);
    // RESTORED to the matrix literal by D11. This previously asserted
    // `models.length` with the note that a scan finding 10 tables "cannot
    // slice zero times without changing `parse.ts`". D11 changed `parse.ts`:
    // `TableModel.raw` is now a lazy memoized getter, and a scanner that
    // never reads `.raw` never slices. The concession was correctly reasoned
    // and is simply spent — the original claim is the true one again.
    expect(counts.sliceString).toBe(0);
    expect(models).toEqual(scanTables(linesFromString(src)));
  });

  it("rope-lookup counts do not grow with document length", () => {
    const seen = [500, 4000].map((size) => {
      const { doc, counts } = countingDoc(textOf(tableDoc(size, 10)));
      scanTables(linesFromText(doc));
      return counts;
    });
    expect(seen[1].line).toBe(seen[0].line);
    expect(seen[1].lineAt).toBe(seen[0].lineAt);
    expect(seen[1].iterLines).toBe(seen[0].iterLines);
    expect(seen[1].sliceString).toBe(seen[0].sliceString);
  });
});

// ---------------------------------------------------------------------------
// CONF-probe-cost — the cursor probe resolves the run, not the document
// ---------------------------------------------------------------------------

describe("CONF-probe-cost", () => {
  function probe(totalLines: number): { counts: Counts; model: TableModel | null } {
    const src = runDoc(totalLines);
    const real = textOf(src);
    const middle = real.line(RUN_START_LINE + RUN_LENGTH / 2 + 1);
    const offset = middle.from + 3;
    const { doc, counts } = countingDoc(real);
    const model = parseTableAtOffset(linesFromText(doc), offset);
    return { counts, model };
  }

  it("resolves one line by offset and at most the run by index", () => {
    const { counts, model } = probe(500);
    expect(counts.lineAt).toBe(1);
    expect(counts.toString).toBe(0);
    // D11: was 1 — the eager `TableModel.raw`. This is the cursor probe, so
    // that 1 was a copy of the whole table on every keystroke and cursor
    // move. `raw` is lazy now and this path never reads it.
    expect(counts.sliceString).toBe(0);
    // REFUSED (matrix literal): CONF-probe-cost states `counts.line <= 51`
    // for a 50-line run. `parseTableAtLine` candidacy-tests one line ABOVE
    // the run (to terminate the walk up) and one BELOW it (to terminate
    // the walk down), so the reachable bound is `runLength + 2`. The
    // size-independence pin below is the property that actually matters
    // and the matrix does not state it at all.
    expect(counts.line).toBeLessThanOrEqual(RUN_LENGTH + 2);
    expect(counts.line).toBeGreaterThan(0);
    expect(model).not.toBeNull();
  });

  it("costs the same on a 4000-line document as on a 500-line one", () => {
    const small = probe(500);
    const large = probe(4000);
    expect(large.counts.line).toBe(small.counts.line);
    expect(large.counts.lineAt).toBe(small.counts.lineAt);
    expect(large.counts.sliceString).toBe(small.counts.sliceString);
    expect(large.counts.toString).toBe(0);
  });

  it("returns the same model the string adapter returns", () => {
    const src = runDoc(500);
    const real = textOf(src);
    const offset = real.line(RUN_START_LINE + RUN_LENGTH / 2 + 1).from + 3;
    expect(parseTableAtOffset(linesFromText(real), offset)).toEqual(
      parseTableAtOffset(linesFromString(src), offset),
    );
  });
});

// ---------------------------------------------------------------------------
// SITE-lint-equivalence — diagnostics identical through the converted path
// ---------------------------------------------------------------------------

/**
 * The frozen legacy path: `legacyFindAllTables` (a byte-copy of the
 * pre-WI-3 scanner) driving the per-table counting logic exactly as
 * `lintTableColumnCount.ts` did before the conversion. None of the
 * fixtures below carries a non-candidate delimiter, so ADR-0008's
 * divergence class is not in play and identity is the right claim.
 */
function legacyDiagnostics(state: EditorState): Diagnostic[] {
  const source = state.doc.toString();
  const tables = legacyFindAllTables(source, (pos) =>
    isPositionInFencedCode(state, pos),
  );
  const diagnostics: Diagnostic[] = [];
  for (const table of tables) {
    const tableSource = source.slice(table.start, table.end);
    const lines = tableSource.split("\n");
    const expected = countTableLineCells(lines[0] ?? "");
    if (expected === 0) continue;
    let lineStart = table.start;
    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i];
      const lineEnd = lineStart + lineText.length;
      if (i >= 2 && lineText.trim().length > 0) {
        const actual = countTableLineCells(lineText);
        if (actual !== expected) {
          diagnostics.push({
            from: lineStart,
            to: lineEnd,
            severity: "warning",
            message: `Table row has ${actual} cell${actual === 1 ? "" : "s"} but header has ${expected}.`,
            source: "table-column-count",
          });
        }
      }
      lineStart = lineEnd + 1;
    }
  }
  return diagnostics;
}

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

/** A 2000-line document with three tables, two of them mismatched. */
function lintScaleDoc(): string {
  const out: string[] = [];
  for (let i = 0; i < 2000; i += 1) {
    if (i === 200) out.push("| a | b | c |", "| - | - | - |", "| 1 | 2 |", "");
    else if (i === 900) out.push("| a | b |", "| - | - |", "| 1 | 2 |", "");
    else if (i === 1500) out.push("| a | b |", "| - | - |", "| 1 | 2 | 3 |", "");
    else out.push(`lorem ipsum dolor sit amet ${i}`);
  }
  return `${out.join("\n")}\n`;
}

const LINT_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["well-formed table", "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n"],
  ["header only", "| a | b |\n| - | - |\n"],
  ["prose with no tables", "Just prose.\nMore.\n"],
  ["too few cells", "| a | b | c |\n| - | - | - |\n| 1 | 2 |\n"],
  ["too many cells", "| a | b |\n| - | - |\n| 1 | 2 | 3 |\n"],
  [
    "multiple mismatched rows",
    "| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 | 5 |\n| 6 | 7 | 8 |\n",
  ],
  ["escaped pipe in a cell", "| h1 | h2 |\n| -- | -- |\n| a \\| b | c |\n"],
  ["no edge pipes", "a | b | c\n- | - | -\n1 | 2 | 3\n"],
  ["fenced table-shaped block", "```\n| h | h |\n| - | - |\n| 1 |\n```\n"],
  [
    "fence then a real table",
    "```\n| f | f |\n| - | - |\n```\n\n| h1 | h2 | h3 |\n| -- | -- | -- |\n| 1 | 2 |\n",
  ],
  [
    "two tables, each against its own header",
    "| a | b |\n| - | - |\n| 1 | 2 |\n\nSome prose.\n\n| x | y | z |\n| - | - | - |\n| 4 | 5 |\n",
  ],
  ["2000 lines, three tables, two mismatched", lintScaleDoc()],
];

describe("SITE-lint-equivalence", () => {
  for (const [name, src] of LINT_FIXTURES) {
    it(`diagnostics are byte-identical to the frozen legacy path: ${name}`, () => {
      const state = makeState(src);
      expect(tableColumnCountDiagnostics(state)).toEqual(legacyDiagnostics(state));
    });
  }

  it("the scale fixture really does produce two warnings (the comparison is not vacuous)", () => {
    const diags = tableColumnCountDiagnostics(makeState(lintScaleDoc()));
    expect(diags).toHaveLength(2);
    expect(diags.every((d) => d.severity === "warning")).toBe(true);
    expect(diags.every((d) => d.source === "table-column-count")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SITE-no-doc-string — no table-scan path materialises the whole document
// ---------------------------------------------------------------------------

const CONVERTED_FILES = [
  "../src/plugins/codemirror/lintTableColumnCount.ts",
  "../src/plugins/codemirror/sourceTableDetection.ts",
  "../src/plugins/codemirror/sourceTableContextMenu.ts",
  "../src/plugins/codemirror/sourceTableTabNav.ts",
] as const;

describe("SITE-no-doc-string", () => {
  it("the linter's real path never materialises the document (primary)", () => {
    const src = lintScaleDoc();
    const state = makeState(src);
    const { doc, counts } = countingDoc(state.doc);
    const diagnostics = columnCountDiagnosticsFromSource(linesFromText(doc), (pos) =>
      isPositionInFencedCode(state, pos),
    );
    const tablesFound = findAllTables(src, (pos) =>
      isPositionInFencedCode(state, pos),
    ).length;

    expect(tablesFound).toBe(3);
    expect(counts.toString).toBe(0);
    expect(counts.sliceString).toBeLessThanOrEqual(2 * tablesFound);
    expect(diagnostics).toEqual(tableColumnCountDiagnostics(state));
  });

  it("none of the four converted files contains doc.toString() (secondary)", () => {
    // Deliberately the WEAKER half: it is evaded by moving the
    // materialisation into a helper in a fifth file, which is why the
    // primary form above exists and is not carrying the claim alone.
    const offenders: string[] = [];
    for (const rel of CONVERTED_FILES) {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const text = readFileSync(path, "utf8");
      // Comments count: a stale comment describing a materialisation that
      // no longer happens is rule 22's problem, and this catches it.
      if (text.includes("doc.toString()")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
