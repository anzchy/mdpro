/**
 * Purpose: the pure model behind WI-8 — the scroll position survives a
 * Source ⇄ WYSIWYG switch. The anchor is the TOP VISIBLE LINE (the 40px spy
 * probe), expressed in coordinates both editors can resolve.
 *
 * Pipeline:
 *   Source side:  content → one Lezer GFM parse → { blocks, headingLines }
 *                 top line → anchor (block tier + heading tier)
 *   WYSIWYG side: top-level PM child rects / heading rects → anchor
 *   Restore:      block tier if the block counts agree, else heading tier if
 *                 the heading counts agree, else DROP (the view opens at the
 *                 top — today's behaviour, never a wrong position).
 *
 * Key decisions:
 *   - **Block tier = top-level blocks, 1:1.** Milkdown's top-level PM children
 *     and the Lezer GFM top-level blocks correspond in CommonMark/GFM; the
 *     drift detector is `tests/scroll-anchor-correspondence.test.ts`. The parser
 *     is `markdownLanguage` (GFM, as tocService uses — ADR-0012), NOT the live
 *     CodeMirror tree (commonmark only: a table interrupting a paragraph would
 *     count as one block there and two in Milkdown).
 *   - **One measured skip rule**: a `LinkReference` block is skipped
 *     (remark-inline-links deletes definitions) UNLESS it is a footnote
 *     definition `[^x]:`, which remark-gfm keeps as `footnote_definition`.
 *     Top-level `<br>` HTML blocks are NOT skipped — measured: they survive as
 *     empty paragraphs.
 *   - **Frontmatter is not stripped**: Milkdown has no frontmatter plugin and
 *     renders it as hr + setext h2, so both sides count it.
 *   - **The heading tier never degenerates into a whole-document ratio**: with
 *     zero headings there is no heading tier (the c285c8c ratio stays dead).
 *   - **One-shot slot keyed by documentId, cleared on read** — the WI-2.6
 *     table-cell pattern (`cursorSync/table.ts`). No store field, no per-tab
 *     persistence.
 *   - No logging here: pure functions; the adapters log once per switch.
 *
 * @module src/utils/scrollAnchor/anchor
 * @coordinates-with src/utils/scrollAnchor/source.ts, milkdown.ts, capture.ts
 * @coordinates-with src/hooks/useMilkdownScrollRestore.ts
 */
import { markdownLanguage } from "@codemirror/lang-markdown";

/** A top-level source block; 1-based lines, inclusive on both ends. */
export interface SourceBlock {
  startLine: number;
  endLine: number;
}

/** Everything the source side needs; `blocks: null` = block tier unavailable. */
export interface SourceModel {
  lineCount: number;
  blocks: SourceBlock[] | null;
  headingLines: number[];
}

export interface BlockAnchor {
  blockIndex: number;
  /** Position inside the block, 0 ≤ fraction ≤ 1. */
  fraction: number;
  blockCount: number;
}

export interface HeadingAnchor {
  /** Index of the section's heading; -1 = the region above the first heading. */
  headingOrdinal: number;
  fraction: number;
  headingCount: number;
}

/** Both tiers are captured together so the restore can fall back. */
export interface ScrollAnchor {
  documentId: string;
  block: BlockAnchor | null;
  heading: HeadingAnchor | null;
}

export interface VerticalSpan {
  top: number;
  height: number;
}

export type AnchorTier = "block" | "heading";

const HEADING_NODES = new Set([
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5",
  "ATXHeading6", "SetextHeading1", "SetextHeading2",
]);

/** Same length-preserving rewrite tocService applies (Lezer rejects `#\t`). */
const TAB_AFTER_HEADER_MARK = /^( {0,3}#{1,6})\t/gm;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Line starts by `\n` only, so CRLF and LF count the same lines. */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = content.indexOf("\n"); i !== -1; i = content.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** One parse → blocks and heading lines. */
export function buildSourceModel(content: string): SourceModel {
  const starts = lineStarts(content);
  const forParse = content.replace(TAB_AFTER_HEADER_MARK, "$1 ");
  const tree = markdownLanguage.parser.parse(forParse);
  const blocks: SourceBlock[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "LinkReference" && !content.startsWith("[^", node.from)) continue;
    blocks.push({
      startLine: lineOf(starts, node.from),
      endLine: lineOf(starts, Math.max(node.from, node.to - 1)),
    });
  }
  const headingLines: number[] = [];
  tree.iterate({
    enter: (node) => {
      if (!HEADING_NODES.has(node.name)) return undefined;
      headingLines.push(lineOf(starts, node.from));
      return false;
    },
  });
  return { lineCount: starts.length, blocks, headingLines };
}

export function enumerateSourceBlocks(content: string): SourceBlock[] {
  return buildSourceModel(content).blocks ?? [];
}

export function enumerateSourceHeadings(content: string): number[] {
  return buildSourceModel(content).headingLines;
}

function blockAnchorFromLine(blocks: SourceBlock[], line: number): BlockAnchor | null {
  if (blocks.length === 0) return null;
  const blockCount = blocks.length;
  // First block that ends at or after the line: the containing block, or — for
  // a blank line in a gap — the NEXT block, entered at its top.
  const index = blocks.findIndex((block) => block.endLine >= line);
  if (index === -1) {
    const last = blocks[blockCount - 1];
    const span = last.endLine - last.startLine + 1;
    return { blockIndex: blockCount - 1, fraction: (span - 1) / span, blockCount };
  }
  const block = blocks[index];
  if (line < block.startLine) return { blockIndex: index, fraction: 0, blockCount };
  const span = block.endLine - block.startLine + 1;
  return { blockIndex: index, fraction: (line - block.startLine) / span, blockCount };
}

/** `[start, end)` line range of heading section `ordinal`. */
function sectionLines(headingLines: number[], ordinal: number, lineCount: number) {
  const start = ordinal === -1 ? 1 : headingLines[ordinal];
  const end = ordinal + 1 < headingLines.length ? headingLines[ordinal + 1] : lineCount + 1;
  return { start, end: Math.max(end, start + 1) };
}

function headingAnchorFromLine(
  headingLines: number[],
  line: number,
  lineCount: number,
): HeadingAnchor | null {
  const headingCount = headingLines.length;
  if (headingCount === 0) return null;
  let ordinal = -1;
  while (ordinal + 1 < headingCount && headingLines[ordinal + 1] <= line) ordinal++;
  const { start, end } = sectionLines(headingLines, ordinal, lineCount);
  return { headingOrdinal: ordinal, fraction: clamp((line - start) / (end - start), 0, 1), headingCount };
}

/** The top line of a Source view → an anchor, or null when neither tier exists. */
export function anchorFromSourceLine(
  model: SourceModel,
  line: number,
  documentId: string,
): ScrollAnchor | null {
  const topLine = clamp(line, 1, model.lineCount);
  const block = model.blocks ? blockAnchorFromLine(model.blocks, topLine) : null;
  const heading = headingAnchorFromLine(model.headingLines, topLine, model.lineCount);
  if (!block && !heading) return null;
  return { documentId, block, heading };
}

/** An anchor → the line to put at the probe, or null (drop) on count mismatch. */
export function sourceLineFromAnchor(
  model: SourceModel,
  anchor: ScrollAnchor,
): { line: number; tier: AnchorTier } | null {
  const { blocks, headingLines, lineCount } = model;
  if (anchor.block && blocks && anchor.block.blockCount === blocks.length) {
    const block = blocks[anchor.block.blockIndex];
    if (block) {
      const span = block.endLine - block.startLine + 1;
      const offset = Math.round(anchor.block.fraction * span);
      return { line: clamp(block.startLine + offset, block.startLine, block.endLine), tier: "block" };
    }
  }
  const heading = anchor.heading;
  if (heading && heading.headingCount === headingLines.length && headingLines.length > 0) {
    const { start, end } = sectionLines(headingLines, heading.headingOrdinal, lineCount);
    const line = start + Math.round(heading.fraction * (end - start));
    return { line: clamp(clamp(line, start, end - 1), 1, lineCount), tier: "heading" };
  }
  return null;
}

/** Pixel side: the probe's position inside a top-level block. */
export function anchorFromBlockGeometry(
  blockIndex: number,
  blockCount: number,
  span: VerticalSpan,
  probeY: number,
): BlockAnchor {
  const fraction = span.height > 0 ? clamp((probeY - span.top) / span.height, 0, 1) : 0;
  return { blockIndex, fraction, blockCount };
}

export function pixelOffsetFromAnchor(fraction: number, span: VerticalSpan): number {
  return span.top + fraction * span.height;
}

/** `[start, end)` pixel range of heading section `ordinal`. */
function sectionPixels(tops: number[], ordinal: number, docTop: number, docBottom: number) {
  const start = ordinal === -1 ? docTop : tops[ordinal];
  const end = ordinal + 1 < tops.length ? tops[ordinal + 1] : docBottom;
  return { start, end };
}

/** Pixel side, heading tier. `tops` are heading tops in document order. */
export function headingAnchorFromGeometry(
  tops: number[],
  docTop: number,
  docBottom: number,
  probeY: number,
): HeadingAnchor | null {
  if (tops.length === 0) return null;
  let ordinal = -1;
  while (ordinal + 1 < tops.length && tops[ordinal + 1] <= probeY) ordinal++;
  const { start, end } = sectionPixels(tops, ordinal, docTop, docBottom);
  const fraction = end > start ? clamp((probeY - start) / (end - start), 0, 1) : 0;
  return { headingOrdinal: ordinal, fraction, headingCount: tops.length };
}

export function pixelOffsetFromHeadingAnchor(
  anchor: HeadingAnchor,
  tops: number[],
  docTop: number,
  docBottom: number,
): number | null {
  if (tops.length === 0 || anchor.headingCount !== tops.length) return null;
  const { start, end } = sectionPixels(tops, anchor.headingOrdinal, docTop, docBottom);
  return start + anchor.fraction * Math.max(end - start, 0);
}

// ---------------------------------------------------------------------------
// One-shot slot (one writer: capture.ts; readers: the inbound editor's restore)
// ---------------------------------------------------------------------------

let pendingAnchor: ScrollAnchor | null = null;

/** Set or clear the pending anchor. `capture.ts` always writes, null included. */
export function setPendingScrollAnchor(value: ScrollAnchor | null): void {
  pendingAnchor = value;
}

/** Read without consuming — diagnostics and tests. */
export function getPendingScrollAnchor(): ScrollAnchor | null {
  return pendingAnchor;
}

/**
 * Read and clear. Returns null — and still clears — when the slot is empty or
 * belongs to another document, so a stale capture never survives a doc switch.
 * Unlike the table slot, a null `forDocumentId` never matches.
 */
export function consumePendingScrollAnchor(forDocumentId: string | null): ScrollAnchor | null {
  const value = pendingAnchor;
  pendingAnchor = null;
  if (!value || forDocumentId === null || value.documentId !== forDocumentId) return null;
  return value;
}
