/**
 * @module fenceRanges
 * Purpose: Pure source-side fenced-code detector (audit fix H3/H4).
 * Used by code paths that run OUTSIDE a CodeMirror EditorState —
 * `documentSave.saveActiveDocument`, `tableMcp.applyMcpTableAction`,
 * and the formatter's whole-document pass — to avoid rewriting
 * "table-shaped" lines that sit inside fenced code blocks.
 *
 * Inside a CodeMirror context, prefer `isPositionInFencedCode(state,
 * pos)` from `sourceTableDetection` — it consults CodeMirror's
 * markdown syntax tree, which is more accurate than this regex-based
 * scanner. This module exists for the (state-less) save and MCP paths.
 *
 * Recognizes ` ``` ` and `~~~` fences per CommonMark:
 * - Opener: up to 3 leading spaces, then 3+ backticks (or tildes),
 *   optional info string after. A backtick opener's info string must not
 *   contain a backtick; a tilde opener may contain one.
 * - Closer: same fence char, at least as many of them, only
 *   whitespace after on the line.
 * - Mismatched fence chars don't close (` ``` ` doesn't close `~~~`).
 * - Unclosed fences extend to end of source.
 *
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/utils/cursorSync/table.ts (consumes IsFenced)
 * @coordinates-with src/utils/tableFormatter.ts
 * @coordinates-with src/utils/tableMcp.ts
 * @coordinates-with src/hooks/useDocument.ts
 */

export interface FenceRange {
  /** Inclusive offset of the opening fence's first char. */
  start: number;
  /** Exclusive — first offset PAST the closing fence's trailing newline. */
  end: number;
}

const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})/;

/**
 * Walk the source line-by-line and return every fenced-code region in
 * document order. O(lines). Safe to run on whole documents at save time.
 */
export function findFencedRanges(source: string): FenceRange[] {
  const ranges: FenceRange[] = [];
  let lineStart = 0;
  let inFence = false;
  let fenceChar: "`" | "~" | null = null;
  let minClosingLen = 0;
  let rangeStart = 0;

  // Walk each line; preserve byte offsets so caller can intersect.
  let i = 0;
  while (i <= source.length) {
    const nl = source.indexOf("\n", i);
    const lineEnd = nl === -1 ? source.length : nl;
    const lineText = source.slice(i, lineEnd);
    const m = lineText.match(FENCE_OPEN_RE);

    if (
      !inFence &&
      m &&
      (m[2][0] === "~" || !lineText.slice(m[0].length).includes("`"))
    ) {
      // Opening fence.
      inFence = true;
      fenceChar = m[2][0] as "`" | "~";
      minClosingLen = m[2].length;
      rangeStart = i;
    } else if (inFence && m && m[2][0] === fenceChar && m[2].length >= minClosingLen) {
      // Candidate closer — must have nothing but whitespace after the fence run.
      const tail = lineText.slice(m[0].length);
      if (tail.trim() === "") {
        const closeEnd = nl === -1 ? lineEnd : lineEnd + 1; // include trailing \n
        ranges.push({ start: rangeStart, end: closeEnd });
        inFence = false;
        fenceChar = null;
        minClosingLen = 0;
      }
    }

    if (nl === -1) break;
    i = nl + 1;
    lineStart = i;
    void lineStart; // silence unused
  }

  // Unclosed fence — extend to EOF.
  if (inFence) {
    ranges.push({ start: rangeStart, end: source.length });
  }
  return ranges;
}

/**
 * Closure form for callers that need an `IsFenced` predicate
 * compatible with `findAllTables` / `formatAllTables`. The fence
 * scan runs ONCE; subsequent predicate calls are O(ranges).
 */
export function makeIsFenced(source: string): (offset: number) => boolean {
  const ranges = findFencedRanges(source);
  if (ranges.length === 0) return () => false;
  return (offset: number) => {
    for (const r of ranges) {
      if (offset >= r.start && offset < r.end) return true;
    }
    return false;
  };
}
