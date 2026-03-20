/**
 * Tests for WYSIWYG security helpers (issues #7 and #10)
 *
 * #7 — pasted HTML must be sanitized through DOMPurify before ProseMirror
 *       parses it, stripping XSS vectors such as event handlers and
 *       javascript: hrefs.
 *
 * #10 — clicks on links with javascript: or data: protocols must be blocked
 *        in the Milkdown editor container.
 */

import { describe, expect, it } from "vitest";
import { sanitizePastedHtml, isSafeHref } from "../src/components/Editor/MilkdownEditor";

// ---------------------------------------------------------------------------
// sanitizePastedHtml — issue #7
// ---------------------------------------------------------------------------

describe("sanitizePastedHtml", () => {
  it("returns plain text unchanged", () => {
    const result = sanitizePastedHtml("Hello world");
    expect(result).toBe("Hello world");
  });

  it("preserves safe inline markup: bold and italic", () => {
    const html = "<strong>bold</strong> and <em>italic</em>";
    const result = sanitizePastedHtml(html);
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("preserves safe block elements: p, ul, li", () => {
    const html = "<p>Para</p><ul><li>item</li></ul>";
    const result = sanitizePastedHtml(html);
    expect(result).toContain("<p>Para</p>");
    expect(result).toContain("<ul><li>item</li></ul>");
  });

  it("strips onerror event handler from img tag (#7)", () => {
    const html = '<img src="x" onerror="alert(1)">';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
    // The img element itself may survive (src=x is harmless); onerror must not
  });

  it("strips onclick event handler from anchor tag", () => {
    const html = '<a href="https://example.com" onclick="alert(1)">link</a>';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("alert");
  });

  it("strips javascript: href from anchor tag (#7)", () => {
    const html = '<a href="javascript:alert(1)">click me</a>';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("strips script tags entirely", () => {
    const html = "<p>text</p><script>alert(1)</script>";
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("strips data: src on img (potential data-URI XSS)", () => {
    const html = '<img src="data:text/html,<script>alert(1)</script>">';
    const result = sanitizePastedHtml(html);
    // DOMPurify blocks data: URIs that contain HTML/script content
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("preserves safe https:// href on anchor", () => {
    const html = '<a href="https://example.com">link</a>';
    const result = sanitizePastedHtml(html);
    expect(result).toContain("https://example.com");
    expect(result).toContain("link");
  });

  it("handles empty string without throwing", () => {
    expect(() => sanitizePastedHtml("")).not.toThrow();
    expect(sanitizePastedHtml("")).toBe("");
  });

  it("handles plain-text clipboard content (no tags)", () => {
    const text = "just plain text with no markup";
    const result = sanitizePastedHtml(text);
    expect(result).toBe(text);
  });

  it("strips inline event handlers: onload, onmouseover", () => {
    const html = '<img src="x" onload="steal()" onmouseover="xss()">';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onmouseover");
    expect(result).not.toContain("steal");
    expect(result).not.toContain("xss");
  });
});

// ---------------------------------------------------------------------------
// isSafeHref — issue #10
// ---------------------------------------------------------------------------

describe("isSafeHref", () => {
  it("allows https:// links", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
  });

  it("allows http:// links", () => {
    expect(isSafeHref("http://example.com")).toBe(true);
  });

  it("allows mailto: links", () => {
    expect(isSafeHref("mailto:user@example.com")).toBe(true);
  });

  it("allows relative fragment links (#anchor)", () => {
    expect(isSafeHref("#section")).toBe(true);
  });

  it("allows relative path links (./foo.md)", () => {
    expect(isSafeHref("./foo.md")).toBe(true);
  });

  it("blocks javascript: protocol (#10)", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with mixed case", () => {
    expect(isSafeHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("JAVASCRIPT:void(0)")).toBe(false);
  });

  it("blocks javascript: with leading whitespace (bypass attempt)", () => {
    expect(isSafeHref("  javascript:alert(1)")).toBe(false);
    expect(isSafeHref("\tjavascript:alert(1)")).toBe(false);
  });

  it("blocks data: protocol (#10)", () => {
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("blocks data: with mixed case", () => {
    expect(isSafeHref("Data:text/html,evil")).toBe(false);
  });

  it("blocks vbscript: protocol", () => {
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
  });

  it("returns false for empty href", () => {
    expect(isSafeHref("")).toBe(false);
  });
});
