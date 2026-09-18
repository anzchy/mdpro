/**
 * WI-1.1 — KaTeX preview render pass.
 *
 * The Rust renderer emits `<span class="math-inline">TEX</span>` /
 * `<div class="math-display">TEX</div>`; this pass typesets them in place and
 * fails soft on invalid TeX (raw source kept, never blank).
 */
import { describe, expect, it } from "vitest";
import {
  prerenderMathForExport,
  renderMathElement,
  renderMathInContainer,
} from "../src/services/mathRender";
import { sanitizeExportFragment } from "../src/services/sanitizerPolicy";

function inline(tex: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "math-inline";
  el.textContent = tex;
  return el;
}

function display(tex: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "math-display";
  el.textContent = tex;
  return el;
}

describe("renderMathElement", () => {
  it("typesets valid inline TeX into KaTeX HTML", () => {
    const el = inline("x^2 + 1");
    const ok = renderMathElement(el, false);
    expect(ok).toBe(true);
    // KaTeX produces a .katex wrapper.
    expect(el.querySelector(".katex")).not.toBeNull();
    expect(el.classList.contains("math-error")).toBe(false);
  });

  it("typesets valid display TeX in display mode", () => {
    const el = display("\\int_0^1 x\\,dx");
    const ok = renderMathElement(el, true);
    expect(ok).toBe(true);
    // Display mode renders a .katex-display block.
    expect(el.querySelector(".katex-display")).not.toBeNull();
  });

  it("fails soft on invalid TeX: keeps raw source, marks error, never blank", () => {
    const el = inline("\\frac{1}{"); // unbalanced — KaTeX throws
    const ok = renderMathElement(el, false);
    expect(ok).toBe(false);
    expect(el.classList.contains("math-error")).toBe(true);
    // Raw source preserved in a code-style span (not blanked).
    const src = el.querySelector("code.math-error-source");
    expect(src).not.toBeNull();
    expect(src?.textContent).toBe("\\frac{1}{");
    // A diagnostic title is set for hover.
    expect(el.getAttribute("title")).toBeTruthy();
  });

  it("memoizes: a second render of the same source is a no-op", () => {
    const el = inline("a+b");
    renderMathElement(el, false);
    const firstHtml = el.innerHTML;
    // Second call with unchanged source returns true and does not re-render.
    const ok = renderMathElement(el, false);
    expect(ok).toBe(true);
    expect(el.innerHTML).toBe(firstHtml);
  });

  it("renders a fresh node for changed source (preview replaces nodes)", () => {
    // Preview re-renders via dangerouslySetInnerHTML, which replaces the math
    // node entirely. A changed source therefore arrives as a brand-new node
    // (no memo attrs) and typesets independently.
    const first = inline("a+b");
    renderMathElement(first, false);
    const second = inline("c+d");
    renderMathElement(second, false);
    expect(second.querySelector(".katex")).not.toBeNull();
    expect(second.innerHTML).not.toBe(first.innerHTML);
  });

  it("does not emit a live link or script from a malicious \\href payload", () => {
    // trust:false means \href is refused and rendered as inert text — there is
    // no anchor, no href attribute, and no script. (The command may appear as
    // escaped text inside the MathML annotation, which is inert.)
    const el = inline("\\href{javascript:alert(1)}{x}");
    renderMathElement(el, false);
    expect(el.querySelector("a[href]")).toBeNull();
    expect(el.innerHTML).not.toContain('href="javascript:');
    expect(el.querySelector("script")).toBeNull();
  });
});

describe("renderMathInContainer", () => {
  it("typesets a mix of inline and display blocks independently", () => {
    const container = document.createElement("div");
    container.appendChild(inline("a+b"));
    const bad = inline("\\frac{1}{");
    container.appendChild(bad);
    container.appendChild(display("c+d"));

    renderMathInContainer(container);

    const blocks = container.querySelectorAll(".math-inline, .math-display");
    expect(blocks.length).toBe(3);
    // Good blocks typeset; the bad one fails soft — none are blank.
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(bad.classList.contains("math-error")).toBe(true);
    expect(bad.textContent).toBe("\\frac{1}{");
  });
});

describe("prerenderMathForExport — A1 MathML output survives sanitization", () => {
  it("emits MathML (no inline style) for inline math that survives the sanitizer", () => {
    const body = '<p>x <span class="math-inline">\\frac{a}{b}</span> y</p>';
    const pre = prerenderMathForExport(body);
    // MathML structure is present...
    expect(pre).toContain("<math");
    expect(pre).toContain("<mfrac");
    // ...and carries NO inline style (the vector the sanitizer strips). If the
    // export still emitted KaTeX HTML, it would carry style="height:…".
    expect(pre).not.toContain('style="');
    // After the server-side sanitizer the MathML structure must SURVIVE intact.
    const safe = sanitizeExportFragment(pre);
    expect(safe).toContain("<math");
    expect(safe).toContain("<mfrac");
  });

  it("emits MathML for display math ($$\\int$$) that survives the sanitizer", () => {
    const body = '<div class="math-display">\\int_0^1 x\\,dx</div>';
    const pre = prerenderMathForExport(body);
    expect(pre).toContain("<math");
    expect(pre).toContain("display=\"block\"");
    expect(pre).not.toContain('style="');
    const safe = sanitizeExportFragment(pre);
    expect(safe).toContain("<math");
    // The integral structure (msubsup over the ∫) survives.
    expect(safe).toContain("<msubsup");
  });

  it("emits MathML for \\sqrt that survives the sanitizer (msqrt)", () => {
    const body = '<span class="math-inline">\\sqrt{x}</span>';
    const safe = sanitizeExportFragment(prerenderMathForExport(body));
    expect(safe).toContain("<msqrt");
  });

  // B-M2: table-cell math renders via pulldown-cmark's default writer as
  // `class="math math-inline"` (double class). The KaTeX pass selects with
  // `span.math-inline`, a CSS class selector that MUST match the double-class
  // element so in-cell math still typesets. Pin that the selector matches.
  it("typesets table-cell math (default double-class span.math math-inline)", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<table><tbody><tr><td><span class="math math-inline">x+y</span></td></tr></tbody></table>';
    renderMathInContainer(container);
    // The double-class span was found by `span.math-inline` and typeset.
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
