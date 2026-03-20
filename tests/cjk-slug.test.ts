/**
 * Tests for CJK / emoji heading slug generation.
 *
 * These tests cover both tocService.parseHeadingsFromContent (frontend
 * fallback parser) and the exportService marked fallback renderer, since
 * both must use the same Unicode-aware algorithm (fixes #8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { exportService } from "../src/services/exportService";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// tocService — parseHeadingsFromContent (slug algorithm)
// ---------------------------------------------------------------------------

describe("tocService CJK slug generation", () => {
  it("preserves CJK characters in slug", () => {
    const headings = parseHeadingsFromContent("# 架构设计");
    expect(headings).toHaveLength(1);
    expect(headings[0].id).toBe("架构设计");
  });

  it("two distinct CJK headings produce distinct slugs", () => {
    const headings = parseHeadingsFromContent("# 架构设计\n# 系统设计");
    expect(headings[0].id).toBe("架构设计");
    expect(headings[1].id).toBe("系统设计");
    expect(headings[0].id).not.toBe(headings[1].id);
  });

  it("ASCII headings still produce lowercase-hyphenated slugs", () => {
    const headings = parseHeadingsFromContent("# Hello World");
    expect(headings[0].id).toBe("hello-world");
  });

  it("emoji are stripped and the rest is preserved", () => {
    const headings = parseHeadingsFromContent("# Emoji 🎉");
    expect(headings[0].id).toBe("emoji");
  });

  it("two identical CJK headings deduplicate with -1 suffix", () => {
    const headings = parseHeadingsFromContent("# 架构\n# 架构");
    expect(headings[0].id).toBe("架构");
    expect(headings[1].id).toBe("架构-1");
  });

  it("empty/whitespace-only heading falls back to 'heading'", () => {
    // A heading line like "##   " is skipped by the parser (whitespace-only
    // text is filtered). Use a heading that passes the regex but produces an
    // empty base after slug normalisation — a heading of only emoji.
    const headings = parseHeadingsFromContent("# 🎉🎊");
    expect(headings[0].id).toBe("heading");
  });

  it("CJK heading mixed with ASCII and punctuation", () => {
    const headings = parseHeadingsFromContent("# 第1章: 架构");
    // Punctuation (colon + space) collapses to a single hyphen
    expect(headings[0].id).toBe("第1章-架构");
  });

  it("very long CJK heading is not truncated", () => {
    const longText = "架构".repeat(50); // 100 CJK chars
    const headings = parseHeadingsFromContent(`# ${longText}`);
    expect(headings[0].id).toBe(longText);
  });

  it("deduplication counter resets between independent calls", () => {
    // Each call to parseHeadingsFromContent should start fresh counts
    const first = parseHeadingsFromContent("# 架构");
    const second = parseHeadingsFromContent("# 架构");
    expect(first[0].id).toBe("架构");
    expect(second[0].id).toBe("架构");
  });
});

// ---------------------------------------------------------------------------
// exportService — marked fallback renderer (slug algorithm)
// ---------------------------------------------------------------------------

describe("exportService CJK slug in fallback renderer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("preserves CJK characters in heading id attribute", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const html = await exportService.renderMarkdown("# 架构设计");
    expect(html).toContain('id="架构设计"');
  });

  it("two distinct CJK headings get distinct ids", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const html = await exportService.renderMarkdown("# 架构设计\n\n# 系统设计");
    expect(html).toContain('id="架构设计"');
    expect(html).toContain('id="系统设计"');
  });

  it("emoji-only heading falls back to id='heading'", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const html = await exportService.renderMarkdown("# 🎉🎊");
    expect(html).toContain('id="heading"');
  });

  it("duplicate CJK headings are deduplicated", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const html = await exportService.renderMarkdown("# 架构\n\n# 架构");
    expect(html).toContain('id="架构"');
    expect(html).toContain('id="架构-1"');
  });

  it("ASCII headings still work correctly in fallback", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const html = await exportService.renderMarkdown("# Hello World");
    expect(html).toContain('id="hello-world"');
  });
});
