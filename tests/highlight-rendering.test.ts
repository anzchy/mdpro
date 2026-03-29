/**
 * Tests for issue #40 — ==highlight== syntax not rendered in any view mode.
 *
 * Three rendering pipelines all need to convert ==text== → <mark>text</mark>:
 *   1. Preview/Split: exportService.renderMarkdown (Rust or marked fallback)
 *   2. WYSIWYG: Milkdown highlightMarkPlugin (remark + ProseMirror mark)
 *   3. Shortcut: highlightPlugin.ts CodeMirror shortcut should insert == not raw HTML
 *
 * Also verifies: highlightSyntax.ts DOM post-processor is wired into renderMarkdown.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  remarkHighlightReplacer,
  remarkHighlightTransformer,
  highlightSerializerHandler,
} from "../src/plugins/milkdown/highlightMarkPlugin";
import { highlightCommand } from "../src/plugins/codemirror/highlightPlugin";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../src");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// 1. exportService.renderMarkdown must return <mark> for ==text==
//
// Mock Tauri so invoke() fails → falls through to the JS marked path.
// After the fix, renderMarkdown calls renderHighlightSyntaxInHtml on the
// sanitized HTML output before returning it.
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no tauri in tests")),
}));

describe("exportService.renderMarkdown — highlight syntax (#40)", () => {
  it("converts ==text== to <mark>text</mark> in rendered HTML", async () => {
    const { exportService } = await import("../src/services/exportService");
    const html = await exportService.renderMarkdown("==hello world==");
    expect(html).toContain("<mark>hello world</mark>");
  });

  it("converts ==text== inside a paragraph", async () => {
    const { exportService } = await import("../src/services/exportService");
    const html = await exportService.renderMarkdown(
      "This is ==highlighted== text.",
    );
    expect(html).toContain("<mark>highlighted</mark>");
  });

  it("leaves text outside == markers unchanged", async () => {
    const { exportService } = await import("../src/services/exportService");
    const html = await exportService.renderMarkdown("plain text no highlight");
    expect(html).not.toContain("<mark>");
  });

  it("does not convert == inside inline code", async () => {
    const { exportService } = await import("../src/services/exportService");
    const html = await exportService.renderMarkdown("`==not highlighted==`");
    expect(html).not.toContain("<mark>");
    expect(html).toContain("==not highlighted==");
  });
});

// ---------------------------------------------------------------------------
// 2. exportService.ts must call renderHighlightSyntaxInHtml (source-level check)
// ---------------------------------------------------------------------------

describe("exportService.ts — wired to renderHighlightSyntaxInHtml (#40)", () => {
  const src = readSrc("services/exportService.ts");

  it("imports renderHighlightSyntaxInHtml from highlightSyntax", () => {
    expect(src).toMatch(/renderHighlightSyntaxInHtml/);
  });

  it("calls renderHighlightSyntaxInHtml in renderMarkdown", () => {
    expect(src).toMatch(/renderHighlightSyntaxInHtml\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// 3. highlightPlugin.ts (CodeMirror) — shortcut must insert ==text== not raw HTML
// ---------------------------------------------------------------------------

describe("highlightPlugin.ts — CodeMirror shortcut uses == markers (#40)", () => {
  const src = readSrc("plugins/codemirror/highlightPlugin.ts");

  it("DEFAULT_OPEN_TAG is == (not raw <mark> HTML)", () => {
    expect(src).toMatch(/DEFAULT_OPEN_TAG\s*=\s*["']==/);
  });

  it("DEFAULT_CLOSE_TAG is ==", () => {
    expect(src).toMatch(/DEFAULT_CLOSE_TAG\s*=\s*["']==/);
  });

  it("does not contain a raw <mark style= default", () => {
    expect(src).not.toMatch(/<mark style=/);
  });
});

// ---------------------------------------------------------------------------
// 4. highlightMarkPlugin — Milkdown plugin must exist and export the right API
// ---------------------------------------------------------------------------

describe("highlightMarkPlugin — Milkdown plugin exports (#40)", () => {
  it("exports remarkHighlightPlugin", async () => {
    const mod = await import(
      "../src/plugins/milkdown/highlightMarkPlugin"
    );
    expect(mod.remarkHighlightPlugin).toBeDefined();
  });

  it("exports highlightMarkPlugin (full Milkdown plugin array)", async () => {
    const mod = await import(
      "../src/plugins/milkdown/highlightMarkPlugin"
    );
    expect(mod.highlightMarkPlugin).toBeDefined();
    expect(Array.isArray(mod.highlightMarkPlugin)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. highlightSyntax.ts — renderHighlightSyntaxInHtml core logic (unit)
// ---------------------------------------------------------------------------

describe("renderHighlightSyntaxInHtml — DOM post-processor (#40)", () => {
  it("converts ==text== in plain HTML paragraph to <mark>", async () => {
    const { renderHighlightSyntaxInHtml } = await import(
      "../src/services/highlightSyntax"
    );
    const result = renderHighlightSyntaxInHtml("<p>==hello==</p>");
    expect(result).toContain("<mark>hello</mark>");
    expect(result).not.toContain("==hello==");
  });

  it("does not convert == inside <code> elements", async () => {
    const { renderHighlightSyntaxInHtml } = await import(
      "../src/services/highlightSyntax"
    );
    const result = renderHighlightSyntaxInHtml("<code>==hello==</code>");
    expect(result).not.toContain("<mark>");
    expect(result).toContain("==hello==");
  });

  it("does not convert == inside <pre> elements", async () => {
    const { renderHighlightSyntaxInHtml } = await import(
      "../src/services/highlightSyntax"
    );
    const result = renderHighlightSyntaxInHtml(
      "<pre><code>==hello==</code></pre>",
    );
    expect(result).not.toContain("<mark>");
  });

  it("returns input unchanged when no == present", async () => {
    const { renderHighlightSyntaxInHtml } = await import(
      "../src/services/highlightSyntax"
    );
    const input = "<p>no highlights here</p>";
    expect(renderHighlightSyntaxInHtml(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 6. remarkHighlightReplacer — mdast highlight node builder (unit)
//    Exported from highlightMarkPlugin.ts specifically for isolation testing.
// ---------------------------------------------------------------------------

describe("remarkHighlightReplacer — mdast node builder (#40)", () => {
  it("returns a highlight node for non-empty inner text", () => {
    const result = remarkHighlightReplacer("==hello==", "hello");
    expect(result).toEqual({
      type: "highlight",
      children: [{ type: "text", value: "hello" }],
    });
  });

  it("returns false for empty inner text (guards against ==== double-equals)", () => {
    expect(remarkHighlightReplacer("====", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. exportService — Rust success path (H7)
//    Verifies renderMarkdown uses the Rust HTML when invoke succeeds.
// ---------------------------------------------------------------------------

describe("exportService.renderMarkdown — Rust success path (#40)", () => {
  it("uses Rust-rendered HTML when invoke resolves", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      html: "<p><mark>from-rust</mark></p>",
    });
    const { exportService } = await import("../src/services/exportService");
    const html = await exportService.renderMarkdown("==from-rust==");
    expect(html).toContain("from-rust");
  });
});

// ---------------------------------------------------------------------------
// 8. highlightSerializerHandler — mdast-util-to-markdown handler (H8)
//    Tests the serializer in isolation without needing a full Milkdown context.
// ---------------------------------------------------------------------------

describe("highlightSerializerHandler — serialize highlight → ==text== (H8)", () => {
  function makeState(phrasingResult: string) {
    return {
      createTracker: () => ({ current: () => ({ before: "", after: "" }) }),
      enter: () => () => {},
      containerPhrasing: () => phrasingResult,
    };
  }

  it("wraps phrasing content with == markers", () => {
    const node = { type: "highlight", children: [{ type: "text", value: "hello" }] };
    const result = highlightSerializerHandler(node, null, makeState("hello"), {});
    expect(result).toBe("==hello==");
  });

  it("handles content containing = characters", () => {
    const node = { type: "highlight", children: [{ type: "text", value: "a=b" }] };
    const result = highlightSerializerHandler(node, null, makeState("a=b"), {});
    expect(result).toBe("==a=b==");
  });

  it("handles empty phrasing (degenerate node)", () => {
    const node = { type: "highlight", children: [] };
    const result = highlightSerializerHandler(node, null, makeState(""), {});
    expect(result).toBe("====");
  });
});

// ---------------------------------------------------------------------------
// 8b. remarkHighlightTransformer — AST transformation (M8)
//    Tests the remark plugin transforms text nodes correctly.
// ---------------------------------------------------------------------------

describe("remarkHighlightTransformer — mdast AST transformation (M8)", () => {
  function makeTextTree(value: string) {
    return {
      type: "root" as const,
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value }],
        },
      ],
    };
  }

  it("transforms ==text== in a text node into a highlight node", () => {
    const transform = remarkHighlightTransformer();
    const tree = makeTextTree("==hello==");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform(tree as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const para = tree.children[0] as any;
    expect(para.children).toContainEqual(
      expect.objectContaining({ type: "highlight" }),
    );
  });

  it("leaves text without == markers untouched", () => {
    const transform = remarkHighlightTransformer();
    const tree = makeTextTree("plain text");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform(tree as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const para = tree.children[0] as any;
    expect(para.children[0].type).toBe("text");
    expect(para.children[0].value).toBe("plain text");
  });

  it("handles == containing = inside content (e.g. ==a=b==)", () => {
    const transform = remarkHighlightTransformer();
    const tree = makeTextTree("==a=b==");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform(tree as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const para = tree.children[0] as any;
    const highlightNode = para.children.find((n: { type: string }) => n.type === "highlight");
    expect(highlightNode).toBeDefined();
    expect(highlightNode.children[0].value).toBe("a=b");
  });

  it("does not match ==== (empty inner content)", () => {
    const transform = remarkHighlightTransformer();
    const tree = makeTextTree("====");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform(tree as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const para = tree.children[0] as any;
    const hasHighlight = para.children.some((n: { type: string }) => n.type === "highlight");
    // ==== has no content between markers, remarkHighlightReplacer returns false
    // The regex [^\n]+? requires at least one char, so ==== won't match at all
    expect(hasHighlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7b. CodeMirror highlightCommand — behavioral test (M7)
//    Verifies the command wraps selected text with == markers.
//    Uses a minimal EditorState mock to avoid EditorView layout measurement
//    issues in jsdom (getClientRects is not available in jsdom).
// ---------------------------------------------------------------------------

describe("highlightCommand — CodeMirror command wraps selection (M7)", () => {
  /** Minimal view stub — avoids EditorView DOM/layout requirements in jsdom. */
  function createMockView(doc: string, from: number, to: number, readOnly = false) {
    const extensions = readOnly ? [EditorState.readOnly.of(true)] : [];
    let state = EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions,
    });
    return {
      get state() { return state; },
      dispatch(tr: { state: EditorState }) { state = tr.state; },
    } as unknown as EditorView;
  }

  it("wraps selected text with == markers", () => {
    const view = createMockView("hello world", 0, 5);
    const result = highlightCommand(view);
    expect(result).toBe(true);
    expect(view.state.sliceDoc()).toBe("==hello== world");
  });

  it("inserts ==== around cursor when nothing is selected", () => {
    const view = createMockView("hello", 2, 2);
    highlightCommand(view);
    expect(view.state.sliceDoc()).toBe("he====llo");
  });

  it("returns false for read-only editor", () => {
    const view = createMockView("hello", 0, 0, /* readOnly */ true);
    expect(highlightCommand(view)).toBe(false);
  });

  it("inserts == syntax, not raw <mark> HTML", () => {
    const view = createMockView("text", 0, 4);
    highlightCommand(view);
    expect(view.state.sliceDoc()).toBe("==text==");
    expect(view.state.sliceDoc()).not.toContain("<mark");
  });
});

// ---------------------------------------------------------------------------
// 9. Cross-pipeline edge cases (M9)
//    Covers scenarios that differ between the three rendering pipelines.
// ---------------------------------------------------------------------------

describe("cross-pipeline edge cases (M9)", () => {
  describe("findHighlightMatches edge cases", () => {
    it("returns empty array for text with no ==", async () => {
      const { findHighlightMatches } = await import("../src/services/highlightSyntax");
      expect(findHighlightMatches("plain text")).toHaveLength(0);
    });

    it("handles multiple highlights on the same line", async () => {
      const { findHighlightMatches } = await import("../src/services/highlightSyntax");
      const matches = findHighlightMatches("==a== and ==b==");
      expect(matches).toHaveLength(2);
    });

    it("does not match ==== (empty inner)", async () => {
      const { findHighlightMatches } = await import("../src/services/highlightSyntax");
      const matches = findHighlightMatches("====");
      expect(matches).toHaveLength(0);
    });

    it("respects escaped opening ==", async () => {
      const { findHighlightMatches } = await import("../src/services/highlightSyntax");
      const matches = findHighlightMatches("\\==not highlighted==");
      // Opening == is escaped — should not match
      expect(matches).toHaveLength(0);
    });
  });

  describe("renderHighlightSyntaxInHtml edge cases", () => {
    it("converts ==a=b== (= inside content)", async () => {
      const { renderHighlightSyntaxInHtml } = await import("../src/services/highlightSyntax");
      const result = renderHighlightSyntaxInHtml("<p>==a=b==</p>");
      expect(result).toContain("<mark>a=b</mark>");
    });

    it("does not double-convert already-wrapped <mark> elements", async () => {
      const { renderHighlightSyntaxInHtml } = await import("../src/services/highlightSyntax");
      const input = "<p><mark>already</mark></p>";
      const result = renderHighlightSyntaxInHtml(input);
      // No == in input so early-return path is taken
      expect(result).toBe(input);
    });
  });
});
