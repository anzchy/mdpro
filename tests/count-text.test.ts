import { describe, it, expect } from "vitest";
import { countText, WORDS_PER_MINUTE } from "../src/utils/countText";

describe("countText", () => {
  // A1: empty input
  it("returns zeros for empty input", () => {
    expect(countText("", {})).toEqual({
      words: 0,
      chars: 0,
      readingTimeMinutes: 0,
    });
  });

  // A2: plain Latin words; chars asserted against documented code-point count
  it("counts Latin words and code-point chars", () => {
    const result = countText("hello world foo", {});
    expect(result.words).toBe(3);
    // [...].length over "hello world foo" = 15 code points
    expect(result.chars).toBe(15);
  });

  // A3: DR5 core — each CJK character is one word-unit (NOT one word total)
  it("counts each CJK character as one word", () => {
    const result = countText("中文字符测试", {});
    expect(result.words).toBe(6);
    expect(result.words).not.toBe(1);
    expect(result.chars).toBe(6);
  });

  // A4: mixed Latin + CJK
  it("counts mixed Latin and CJK", () => {
    const result = countText("hello 世界 world", {});
    // 2 Latin tokens (hello, world) + 2 CJK chars (世, 界)
    expect(result.words).toBe(4);
    // [...].length over "hello 世界 world" = 14 code points
    expect(result.chars).toBe(14);
  });

  // A5: excludeFrontmatter both branches
  it("excludes leading frontmatter when excludeFrontmatter is true (A5a)", () => {
    const text = "---\ntitle: x\n---\nbody words here";
    expect(countText(text, { excludeFrontmatter: true }).words).toBe(3);
  });

  it("includes frontmatter words when excludeFrontmatter is false (A5b)", () => {
    const text = "---\ntitle: x\n---\nbody words here";
    // title + x add to the body's 3 words
    expect(countText(text, { excludeFrontmatter: false }).words).toBeGreaterThan(3);
  });

  // A6: excludeCode both branches
  it("excludes fenced code when excludeCode is true (A6a)", () => {
    const text = "text\n```\ncode here ignored\n```\nmore";
    expect(countText(text, { excludeCode: true }).words).toBe(2);
  });

  it("includes fenced code words when excludeCode is false (A6b)", () => {
    const text = "text\n```\ncode here ignored\n```\nmore";
    expect(countText(text, { excludeCode: false }).words).toBeGreaterThan(2);
  });

  // A7: reading time derived from WORDS_PER_MINUTE constant (no magic literal)
  it("computes reading time as ceil(words / WORDS_PER_MINUTE)", () => {
    const text = Array.from({ length: 250 }, () => "word").join(" ");
    const result = countText(text, {});
    expect(result.words).toBe(250);
    expect(result.readingTimeMinutes).toBe(
      Math.ceil(result.words / WORDS_PER_MINUTE),
    );
  });
});
