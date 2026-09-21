/**
 * Purpose: answer "which line is offset N on?" for a whole document in one
 * forward pass, instead of one pass per question.
 *
 * @module src/utils/lineCounter
 * @coordinates-with src/services/tocService.ts — the only caller; asks once per
 *   heading, in document order.
 *
 * Why it exists: `parseHeadingsFromContent` used to compute each heading's line
 * as `countNewlines(forParse.slice(0, node.from))`. That allocates the entire
 * prefix and rescans it from the start for EVERY heading, so the cost is
 * document size × heading count. On `.perf-corpus/dense-math.source.md`
 * (9,961,596 B, 70,886 headings) that is roughly 3.5e11 character reads and
 * hundreds of GB of cumulative allocation — the measured 153-183 s Source-mode
 * stall recorded in docs/test/20260921-d6-matrix-retest.md §2 cell 7, whose
 * sampled stack top (`operationStringIndexOfWithIndexWithOneChar`, 13,117
 * samples) is JSC's fast path for the `indexOf("\n", i)` that loop was built
 * from.
 *
 * Key decisions:
 *
 * - **A cursor, not an index of newline positions.** An array of the 425,316
 *   newline offsets in that file would answer in O(log n) but costs O(n)
 *   memory and an allocation proportional to the document. The cursor is two
 *   integers and answers an ascending sweep in O(n) total, which is what the
 *   only caller needs.
 *
 * - **A backwards offset rewinds and rescans rather than throwing.** Lezer's
 *   `iterate` is pre-order over position-ordered children, so headings arrive
 *   ascending and the rewind should be unreachable. It is implemented because
 *   the alternative failure is silent: a stale cursor returns a plausible
 *   wrong line number, and nothing downstream can distinguish a wrong line
 *   from a right one. A caller that genuinely needs random access will see
 *   the quadratic return — that is a property of the access pattern, not a
 *   regression, and `scanned` is what makes it visible.
 *
 * - **`scanned` is exported for the tests.** The single-pass claim is the
 *   entire reason this module exists, and a counter makes it assertable by
 *   counting characters instead of by timing a run — E39/G0 forbid turning a
 *   millisecond number into a blocking gate, and a source-text "there is one
 *   loop" assertion (the compromise `tests/large-document-guard-call-site.test.ts`
 *   C12/C13 had to settle for) proves less. Pinned by S1.
 *
 * - **`\r` is an ordinary character.** A lone `\r` does not end a line, matching
 *   `src/services/tocService.ts`'s module header and the longest-line counter
 *   in `src/utils/largeDocumentGuard.ts` (ADR-0019). Pinned by S8 rather than
 *   left to agree by coincidence.
 */

/** A line resolver bound to one source string. */
export interface LineCounter {
  /**
   * The 1-based line number containing `offset`, counting `\n` only.
   * Equivalent to `source.slice(0, offset).split("\n").length`, with `offset`
   * clamped into `[0, source.length]`.
   */
  lineAt(offset: number): number;
  /**
   * Characters examined so far. Exists so the single-pass invariant can be
   * asserted rather than described; not read by production code.
   */
  readonly scanned: number;
}

const NEWLINE = 10;

/** Build a line resolver for `source`, cheapest when asked in ascending order. */
export function createLineCounter(source: string): LineCounter {
  // Characters strictly before `cursor` have been examined; `newlines` is how
  // many of them were `\n`.
  let cursor = 0;
  let newlines = 0;
  let scanned = 0;

  return {
    lineAt(offset: number): number {
      const target = offset < 0 ? 0 : offset > source.length ? source.length : offset;

      if (target < cursor) {
        cursor = 0;
        newlines = 0;
      }

      while (cursor < target) {
        if (source.charCodeAt(cursor) === NEWLINE) newlines++;
        cursor++;
        scanned++;
      }

      return newlines + 1;
    },
    get scanned() {
      return scanned;
    },
  };
}
