/**
 * @module plugins/codemirror/textLineSource
 * Purpose: CodeMirror `Text`-backed `TableLineSource` (Phase 4 WI-3B), so
 * the table scanner runs over the editor's existing rope instead of a
 * freshly materialised copy of the document. Removes `doc.toString()`
 * from the table-scan paths in source mode: the cursor path (pinned at
 * 0 slices by `tests/table-parser-lazy-raw.test.ts`) and, since D13, the
 * lint path (`lintTableColumnCount` walks rows via `line()` instead of
 * reading `TableModel.raw`; pinned at 0 by
 * `tests/lint-table-column-count-no-raw.test.ts`). Before D13 that one
 * `raw` read landed here as `doc.sliceString(start, end)` — measured as
 * one slice of 9,785,219 chars per lint tick at 232,981 rows. `slice()`
 * still has one table-scan caller: `tableWriteGuard` reads `raw` once
 * per MCP table write.
 *
 * Pipeline: `Text` -> `linesFromText` -> `TableLineSource` ->
 * `tableParser/scan.ts#scanTables` / `parse.ts#parseTableAtOffset`.
 *
 * WHY THIS FILE IS NOT IN `src/utils/tableParser/`: the parser must not
 * import `@codemirror/state`. `lines.ts` defines the interface; the two
 * adapters sit on either side of that boundary, and this is the plugin
 * side. One algorithm, two adapters — never two parsers.
 *
 * Key decisions:
 *  - **Sequential when walked, random when probed.** A full scan asks for
 *    line 0 first and then walks forward, so it is served from ONE
 *    `doc.iterLines()` pass: amortised O(1) per line and ZERO
 *    `Text.line` / `Text.lineAt` calls. A cursor probe asks for a line in
 *    the middle of a 200k-line document, so it is served by `Text.line`
 *    (O(log n) each, bounded by the candidate run) rather than by
 *    iterating to it — which would make every cursor move O(document)
 *    and give back the cost this work item exists to remove. Both are
 *    pinned as counted integers by `CONF-scan-cost` / `CONF-probe-cost`.
 *  - **`lineIndexAt` is NOT a pass-through to `Text.lineAt`.** The string
 *    adapter resolves `offset === line.end + 1` to the line ABOVE, and
 *    `Text.lineAt` does not. The quirk is load-bearing (source-mode
 *    detection and the context menu observe it) and is reproduced here
 *    deliberately, not fixed. Fixing it is a separate work item.
 *  - **CR stripping matches `splitLines` byte-for-byte**, including its
 *    edge case: the FINAL line never loses a trailing `\r`. In the
 *    running app a `Text` comes from `EditorState.create` and never
 *    contains `\r` at all, so this matters only for `Text.of` documents —
 *    but an adapter that disagrees here disagrees under test, which is
 *    where the divergence would be found much later.
 *  - Methods live on the prototype (this is a class, not a closure bag)
 *    so two sources over equal input compare structurally equal.
 *
 * Retention: the line cache is per-`linesFromText` call and dies with it.
 * A full scan ends up holding one `LineRange` per line — the same
 * exposure `linesFromString` has always had — while a cursor probe holds
 * only the lines it touched. Nothing is memoised across calls: this code
 * runs per keystroke at a 10 MB document ceiling, and a module-level
 * cache here would retain every intermediate document state.
 *
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/scan.ts
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/lintTableColumnCount.ts
 */

import type { Text } from "@codemirror/state";
import type { TableLineSource } from "../../utils/tableParser/lines";
import type { LineRange } from "../../utils/tableParser/types";

class TextLineSource implements TableLineSource {
  readonly length: number;
  readonly lineCount: number;

  private readonly doc: Text;
  private readonly cache = new Map<number, LineRange>();
  /** Forward cursor over `doc.iterLines()`, created on first sequential use. */
  private iter: Iterator<string> | null = null;
  /** Index of the next line the iterator will yield. */
  private nextIndex = 0;
  /** Absolute start offset of that line. */
  private nextStart = 0;

  constructor(doc: Text) {
    this.doc = doc;
    this.length = doc.length;
    this.lineCount = doc.lines;
  }

  line(index: number): LineRange {
    const hit = this.cache.get(index);
    if (hit) return hit;
    // Start iterating only for a walk that begins at the top; a probe
    // lands mid-document and must not pay O(index) to reach itself.
    if (this.iter ? index >= this.nextIndex : index === 0) {
      return this.pullTo(index);
    }
    return this.randomLine(index);
  }

  lineIndexAt(offset: number): number {
    // `Text.lineAt` throws RangeError where the string adapter returns a
    // number, so every probe is bounded before it reaches the rope.
    if (!(offset >= 0)) return -1; // negatives and NaN
    if (offset > this.length) {
      // The last line's `end` IS `length`, so `end + 1 >= length + 1`
      // still holds and the string adapter resolves `length + 1` to it.
      // Out of range does not begin until `length + 2`.
      return offset === this.length + 1 ? this.lineCount - 1 : -1;
    }

    const index = this.doc.lineAt(offset).number - 1;
    // THE FUDGE. The string adapter returns the FIRST line whose
    // `end + 1 >= offset`, so an offset sitting on a line's trailing
    // newline belongs to the line ABOVE. Only the immediately preceding
    // line can qualify (line ends are strictly increasing), and the test
    // is `end + 1 >= offset` rather than `offset === line.from` because
    // under CRLF the newline is at `from - 1`, not at `from`.
    if (index > 0 && this.line(index - 1).end + 1 >= offset) return index - 1;
    return index;
  }

  iterLines(): Iterable<LineRange> {
    const self = this;
    return {
      *[Symbol.iterator](): Iterator<LineRange> {
        for (let i = 0; i < self.lineCount; i += 1) yield self.line(i);
      },
    };
  }

  slice(start: number, end: number): string {
    return this.doc.sliceString(start, end);
  }

  /** Advance the sequential cursor up to and including `index`. */
  private pullTo(index: number): LineRange {
    if (!this.iter) this.iter = this.doc.iterLines()[Symbol.iterator]();
    let found: LineRange | undefined;
    while (this.nextIndex <= index) {
      const step = this.iter.next();
      if (step.done === true) break;
      const built = this.rangeAt(this.nextIndex, this.nextStart, step.value);
      this.remember(this.nextIndex, built);
      // The line break occupies one offset even when the line's text
      // already gave up a `\r` to it — see `rangeAt`.
      this.nextStart += step.value.length + 1;
      this.nextIndex += 1;
      if (this.nextIndex - 1 === index) found = built;
    }
    if (found) return found;
    // The iterator ran dry before `index` (it cannot, for an in-range
    // index, on a real `Text`). Fall back rather than return undefined.
    return this.randomLine(index);
  }

  /** One rope lookup — `from` and `text` come from the same `Line`. */
  private randomLine(index: number): LineRange {
    const line = this.doc.line(index + 1);
    return this.remember(index, this.rangeAt(index, line.from, line.text));
  }

  /**
   * One line, in `splitLines` terms. `splitLines` strips a trailing `\r`
   * from every line it terminated with a `\n` and excludes it from the
   * line's `end` — but the FINAL line is not terminated, so it keeps its
   * `\r` and ends at `source.length`.
   */
  private rangeAt(index: number, start: number, raw: string): LineRange {
    const stripCr = index < this.lineCount - 1 && raw.endsWith("\r");
    const text = stripCr ? raw.slice(0, -1) : raw;
    return { start, end: start + text.length, text };
  }

  private remember(index: number, range: LineRange): LineRange {
    this.cache.set(index, range);
    return range;
  }
}

/**
 * Build a `TableLineSource` over a CodeMirror document.
 *
 * Observationally equivalent to `linesFromString(doc.toString())` for
 * every public result, at every offset — that equivalence is the whole
 * contract, and it is pinned document-by-document and offset-by-offset in
 * `tests/table-line-source-conformance.test.ts`.
 */
export function linesFromText(doc: Text): TableLineSource {
  return new TextLineSource(doc);
}
