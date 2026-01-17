import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface RenderMarkdownResult {
  html: string;
}

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_TAGS: ["mark", "u"] });

export const exportService = {
  async renderMarkdown(markdown: string): Promise<string> {
    try {
      const result = await invoke<RenderMarkdownResult>("render_markdown", { markdown });
      return sanitize(result.html);
    } catch {
      const html = marked.parse(markdown, { gfm: true }) as string;
      return sanitize(html);
    }
  },
};
