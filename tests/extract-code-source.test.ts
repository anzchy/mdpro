/**
 * @module extract-code-source.test
 * Purpose: Verify extractCodeSource — the pure extractor that recovers the
 * EXACT raw source text of a rendered code block (WI-2 copy button, Unit A).
 *
 * Contract: given a `<pre>` or `<code>` DOM node — possibly containing nested
 * highlight.js `<span class="hljs-*">` tokens and possibly an injected copy
 * `<button data-copy-button>` child/sibling — return only the code's source
 * text: markup stripped, special chars / CJK / emoji / internal newlines
 * preserved exactly, no injected trailing newline, no trimming, button label
 * excluded.
 */
import { describe, expect, it } from "vitest";
import { extractCodeSource } from "../src/components/Preview/extractCodeSource";

describe("extractCodeSource", () => {
  // A1 — nested hljs spans collapse to plain source text (L1 toBe)
  it("concatenates text across nested hljs spans, stripping markup", () => {
    const pre = document.createElement("pre");
    pre.innerHTML =
      '<code><span class="hljs-keyword">fn</span> ' +
      '<span class="hljs-title">main</span>() {}</code>';

    expect(extractCodeSource(pre)).toBe("fn main() {}");
  });

  // A2 — special chars + CJK + emoji + multi-line, no injected trailing newline
  it("preserves special chars, CJK, emoji and internal newlines exactly", () => {
    const source = 'const s = "<a> 中文 🎉";\nline2';
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = source; // textContent assignment escapes < > safely
    pre.appendChild(code);

    const result = extractCodeSource(pre);
    expect(result).toBe(source);
    // No trailing newline injected — last char is the literal "2".
    expect(result.at(-1)).toBe("2");
  });

  // A3 — empty and whitespace-only blocks preserved verbatim (no trim)
  it("returns empty string for empty block and preserves whitespace-only", () => {
    const empty = document.createElement("pre");
    empty.innerHTML = "<code></code>";
    expect(extractCodeSource(empty)).toBe("");

    const ws = document.createElement("pre");
    ws.innerHTML = "<code>   \n  </code>";
    expect(extractCodeSource(ws)).toBe("   \n  ");
  });

  // A4 — injected copy button label is excluded, even as a sibling child
  it("excludes the copy button's own label text", () => {
    const pre = document.createElement("pre");
    pre.innerHTML =
      "<code>x = 1</code>" +
      '<button data-copy-button aria-label="Copy">Copy</button>';

    const result = extractCodeSource(pre);
    expect(result).toBe("x = 1");
    expect(result).not.toContain("Copy");
  });
});
