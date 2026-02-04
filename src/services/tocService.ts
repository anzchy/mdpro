import { invoke } from "@tauri-apps/api/core";

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
  const lines = content.split("\n");
  const idCounts: Map<string, number> = new Map();

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Match ATX headings: # to ######
    const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#*)?$/);
    if (match) {
      const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = match[2].trim();
      const id = generateUniqueId(text, idCounts);

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

/**
 * Generate unique anchor ID from heading text
 * Handles duplicates with numeric suffix
 */
function generateUniqueId(text: string, counts: Map<string, number>): string {
  // Base ID: lowercase, replace non-alphanumeric with hyphens
  const baseId = text
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const count = counts.get(baseId) || 0;
  const id = count === 0 ? baseId : `${baseId}-${count}`;
  counts.set(baseId, count + 1);

  return id || "heading";
}
