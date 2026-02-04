import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { Marked } from "marked";

interface RenderMarkdownResult {
  html: string;
}

interface ExportResult {
  success: boolean;
  path: string;
  htmlSize: number;
}

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_TAGS: ["mark", "u"], ADD_ATTR: ["data-heading-id"] });

/**
 * Generate unique anchor ID from heading text (must match tocService)
 */
function generateHeadingId(text: string, counts: Map<string, number>): string {
  const baseId = text
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
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
    try {
      const result = await invoke<RenderMarkdownResult>("render_markdown", { content: markdown });
      return sanitize(result.html);
    } catch {
      const html = parseMarkdownWithHeadingIds(markdown);
      return sanitize(html);
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
};
