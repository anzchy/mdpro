/**
 * D13 — the column-count linter forced `TableModel.raw`, so D11's lazy
 * `raw` saved nothing on the lint path.
 *
 * `columnCountDiagnosticsFromSource` read `table.raw` and `.split("\n")` it.
 * On a document that is one table (the corpus `large-table.source.md` shape,
 * 232,981 rows / 9,785,219 chars) that is one `slice()` of the WHOLE
 * document plus ~233k line strings, on every 750 ms lint tick.
 *
 * WHY THIS COUNTS OPERATIONS AND NOT MILLISECONDS: E39/G0. The invariant is
 * "the lint path copies zero table-sized strings", which is exactly
 * countable and machine-independent.
 *
 * The counting source is a thin delegate over the REAL `linesFromString`
 * (same technique as `tests/table-parser-lazy-raw.test.ts`), never a
 * hand-built fake: a fake would let a linter that had stopped reading lines
 * correctly pass.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import type { TableModel } from "../src/utils/tableParser/types";
import { linesFromString, type TableLineSource } from "../src/utils/tableParser/lines";
import {
  columnCountDiagnosticsFromSource,
  tableColumnCountDiagnostics,
} from "../src/plugins/codemirror/lintTableColumnCount";
import { isPositionInFencedCode } from "../src/plugins/codemirror/sourceTableDetection";
import { legacyColumnCountDiagnosticsFromSource } from "./support/legacyLintColumnCount";
import { makeCorpus, SEED } from "./support/tableCorpus";

/**
 * Instrument — NOT a replacement. Every model the real `scanTables` returns
 * is handed back with its own `raw` getter wrapped by a counter that still
 * delegates to the original getter. Needed because `raw` reads are the
 * defect, and a model is built inside the linter where a test cannot reach.
 */
const rawReads = { count: 0 };
vi.mock("../src/utils/tableParser/scan", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/utils/tableParser/scan")>();
  return {
    ...real,
    scanTables: (...args: Parameters<typeof real.scanTables>): TableModel[] =>
      real.scanTables(...args).map((model) => {
        const desc = Object.getOwnPropertyDescriptor(model, "raw");
        const get = desc?.get;
        if (!get) return model;
        Object.defineProperty(model, "raw", {
          ...desc,
          get() {
            rawReads.count += 1;
            return get.call(model);
          },
        });
        return model;
      }),
  };
});

interface Counts {
  line: number;
  slice: number;
}

function countingSource(text: string): { src: TableLineSource; counts: Counts } {
  const inner = linesFromString(text);
  const counts: Counts = { line: 0, slice: 0 };
  const src: TableLineSource = {
    get length() {
      return inner.length;
    },
    get lineCount() {
      return inner.lineCount;
    },
    line: (i) => {
      counts.line += 1;
      return inner.line(i);
    },
    lineIndexAt: (o) => inner.lineIndexAt(o),
    iterLines: () => inner.iterLines(),
    slice: (start, end) => {
      counts.slice += 1;
      return inner.slice(start, end);
    },
  };
  return { src, counts };
}

/** One table, `R` rows (header + R-1 body), every 10th body row one cell short. */
function singleTableDoc(rows: number): string {
  const out = ["| a | b | c | d |", "| - | - | - | - |"];
  for (let i = 1; i < rows; i += 1) {
    out.push(i % 10 === 0 ? `| ${i} | x | y |` : `| ${i} | x | y | z |`);
  }
  return `${out.join("\n")}\n`;
}

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

describe("D13 — the lint path copies no table text", () => {
  it("d13_lint_copies_nothing: a single-table document makes zero slice calls and zero raw reads", () => {
    // REGRESSION — D13. Against the raw-reading linter this is 1 slice and
    // 1 raw read, and the one slice is the whole document.
    const doc = singleTableDoc(200);
    const { src, counts } = countingSource(doc);
    rawReads.count = 0;

    const diagnostics = columnCountDiagnosticsFromSource(src);

    expect(diagnostics, "the fixture must actually produce warnings").toHaveLength(19);
    expect(counts.slice).toBe(0);
    expect(rawReads.count).toBe(0);
  });

  it("the editor path never calls sliceString or toString on the rope", () => {
    const state = makeState(singleTableDoc(200));
    const sliceString = vi.spyOn(state.doc, "sliceString");
    const toString = vi.spyOn(state.doc, "toString");
    rawReads.count = 0;

    expect(tableColumnCountDiagnostics(state)).toHaveLength(19);
    expect(sliceString).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
    expect(rawReads.count).toBe(0);
  });

  it("d13_line_bound: line() calls stay within 2R + 5 at two sizes (linear, not quadratic)", () => {
    // 2R + 5 is what the whole lint pass cost BEFORE D13 (all of it inside
    // `scanTables`; the raw-reading loop made no line() calls). The fix
    // must not buy its zero copies with extra line lookups.
    for (const rows of [100, 2_000]) {
      const { src, counts } = countingSource(singleTableDoc(rows));
      columnCountDiagnosticsFromSource(src);
      expect(counts.line, `R = ${rows}`).toBeLessThanOrEqual(2 * rows + 5);
    }
  });
});

const CRLF_RAGGED = "| a | b |\r\n| - | - |\r\n| 1 |\r\n| 2 | 3 | 4 |\r\n| 5 | 6 |\r\n";

const EQUIVALENCE_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["well-formed table", "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n"],
  ["ragged: short and long rows", "| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 | 5 |\n| 6 | 7 | 8 |\n| 9 | 10 |\n"],
  [
    "multiple tables",
    "| a | b |\n| - | - |\n| 1 |\n\nprose\n\n| x | y | z |\n| - | - | - |\n| 4 | 5 |\n| 6 | 7 | 8 | 9 |\n",
  ],
  ["table inside a fenced block (skipped)", "```\n| h | h |\n| - | - |\n| 1 |\n```\n\n| a | b |\n| - | - |\n| 1 |\n"],
  ["CRLF, ragged", CRLF_RAGGED],
  ["CRLF, last row at EOF with no newline", "| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n| 3 |\r"],
  ["trailing blank line", "| a | b |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |\n\n"],
  ["table at EOF, no trailing newline", "text\n\n| a | b |\n| - | - |\n| 1 | 2 | 3 |"],
  ["header only", "| a | b |\n| - | - |\n"],
  ["delimiter only", "| - | - |\n"],
  ["delimiter-shaped header", "| - | - |\n| - | - |\n| 1 |\n"],
  ["escaped pipes in cells", "| h1 | h2 |\n| -- | -- |\n| a \\| b | c |\n| a \\| b \\| c |\n"],
  ["no edge pipes", "a | b | c\n- | - | -\n1 | 2\n1 | 2 | 3 | 4\n"],
  ["CJK and astral text (UTF-16 offsets)", "| 中文 | 😀 |\n| - | - |\n| 𠀀𠀁 |\n| 表 | 格 | 😀😀 |\n| ok | ok |\n"],
  ["prose with no tables", "Just prose.\nMore.\n"],
  ["single table, 200 rows, every 10th short", singleTableDoc(200)],
];

describe("D13 — output is identical to the frozen pre-fix linter", () => {
  for (const [name, doc] of EQUIVALENCE_FIXTURES) {
    it(`matches the reference (string source): ${name}`, () => {
      expect(columnCountDiagnosticsFromSource(linesFromString(doc))).toEqual(
        legacyColumnCountDiagnosticsFromSource(linesFromString(doc)),
      );
    });

    it(`matches the reference (editor source + fence predicate): ${name}`, () => {
      const state = makeState(doc);
      const isFenced = (pos: number) => isPositionInFencedCode(state, pos);
      // `EditorState` normalises CRLF to LF, so the reference runs over the
      // editor's own text, not the fixture string.
      expect(tableColumnCountDiagnostics(state)).toEqual(
        legacyColumnCountDiagnosticsFromSource(linesFromString(state.doc.toString()), isFenced),
      );
    });
  }

  it("the comparison is not vacuous: fixtures produce warnings, CRLF ones included", () => {
    const total = EQUIVALENCE_FIXTURES.reduce(
      (n, [, doc]) => n + legacyColumnCountDiagnosticsFromSource(linesFromString(doc)).length,
      0,
    );
    expect(total).toBeGreaterThan(30);
    // Under CRLF the pre-fix `to` covers the row's `\r` (the raw split kept
    // it); the rewrite must reproduce that, not "fix" it silently.
    const crlf = legacyColumnCountDiagnosticsFromSource(linesFromString(CRLF_RAGGED));
    expect(crlf.map((d) => CRLF_RAGGED.slice(d.from, d.to))).toEqual(["| 1 |\r", "| 2 | 3 | 4 |\r"]);
  });

  it("matches the reference across the 200-document seeded table corpus", () => {
    let warned = 0;
    for (const { index, source } of makeCorpus(SEED, 200)) {
      const expected = legacyColumnCountDiagnosticsFromSource(linesFromString(source));
      warned += expected.length;
      expect(columnCountDiagnosticsFromSource(linesFromString(source)), `corpus #${index}`).toEqual(
        expected,
      );
    }
    expect(warned, "the corpus must exercise mismatches").toBeGreaterThan(0);
  });
});
