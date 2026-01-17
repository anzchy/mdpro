import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface RenderMarkdownResult {
  html: string;
}

interface ExportResult {
  success: boolean;
  path: string;
  htmlSize: number;
}

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_TAGS: ["mark", "u"] });

export const exportService = {
  async renderMarkdown(markdown: string): Promise<string> {
    try {
      const result = await invoke<RenderMarkdownResult>("render_markdown", { content: markdown });
      return sanitize(result.html);
    } catch {
      const html = marked.parse(markdown, { gfm: true }) as string;
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
