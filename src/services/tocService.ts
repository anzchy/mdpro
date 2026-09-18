import { invoke } from "@tauri-apps/api/core";
import { createAnchorSlugAllocator } from "../utils/headingIdentity";
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
 * Parse headings from Markdown content (frontend-only fallback)
 * Uses regex to extract headings when backend is not available
 */
export function parseHeadingsFromContent(content: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const stripped = stripFrontmatter(content);
  const lines = stripped.split(/\r?\n/);
  // A FRESH allocator per call. Hoisting this to module scope would make two
  // successive parses of the same content disagree (the second returning `架构-1`
  // for a document whose only heading is `架构`) — tests/cjk-slug.test.ts:73 is the
  // guard for exactly that.
  const slugs = createAnchorSlugAllocator();

  // Compute character offset of stripped content within the original document
  // so that line/offset values are relative to the full file, not the stripped copy.
  const frontmatterLength = content.length - stripped.length;
  const frontmatterLines = content.length === stripped.length
    ? 0
    : content.slice(0, frontmatterLength).split(/\r?\n/).length - 1;
  let offset = frontmatterLength;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1 + frontmatterLines;

    // Match ATX headings: # to ######
    const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#*)?$/);
    if (match) {
      const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = match[2].trim();
      if (!text) {
        offset += line.length + 1;
        continue;
      }
      const id = slugs.allocate(text);

      headings.push({
        id,
        level,
        text,
        line: lineNumber,
        offset,
      });
    }

    offset += line.length + 1; // +1 for newline
  }

  return headings;
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
