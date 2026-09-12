import { invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import { applyImageWidthMarkerToHtml } from "../plugins/milkdown/imageResizePlugin";
import { renderHighlightSyntaxInHtml } from "./highlightSyntax";
import { loggingService } from "./loggingService";
import { prerenderMathForExport } from "./mathRender";
import { sanitizeRenderedHtml } from "./sanitizerPolicy";

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

// Shared WI-0.1 allow-list policy (math/footnote/mermaid-aware), mirroring the
// Rust `sanitize_html`. See src/services/sanitizerPolicy.ts.
const sanitize = sanitizeRenderedHtml;

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
      return applyImageWidthMarkerToHtml(renderHighlightSyntaxInHtml(sanitize(result.html)));
    } catch (err) {
      // ACCEPTED DEGRADATION (plan decision A1, audit finding B2): this `marked`
      // fallback runs ONLY when the canonical Rust `render_markdown` IPC throws.
      // It renders neither math (`$…$` / `$$…$$`) nor footnotes (`[^1]`) — marked
      // has no math/footnote support wired here — so a document exported via this
      // path loses both. The Rust path is the supported export route; this is a
      // last-resort plain-Markdown render so export never hard-fails. The gap is
      // pinned by tests/export-fallback-degradation.test.ts so it stays reviewed.
      loggingService.logEventSync({
        level: "warn",
        event: "export.render_markdown.fallback",
        status: "fail",
        context: { error: err instanceof Error ? err.message : String(err) },
      });
      const html = parseMarkdownWithHeadingIds(stripped);
      return applyImageWidthMarkerToHtml(renderHighlightSyntaxInHtml(sanitize(html)));
    }
  },

  async exportHtml(
    content: string,
    title: string,
    theme: "light" | "dark",
  ): Promise<ExportResult> {
    return invoke("export_html", { content, title, theme });
  },

  /**
   * Export with math pre-rendered (WI-1.1). Renders markdown to sanitized HTML,
   * typesets KaTeX in a detached DOM, then hands the static body to Rust, which
   * re-sanitizes, inlines KaTeX CSS, and writes. The exported file renders math
   * with zero JS. Falls back to {@link exportHtml} only fails closed — callers
   * use this for documents that may contain math.
   */
  async exportRenderedHtml(
    content: string,
    title: string,
    theme: "light" | "dark",
  ): Promise<ExportResult> {
    const body = await this.renderMarkdown(content);
    const bodyHtml = prerenderMathForExport(body);
    return invoke("export_rendered_html", { bodyHtml, title, theme });
  },

  async previewHtml(content: string, theme: "light" | "dark"): Promise<string> {
    return invoke("preview_html", { content, theme });
  },

  /** Opens a native folder picker and returns the selected path, or null if cancelled. */
  async pickFolder(): Promise<string | null> {
    return invoke<string | null>("pick_export_folder");
  },
};
