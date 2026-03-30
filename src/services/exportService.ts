import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { renderHighlightSyntaxInHtml } from "./highlightSyntax";
import { loggingService } from "./loggingService";

interface RenderMarkdownResult {
  html: string;
}

/**
 * Strip YAML frontmatter from the very start of a Markdown document.
 *
 * A frontmatter block is a `---` delimiter line (no trailing spaces) followed
 * by any content and closed by another `---` delimiter line, all at position 0
 * in the file.  Both Unix (`\n`) and Windows (`\r\n`) line endings are
 * supported for the delimiters.
 *
 * Documents without frontmatter are returned unchanged.
 */
export function stripFrontmatter(content: string): string {
  // Anchored: opening --- must be the very first characters.
  // Supports LF and CRLF on the delimiter lines; body may use either.
  // The body may be empty (---\n---\n) or contain any content.
  return content.replace(/^---\r?\n([\s\S]*?\n)?---\r?\n/, "");
}

interface ExportResult {
  success: boolean;
  path: string;
  htmlSize: number;
}

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_TAGS: ["mark", "u"], ADD_ATTR: ["data-heading-id"] });

/**
 * Generate unique anchor ID from heading text (must match tocService).
 *
 * Uses Unicode property escapes so CJK characters and other Unicode
 * letters/numbers are preserved in the slug. Emoji and punctuation are
 * replaced by hyphens. ASCII portions are lowercased.
 */
function generateHeadingId(text: string, counts: Map<string, number>): string {
  const baseId = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  const count = counts.get(baseId) || 0;
  const id = count === 0 ? baseId : `${baseId}-${count}`;
  counts.set(baseId, count + 1);

  return id || "heading";
}

/**
 * Create a new marked instance with heading IDs
 */
function createMarkedParser(): (markdown: string) => string {
  const markedInstance = new Marked();
  const idCounts = new Map<string, number>();

  markedInstance.use({
    renderer: {
      heading(text: string, level: number): string {
        const id = generateHeadingId(text, idCounts);
        return `<h${level} id="${id}" data-heading-id="${id}">${text}</h${level}>\n`;
      }
    }
  });

  return (markdown: string) => {
    idCounts.clear(); // Reset for each parse
    return markedInstance.parse(markdown, { gfm: true }) as string;
  };
}

const parseMarkdownWithHeadingIds = createMarkedParser();

export const exportService = {
  async renderMarkdown(markdown: string): Promise<string> {
    const stripped = stripFrontmatter(markdown);
    try {
      const result = await invoke<RenderMarkdownResult>("render_markdown", { content: stripped });
      return renderHighlightSyntaxInHtml(sanitize(result.html));
    } catch (err) {
      loggingService.logEventSync({
        level: "warn",
        event: "export.render_markdown.fallback",
        status: "fail",
        context: { error: err instanceof Error ? err.message : String(err) },
      });
      const html = parseMarkdownWithHeadingIds(stripped);
      return renderHighlightSyntaxInHtml(sanitize(html));
    }
  },

  async exportHtml(
    content: string,
    title: string,
    theme: "light" | "dark",
  ): Promise<ExportResult> {
    return invoke("export_html", { content, title, theme });
  },

  async previewHtml(content: string, theme: "light" | "dark"): Promise<string> {
    return invoke("preview_html", { content, theme });
  },

  /** Opens a native folder picker and returns the selected path, or null if cancelled. */
  async pickFolder(): Promise<string | null> {
    return invoke<string | null>("pick_export_folder");
  },
};
