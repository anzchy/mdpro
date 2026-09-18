import { invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import { applyImageWidthMarkerToHtml } from "../plugins/milkdown/imageResizePlugin";
import { renderHighlightSyntaxInHtml } from "./highlightSyntax";
import { loggingService } from "./loggingService";
import { prerenderMathForExport } from "./mathRender";
import { sanitizeExportFragment } from "./sanitizerPolicy";
import { createAnchorSlugAllocator } from "../utils/headingIdentity";

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
// Rust `sanitize_html` on tags, attributes and URI schemes. It deliberately
// DIVERGES on `SANITIZE_DOM`, which is off (ADR-0003 B′) so a heading anchor
// such as `#title` survives export instead of being stripped — ammonia never
// stripped it, so this closes a divergence rather than opening one.
//
// EXPORT ONLY: everything this produces is written to a file, never inserted
// into the app's live DOM. See src/services/sanitizerPolicy.ts.
const sanitize = sanitizeExportFragment;

/*
 * Anchor-slug generation used to live here as a private `generateHeadingId` with its
 * own `Map<string, number>` counter and a doc comment reading "must match tocService"
 * — a request that the next reader remember. It was not remembered: the counter
 * emitted a duplicate id whenever a later heading's literal text already slugged to
 * the suffix it had just handed out, and it registered the empty base BEFORE
 * substituting `"heading"`, so an emoji-only heading could emit the bare id `-1`.
 *
 * What is true now (WI-3.2): this face and `parseHeadingsFromContent` in
 * tocService.ts SHARE ONE MODULE, `src/utils/headingIdentity.ts` — there is nothing
 * left to keep in sync. The third live face, `generate_heading_id` in
 * `src-tauri/src/services/markdown.rs`, is a hand port of the same algorithm, and its
 * agreement is ENFORCED by the shared corpus
 * `tests/render-fixtures/heading-identity.json` plus its two runners, not by prose.
 */

/**
 * Create a new marked instance with heading IDs.
 *
 * The allocator is constructed INSIDE the returned closure, once per parse. That is
 * the per-parse reset semantics the old `idCounts.clear()` provided, preserved:
 * `parseMarkdownWithHeadingIds` is a module-level singleton, so an allocator built
 * alongside the `Marked` instance would let each call continue the previous call's
 * numbering. `marked`'s renderer hook is synchronous and runs entirely within
 * `markedInstance.parse`, so the closure variable is safe to read from the hook.
 */
function createMarkedParser(): (markdown: string) => string {
  let slugs = createAnchorSlugAllocator();

  const markedInstance = new Marked();
  markedInstance.use({
    renderer: {
      heading(text: string, level: number): string {
        const id = slugs.allocate(text);
        return `<h${level} id="${id}" data-heading-id="${id}">${text}</h${level}>\n`;
      }
    }
  });

  return (markdown: string) => {
    slugs = createAnchorSlugAllocator(); // Fresh per parse — no state crosses calls.
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
