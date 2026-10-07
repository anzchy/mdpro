// @vitest-environment node
/**
 * D11 — `TableModel.raw` copied the whole table on every cursor move.
 *
 * `parseTableAtLine` ended with `raw: src.slice(start, end)`, evaluated
 * eagerly. The CodeMirror cursor-context path re-runs the parser on every
 * keystroke, click and arrow key (`sourceTableDetection.ts`'s
 * `tableContextField.update` fires on `docChanged || selection`) and never
 * reads `.raw`. For a document that is one contiguous table — the corpus's
 * `large-table.source.md` is ~250k rows / 9.96 MB — that is a whole-document
 * string allocation per caret movement.
 *
 * WHY THIS COUNTS OPERATIONS AND NOT MILLISECONDS: E39/G0 forbid turning a
 * duration into a blocking gate, and rightly — a ms threshold fails on a
 * loaded CI box and passes on a fast one, so it gets raised until it means
 * nothing. The invariant here is not "fast", it is *"the cursor path performs
 * zero whole-table copies"*, which is exactly countable and machine-independent.
 *
 * `raw` stays a `string` on the public type. Every consumer
 * (`lintTableColumnCount.ts`, `tableWriteGuard.ts`) is untouched.
 */

import { describe, it, expect } from "vitest";
import { linesFromString, type TableLineSource } from "../src/utils/tableParser/lines";
import { parseTableAt, parseTableAtOffset } from "../src/utils/tableParser/parse";
import { scanTables } from "../src/utils/tableParser/scan";

/**
 * A `TableLineSource` that counts `slice` calls and records their arguments.
 *
 * Deliberately a thin delegating wrapper over the real `linesFromString`
 * rather than a hand-built fake: a fake line source would let this test pass
 * against a parser that had stopped reading lines correctly.
 */
function countingSource(text: string): {
  src: TableLineSource;
  sliceCalls: () => number;
} {
  const inner = linesFromString(text);
  let calls = 0;

  const src: TableLineSource = {
    get length() {
      return inner.length;
    },
    get lineCount() {
      return inner.lineCount;
    },
    line: (i) => inner.line(i),
    lineIndexAt: (o) => inner.lineIndexAt(o),
    iterLines: () => inner.iterLines(),
    slice: (start, end) => {
      calls += 1;
      return inner.slice(start, end);
    },
  };

  return { src, sliceCalls: () => calls };
}

const TABLE = ["| a | b |", "| - | - |", "| 1 | 2 |", "| 3 | 4 |"].join("\n");

describe("the cursor-context path performs no whole-table copy", () => {
  it("d11_cursor_path_copies_nothing: parsing at an offset makes zero slice calls", () => {
    // REGRESSION — D11. Against the eager `raw` this is 1, not 0, and the 1 is
    // a copy of the entire table. `sourceTableDetection.ts` calls exactly this
    // function on every keystroke and cursor move and never reads `.raw`.
    const { src, sliceCalls } = countingSource(TABLE);

    const model = parseTableAtOffset(src, 3);

    expect(model, "the fixture must actually parse as a table").not.toBeNull();
    expect(model!.colCount).toBe(2);
    expect(model!.rowCount).toBe(3);
    expect(sliceCalls()).toBe(0);
  });

  it("scanning a whole document copies nothing until raw is read", () => {
    // `scan.ts` probes `parseTableAtLine` once per run of candidate lines. With
    // an eager `raw` a document of N tables costs N full copies per scan.
    const doc = [TABLE, "", "text", "", TABLE, "", TABLE].join("\n");
    const { src, sliceCalls } = countingSource(doc);

    const models = scanTables(src);

    expect(models).toHaveLength(3);
    expect(sliceCalls()).toBe(0);
  });

  it("a parse that returns null copies nothing either", () => {
    const { src, sliceCalls } = countingSource("just a paragraph, no pipes\n");

    expect(parseTableAtOffset(src, 2)).toBeNull();
    expect(sliceCalls()).toBe(0);
  });
});

describe("raw still yields the exact substring, computed once", () => {
  it("reading raw returns the table text byte-for-byte", () => {
    const { src } = countingSource(TABLE);

    expect(parseTableAtOffset(src, 3)!.raw).toBe(TABLE);
  });

  it("raw is the substring between start and end, not the whole document", () => {
    const doc = `intro line\n\n${TABLE}\n\noutro line\n`;
    const { src } = countingSource(doc);
    const model = parseTableAtOffset(src, doc.indexOf("| 1 |"))!;

    expect(model.raw).toBe(TABLE);
    expect(model.raw).toBe(doc.slice(model.start, model.end));
  });

  it("d11_raw_is_memoized: reading raw twice costs exactly one slice", () => {
    // A plain getter would re-copy on every read, which would make
    // `lintTableColumnCount` and `tableWriteGuard` worse than before.
    const { src, sliceCalls } = countingSource(TABLE);
    const model = parseTableAtOffset(src, 3)!;

    const first = model.raw;
    const second = model.raw;

    expect(first).toBe(TABLE);
    expect(second).toBe(TABLE);
    expect(sliceCalls()).toBe(1);
  });

  it("a table ending at EOF with no trailing newline slices to the true end", () => {
    const doc = `lead\n\n${TABLE}`;
    const { src } = countingSource(doc);
    const model = parseTableAtOffset(src, doc.length - 2)!;

    expect(model.raw).toBe(TABLE);
    expect(model.end).toBe(doc.length);
  });

  it("the string adapter parseTableAt reports the same raw", () => {
    // `parseTableAt` builds its own line source; the laziness must survive the
    // adapter rather than being an artefact of the stub above.
    expect(parseTableAt(TABLE, 3)!.raw).toBe(TABLE);
  });
});

describe("raw behaves like a data property to everything that reads a model", () => {
  // Verified before the change: nothing in `tableParser/`, `plugins/codemirror/`
  // or `cursorSync/` spreads or serialises a TableModel today. These cases pin
  // that a getter does not quietly break either operation if one is added.

  it("spreading a model carries raw's value", () => {
    const model = parseTableAt(TABLE, 3)!;

    expect({ ...model }.raw).toBe(TABLE);
  });

  it("JSON.stringify emits raw", () => {
    const model = parseTableAt(TABLE, 3)!;

    expect(JSON.parse(JSON.stringify(model)).raw).toBe(TABLE);
  });

  it("raw is an enumerable own property", () => {
    const model = parseTableAt(TABLE, 3)!;

    expect(Object.keys(model)).toContain("raw");
  });
});
