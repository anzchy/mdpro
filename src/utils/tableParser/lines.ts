/**
 * @module tableParser/lines
 * Purpose: Line-level substrate for the GFM table parser (Phase 4 WI-2).
 * Owns document splitting, offset -> line resolution, and the two
 * line-level predicates, so `parse.ts` can work against an already-split
 * document instead of re-deriving one. Extracted from `parse.ts` under
 * rule 50 §6 (file size).
 *
 * Pipeline: `source` -> `splitLines` -> `LineRange[]` -> `linesFromString`
 * -> `TableLineSource` -> `parse.ts#parseTableAtLine`.
 *
 * Key decisions:
 *  - `splitLines` is driven by `indexOf("\n")`, not a per-character
 *    `source[i]` loop. The loop it replaces allocated a JSString per
 *    non-Latin-1 code point under JavaScriptCore. CR-stripping is
 *    preserved byte-for-byte.
 *  - `lineIndexAt` is a binary search that reproduces the previous
 *    linear scan's boundary fudge EXACTLY: an offset equal to
 *    `lines[i].end + 1` resolves to line `i`, not `i + 1`. The quirk is
 *    load-bearing (source-mode detection and the context menu observe
 *    it) and is preserved, not fixed. Fixing it is a separate work item.
 *  - `linesFromString` is pure and non-retaining: no module-level memo,
 *    no one-slot cache. It sits on a path that runs per keystroke and
 *    per cursor move at a 10 MB document ceiling, so a cache here would
 *    retain every intermediate document state.
 *
 * @coordinates-with src/utils/tableParser/commonmark.ts
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/cursorSync/table.ts
 */

import { countIndentColumns } from "./commonmark";
import { MAX_INDENT, type LineRange } from "./types";

/**
 * A split document the parser can walk without owning a string.
 *
 * The string adapter is `linesFromString`. A `Text`-backed adapter for
 * CodeMirror is a later work item; everything the parser needs is
 * behind this interface so that adapter costs nothing in `parse.ts`.
 */
export interface TableLineSource {
  /** Total length of the underlying document, in UTF-16 code units. */
  readonly length: number;
  /** Number of lines, always >= 1. */
  readonly lineCount: number;
  /** The line at `index`. Callers must pass `0 <= index < lineCount`. */
  line(index: number): LineRange;
  /** Index of the line containing `offset`, or -1 when out of range. */
  lineIndexAt(offset: number): number;
  /** Every line, in document order. */
  iterLines(): Iterable<LineRange>;
  /**
   * The underlying text between two absolute offsets. Needed for
   * `TableModel.raw`; a `Text` adapter implements it with `doc.sliceString`.
   */
  slice(start: number, end: number): string;
}

/**
 * Split `source` into line ranges with absolute offsets.
 *
 * Boundaries come from `indexOf("\n")`; there is deliberately no
 * `source[i]` indexing loop. CR-stripping is byte-for-byte what the
 * previous character loop produced:
 *
 *     end = (nl > start && src[nl - 1] === "\r") ? nl - 1 : nl
 *
 * and the NEXT line's `start` is `nl + 1`, not `nl` — the CR is excluded
 * from the line's text but still occupies a source offset.
 *
 * Always returns at least one entry: a trailing `\n` yields a final
 * empty line, matching `source.split("\n").length`.
 */
export function splitLines(source: string): LineRange[] {
  const out: LineRange[] = [];
  let start = 0;
  let nl = source.indexOf("\n");
  while (nl !== -1) {
    // Strip CR if present (CRLF line endings).
    const end = nl > start && source[nl - 1] === "\r" ? nl - 1 : nl;
    out.push({ start, end, text: source.slice(start, end) });
    start = nl + 1;
    nl = source.indexOf("\n", start);
  }
  out.push({ start, end: source.length, text: source.slice(start) });
  return out;
}

/**
 * Index of the line containing `offset`, by binary search — O(log L).
 *
 * Reproduces the previous linear scan exactly, including its boundary
 * fudge: the scan returned the FIRST `i` with
 * `offset >= lines[i].start && offset <= lines[i].end + 1`, so an offset
 * sitting on a line's trailing newline resolves to the line ABOVE it.
 *
 * `start` and `end` are both strictly increasing across lines, so the
 * set `{ i : lines[i].start <= offset }` is a prefix and the set
 * `{ i : lines[i].end + 1 >= offset }` is a suffix. The answer is the
 * first element of the suffix, provided it is still inside the prefix.
 */
export function lineIndexAt(
  lines: readonly LineRange[],
  offset: number,
): number {
  const n = lines.length;
  if (n === 0) return -1;

  // last index whose start <= offset
  let lo = 0;
  let hi = n - 1;
  let lastStarted = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= offset) {
      lastStarted = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (lastStarted < 0) return -1;

  // first index whose end + 1 >= offset
  lo = 0;
  hi = n - 1;
  let firstReaching = n;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].end + 1 >= offset) {
      firstReaching = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return firstReaching <= lastStarted ? firstReaching : -1;
}

/**
 * String-backed `TableLineSource`.
 *
 * Methods live on the prototype rather than as closures on the instance
 * so that two sources over equal input are structurally equal — which
 * is what lets `LINES-nocache` assert "distinct objects, equal data"
 * without reaching into private state.
 */
class StringLineSource implements TableLineSource {
  readonly length: number;
  private readonly source: string;
  private readonly lines: LineRange[];

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
    this.lines = splitLines(source);
  }

  get lineCount(): number {
    return this.lines.length;
  }

  line(index: number): LineRange {
    return this.lines[index];
  }

  lineIndexAt(offset: number): number {
    return lineIndexAt(this.lines, offset);
  }

  iterLines(): Iterable<LineRange> {
    return this.lines;
  }

  slice(start: number, end: number): string {
    return this.source.slice(start, end);
  }
}

/**
 * Build a `TableLineSource` over `source`.
 *
 * Pure and non-retaining — see the module header. Two calls on equal
 * input return structurally equal but DISTINCT object graphs, and
 * nothing reachable from this module outlives the call.
 */
export function linesFromString(source: string): TableLineSource {
  return new StringLineSource(source);
}

/**
 * A line is a table candidate if it:
 *  - has up to 3 COLUMNS of indent (4+ is a code block in CommonMark;
 *    a tab advances to the next multiple of 4, so one leading tab is
 *    already over the limit — WI-C2)
 *  - contains at least one unescaped `|`
 *  - is not blank
 *
 * Note this still DISAGREES with `isDelimiterLine` on one shape: `---`
 * and `:-:` (no pipe) are accepted there and rejected here. That residual
 * disagreement is the mechanism behind a table whose line span exceeds
 * its candidate run. The INDENT half of that disagreement is gone as of
 * WI-C2 — both predicates now measure indentation the same way, in
 * columns — and the pipe-less half is narrowed by the setext rule in
 * `parse.ts`, which rejects the `-`-only spelling outright.
 */
export function isTableCandidateLine(line: LineRange): boolean {
  const text = line.text.replace(/\r$/, "");
  if (text.trim().length === 0) return false;
  const indent = countIndentColumns(text);
  if (indent > MAX_INDENT) return false;
  return hasUnescapedPipe(text);
}

/** True when `s` contains a `|` that is not preceded by an escape. */
export function hasUnescapedPipe(s: string): boolean {
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") return true;
  }
  return false;
}

/**
 * True when `line` is a GFM delimiter row.
 *
 * Indentation is checked BEFORE the trim (WI-C2). It has to be: `.trim()`
 * eats tabs as well as spaces, so measuring afterwards reports zero indent
 * for every line and a 4+-column delimiter escapes the `MAX_INDENT` rule
 * its neighbours obey. In CommonMark that line is an indented code block
 * or a paragraph continuation, never a delimiter row.
 */
export function isDelimiterLine(line: LineRange): boolean {
  const raw = line.text.replace(/\r$/, "");
  if (countIndentColumns(raw) > MAX_INDENT) return false;
  const text = raw.trim();
  if (!text) return false;
  // After splitting and dropping empty edge segments, every cell must
  // match `:?-+:?` (with optional surrounding whitespace).
  const cells = splitCellTexts(text);
  if (cells.length === 0) return false;
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

/**
 * Split a row line into cell text segments, respecting `\|` escapes
 * and dropping the empty segments that appear at the edges when the
 * line begins / ends with `|`.
 */
export function splitCellTexts(line: string): string[] {
  const text = line.replace(/\r$/, "");
  // Strip leading indent (callers only reach here with <= 3 columns of
  // indent, which cannot contain a tab, so <= 3 spaces).
  const trimmed = text.replace(/^ {0,3}/, "");

  const segments: string[] = [];
  let buf = "";
  let escaped = false;
  for (const ch of trimmed) {
    if (escaped) {
      buf += "\\" + ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      segments.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (escaped) buf += "\\";
  segments.push(buf);

  // Drop empty edges (the optional `|` at start/end).
  if (segments.length > 0 && segments[0].trim() === "") segments.shift();
  if (segments.length > 0 && segments[segments.length - 1].trim() === "") segments.pop();
  return segments;
}
