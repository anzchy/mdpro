/**
 * Purpose: the TOC face of heading identity — fetch headings from the Rust
 * backend, and parse them in the frontend when the backend is not available.
 *
 * Pipeline (`parseHeadingsFromContent`):
 *   content
 *     → `stripFrontmatter` (anchored prefix removal; the removed length is the
 *       rebasing offset, because Lezer sees the STRIPPED string only)
 *     → rewrite a Tab directly after the opening `#` run to a space, in a
 *       PARSE-ONLY copy (length-preserving, so no offset moves — see B19)
 *     → `markdownLanguage.parser.parse(forParse)` (@codemirror/lang-markdown)
 *     → walk `ATXHeading1-6` / `SetextHeading1-2`
 *     → text  = node range minus its direct `HeaderMark` children, normalized
 *     → offset = `node.from` + frontmatterLength  (already a UTF-16 index)
 *     → line   = `\n` count before `node.from`, + 1 + frontmatterLines
 *     → id     = a FRESH `createAnchorSlugAllocator()` per call
 *
 * Key decisions:
 *   - **Lezer, not a line regex, and not remark** (ADR-0012). The parser is the
 *     one `@codemirror/lang-markdown` already runs for Source-mode highlighting;
 *     it parses a plain string headlessly, so no `EditorState` and no DOM are
 *     involved. Gate G0 (no new dependency) therefore holds with no exception.
 *     This is what makes fenced `#` lines, setext headings and CRLF offsets
 *     correct — the five defects the shared corpus used to pin.
 *   - **Lines are derived by counting `\n` only.** A lone `\r` is deliberately
 *     NOT a line terminator, matching the `/\r?\n/` split this function used
 *     before the swap, so `"a\r# H"` stays one line (and therefore yields no
 *     heading) on both sides of the change. This rules out
 *     `Text.of(...).lineAt(...)` from `@codemirror/state`, which breaks on a
 *     lone `\r`. Pinned by `tests/toc-position-laws.test.ts` (L2) and
 *     `tests/toc-lezer-parser.test.ts` (B17).
 *   - **One grammar deviation is patched, not absorbed.** CommonMark §4.2 allows
 *     a Tab after the opening `#` run; the Lezer grammar (6.5.0) accepts only a
 *     space, while pulldown-cmark on the export side follows the spec. Left
 *     alone, `#\tTitle` would be anchored by the export and missing from the
 *     sidebar. The rewrite above is deliberately the narrowest fix that keeps
 *     the two faces agreeing. Residual, and known: a tab-opened heading nested
 *     in a blockquote or list item is still missed.
 *   - **Only `HeaderMark` is subtracted.** Inline markup (`LinkMark`, `URL`,
 *     `EmphasisMark`, `CodeMark`) stays in the text — ADR-0012 Consequences;
 *     stripping it is deferred successor work, pinned by `link-in-heading|toc`.
 *   - **No per-call logging.** `parseHeadingsFromContent` is a pure function on
 *     the editor's change path; a log line per parse would flood
 *     `~/.mdpro/mdpro.log` on every keystroke. Failures here surface as a wrong
 *     TOC, and are covered by the corpus rather than by a trail.
 *
 * @module services/tocService
 * @coordinates-with services/exportService (`stripFrontmatter`),
 *   utils/headingIdentity (the shared slug allocator), hooks/useTOC
 */
import { invoke } from "@tauri-apps/api/core";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { createAnchorSlugAllocator } from "../utils/headingIdentity";
import { createLineCounter } from "../utils/lineCounter";
import { stripFrontmatter } from "./exportService";

/**
 * Heading information returned from backend
 */
export interface HeadingInfo {
  /** Generated anchor ID (unique within document) */
  id: string;
  /** Heading level (1-6) */
  level: number;
  /** Heading text content (stripped of formatting) */
  text: string;
  /** Line number (1-indexed) */
  line: number;
  /** Character offset from document start */
  offset: number;
}

/**
 * Result from get_document_headings command
 */
interface GetDocumentHeadingsResult {
  headings: HeadingInfo[];
}

/**
 * Fetch all headings from a document
 * @param documentId - ID of the document to parse
 * @returns Array of heading information
 */
export async function getDocumentHeadings(
  documentId: string
): Promise<HeadingInfo[]> {
  const result = await invoke<GetDocumentHeadingsResult>(
    "get_document_headings",
    {
      document_id: documentId,
    }
  );
  return result.headings;
}

/**
 * The eight Lezer node names that are headings, mapped to their level.
 * `@lezer/markdown` also groups all eight under the node group `Heading`;
 * enumerating the names keeps the level mapping and the membership test in one
 * table instead of re-deriving the level from the name at each visit.
 */
const HEADING_LEVELS: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

/**
 * A Tab directly after the opening `#` run, at a CommonMark-legal indent.
 *
 * Capturing the marker and re-emitting it keeps the rewrite length-preserving,
 * which is what makes it safe to apply before parsing — see `forParse` below.
 */
const TAB_AFTER_HEADER_MARK = /^( {0,3}#{1,6})\t/gm;

/**
 * Normalize extracted heading text. FOUR ORDERED STEPS; two of the orderings
 * are load-bearing and are pinned by `tests/toc-lezer-parser.test.ts`:
 *
 *   (a) `\r\n` → `\n`        — MUST precede (b), or every CRLF line break in a
 *                              multi-line setext heading becomes a space (B6 row 5).
 *   (b) lone `\r` → a SPACE  — not a deletion: `slugBase` collapses
 *                              `[^\p{L}\p{N}]+` to `-`, so deleting turns `a\rb`
 *                              into the id `ab` while a space preserves `a-b`
 *                              (B17 row 3).
 *   (c) strip `^[ \t]*(?:>[ \t]?)*` on EVERY line after the first — a setext
 *       heading inside a blockquote or a list keeps its continuation markers in
 *       the node range, and they are interior, not just trailing (B11 row 6).
 *       Line 0 is spared: a `>` there is heading content (B18 row 2).
 *   (d) `trim()`             — after (c), so a continuation line that was only a
 *                              marker collapses away (B11 row 4).
 */
function normalizeHeadingText(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, " ").split("\n");
  for (let i = 1; i < lines.length; i++) {
    lines[i] = lines[i].replace(/^[ \t]*(?:>[ \t]?)*/, "");
  }
  return lines.join("\n").trim();
}

/**
 * Parse headings from Markdown content (frontend-only fallback).
 *
 * Walks the Lezer markdown tree that `@codemirror/lang-markdown` already ships
 * (ADR-0012) rather than matching lines with a regex, so fenced code, indented
 * code, tables, setext underlines and CRLF offsets are handled by the parser
 * instead of by hand. The signature and the `HeadingInfo` shape are unchanged.
 */
export function parseHeadingsFromContent(content: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const stripped = stripFrontmatter(content);
  // A FRESH allocator per call. Hoisting this to module scope would make two
  // successive parses of the same content disagree (the second returning `架构-1`
  // for a document whose only heading is `架构`) — tests/cjk-slug.test.ts:73 is the
  // guard for exactly that.
  const slugs = createAnchorSlugAllocator();

  // Lezer sees the STRIPPED string, so its offsets are relative to it. Rebase
  // onto the full file. `stripFrontmatter` is an anchored prefix replacement,
  // so the removed prefix is exactly `content.length - stripped.length`.
  const frontmatterLength = content.length - stripped.length;
  const frontmatterPrefix = content.slice(0, frontmatterLength);
  // `\n` only — see the line-terminator decision in the module header.
  const frontmatterLines = countNewlines(frontmatterPrefix);

  // CommonMark §4.2 lets the opening `#` run be followed by a space OR A TAB;
  // the Lezer grammar in @codemirror/lang-markdown 6.5.0 accepts only a space
  // and parses `#\tTitle` as a paragraph. pulldown-cmark on the export side
  // follows the spec, so leaving this alone would make the sidebar and the
  // exported anchors disagree — the exact class of divergence the shared
  // heading-identity corpus exists to prevent. Rewriting to a space is safe
  // because it is LENGTH-PRESERVING: every offset and line below is computed
  // against this copy and lands where the space form would put it (B19).
  // `{0,3}` not `*`: four spaces is an indented code block, not a heading.
  const forParse = stripped.replace(TAB_AFTER_HEADER_MARK, "$1 ");

  // ONE cursor for the whole document, not one prefix scan per heading. The
  // previous spelling — `countNewlines(forParse.slice(0, node.from))` inside
  // the callback — cost document size × heading count, which on
  // .perf-corpus/dense-math.source.md (9,961,596 B, 70,886 headings) is the
  // measured 153-183 s stall in docs/test/20260921-d6-matrix-retest.md §2
  // cell 7. Lezer visits headings in ascending `from`, so the cursor never
  // rewinds in practice; `src/utils/lineCounter.ts` handles it if it ever does.
  const lineCounter = createLineCounter(forParse);

  markdownLanguage.parser.parse(forParse).iterate({
    enter: (ref) => {
      const level = HEADING_LEVELS[ref.name];
      if (level === undefined) return true;

      const node = ref.node;
      // Text = the node's source range minus its DIRECT `HeaderMark` children
      // (the opening `#` run, a closing `#` run, and a setext underline).
      // Every other child — `QuoteMark`, `Link`, `InlineCode`, … — stays.
      const pieces: string[] = [];
      let cut = node.from;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name !== "HeaderMark") continue;
        if (child.from > cut) pieces.push(forParse.slice(cut, child.from));
        cut = Math.max(cut, child.to);
      }
      if (cut < node.to) pieces.push(forParse.slice(cut, node.to));

      const text = normalizeHeadingText(pieces.join(""));
      // The guard keys on the TEXT, never on the slug. `##`, `###  ` and `#`
      // are all real heading nodes with empty text and must yield nothing
      // (tests/markdown-editor-core.test.ts:45); `# 🎉` has non-empty text and
      // must survive with the fallback id `heading` (tests/cjk-slug.test.ts:53).
      if (text === "") return false;

      headings.push({
        id: slugs.allocate(text),
        level,
        text,
        line: lineCounter.lineAt(node.from) + frontmatterLines,
        offset: node.from + frontmatterLength,
      });
      // A heading cannot contain a heading; nothing below is of interest.
      return false;
    },
  });

  return headings;
}

/** `\n` occurrences. A lone `\r` is not a line terminator — module header. */
function countNewlines(source: string): number {
  let count = 0;
  for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) {
    count++;
  }
  return count;
}

/*
 * Anchor-slug generation used to live here as a private `generateUniqueId` with its
 * own `Map<string, number>` counter, kept in sync with the other faces BY HAND — a
 * doc comment asking the next reader to remember. It was not remembered: the counter
 * emitted a duplicate id whenever a later heading's literal text already slugged to
 * the suffix it had just handed out, and it registered the empty base BEFORE
 * substituting `"heading"`, so an emoji-only heading could emit the bare id `-1`.
 *
 * What is true now (WI-3.2):
 *   - The two TypeScript faces — this one and `generateHeadingId` in
 *     exportService.ts — SHARE ONE MODULE, `src/utils/headingIdentity.ts`. They
 *     cannot drift, because there is nothing left to keep in sync.
 *   - The third live face, `generate_heading_id` in
 *     `src-tauri/src/services/markdown.rs`, is a hand PORT of that module (the Rust
 *     renderer is not callable from jsdom, so sharing the code is not available).
 *     Its agreement is ENFORCED rather than asserted in prose, by the shared corpus
 *     `tests/render-fixtures/heading-identity.json` and its two runners
 *     (`tests/heading-identity-parity.test.ts`,
 *     `src-tauri/tests/heading_identity_parity.rs`), plus a cross-language digest
 *     over 200 generated documents (`tests/heading-identity-faces.test.ts`,
 *     `src-tauri/tests/heading_slug_generation.rs`).
 */
