/**
 * @module emptyParagraph/blankLineGaps
 * Purpose: The WYSIWYG reader half of ADR-0091 (D188). A remark transformer that
 * turns runs of blank lines between blocks into empty paragraphs, and reads a
 * legacy `<br />`-only paragraph (written by mdpro before D188) as an empty one.
 *
 * Pipeline: Milkdown's parser calls `remark.runSync(remark.parse(md), md)`, so every
 * transformer receives the source as `file.value` (the same route preset-commonmark's
 * own `remarkMarker` reads). This plugin replaces the preset's
 * `remarkPreserveEmptyLinePlugin` at the same place in the plugin order, so it runs
 * after the ADR-0094 link-definition transformer (definitions are kept, with their
 * positions) and after `remarkHTMLTransformer` (block html already sits inside a
 * paragraph).
 *
 * Key decisions:
 *   - A NEW `$remark` id. The preset's paragraph writer (`shouldPreserveEmptyLine`)
 *     writes `<br />` for an empty paragraph whenever the preset plugin's id is in
 *     ctx; reusing that id would bring the `<br />` writer back.
 *   - Gaps: for each pair of positioned siblings in `root`, `blockquote` and
 *     `listItem`, `b` blank LINES between them (CRLF and whitespace-only lines count
 *     as one each; `>`-only lines count inside a quote) become floor((b−1)/2) empty
 *     paragraphs. An odd leftover is ignored. The whole source interval between the
 *     two siblings must be blank. A kept link definition (ADR-0094) is an ordinary
 *     positioned sibling, so blank lines next to it count (matrix B7, B7b, D194 R13).
 *   - Leading and trailing blank lines in a container are never counted: only pairs.
 *   - `<br>` handling is D192's narrow reader, copied from the retired pnpm patch
 *     (a backport of `visitEmptyLine` in @milkdown/preset-commonmark 7.22.3): a
 *     `<br>`-only paragraph or table cell becomes an empty placeholder, a block-level
 *     br becomes an empty paragraph, an inline br is left alone. Case-insensitive.
 *
 * @coordinates-with src/plugins/milkdown/emptyParagraph/edgeSerializer.ts — the writer half
 * @coordinates-with src/plugins/milkdown/commonmarkPreset.ts — swaps this into the preset
 */
import { $remark } from "@milkdown/kit/utils";

/** The mdast shape this transformer touches; positions are unist offsets. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** D192 / upstream 7.22.3: a whole html value that is one `<br>` tag, any case. */
const BR_PATTERN = /^<br\s*\/?\s*>$/i;
const PLACEHOLDER_PARENTS = new Set(["paragraph", "tableCell"]);
const BR_BLOCK_CONTAINERS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);
/** Containers whose sibling gaps carry empty paragraphs (ADR-0091 Decision 2). */
const GAP_CONTAINERS = new Set(["root", "blockquote", "listItem"]);
const LINE_BREAK = /\r\n|\r|\n/;
const BLANK = /^[ \t]*$/;
const BLANK_IN_QUOTE = /^[ \t>]*$/;

const isBrHtml = (node: MdNode): boolean =>
  node.type === "html" && typeof node.value === "string" && BR_PATTERN.test(node.value.trim());

/**
 * Blank lines in the source between two siblings, or -1 when anything in the
 * interval is not blank. `interval` runs from the end of the first sibling to the
 * start of the second, so its first and last pieces are partial lines.
 */
export function countBlankLines(interval: string, inQuote: boolean): number {
  const pieces = interval.split(LINE_BREAK);
  const blank = inQuote ? BLANK_IN_QUOTE : BLANK;
  if (!pieces.every((line) => blank.test(line))) return -1;
  return pieces.length - 2;
}

/** ADR-0091: b blank lines carry floor((b−1)/2) empty paragraphs. */
export function emptyParagraphsFor(blankLines: number): number {
  return blankLines < 1 ? 0 : Math.floor((blankLines - 1) / 2);
}

function offsets(node: MdNode): { start: number; end: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? { start, end } : null;
}

/** D192's narrow `<br>` reader for one parent's direct children. */
function readLegacyBr(parent: MdNode): void {
  const kids = parent.children;
  if (!kids) return;
  for (const child of kids) {
    if (!isBrHtml(child)) continue;
    if (PLACEHOLDER_PARENTS.has(parent.type)) {
      if (kids.length === 1) parent.children = [];
      return;
    }
    if (BR_BLOCK_CONTAINERS.has(parent.type)) {
      child.type = "paragraph";
      child.children = [];
      delete child.value;
    }
  }
}

/** Insert the empty paragraphs each blank-line gap between siblings carries. */
function insertGaps(parent: MdNode, source: string, inQuote: boolean): void {
  const kids = parent.children;
  if (!kids || kids.length < 2) return;
  const out: MdNode[] = [kids[0]];
  for (let i = 1; i < kids.length; i += 1) {
    const prev = offsets(kids[i - 1]);
    const next = offsets(kids[i]);
    if (prev && next && next.start >= prev.end) {
      const n = emptyParagraphsFor(countBlankLines(source.slice(prev.end, next.start), inQuote));
      for (let k = 0; k < n; k += 1) out.push({ type: "paragraph", children: [] });
    }
    out.push(kids[i]);
  }
  parent.children = out;
}

function walk(node: MdNode, source: string | null, inQuote: boolean): void {
  const kids = node.children;
  if (!kids) return;
  const quoted = inQuote || node.type === "blockquote";
  for (const child of kids) walk(child, source, quoted);
  // Gaps first: they read the positions of the original siblings only.
  if (source !== null && GAP_CONTAINERS.has(node.type)) insertGaps(node, source, quoted);
  readLegacyBr(node);
}

/** Run the reader on an mdast tree parsed from `source` (null: `<br>` handling only). */
export function applyBlankLineGaps(tree: MdNode, source: string | null): void {
  walk(tree, source, false);
}

/** The `$remark` plugin, under its own id (see Key decisions). */
export const remarkBlankLineGapsPlugin = $remark(
  "mdpro-blank-line-gaps",
  () => () => (tree: unknown, file: { value?: unknown } | undefined) => {
    const value = file?.value;
    const source =
      typeof value === "string" ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : null;
    applyBlankLineGaps(tree as MdNode, source);
  },
);
