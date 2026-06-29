/**
 * Purpose: KaTeX typesetting pass for rendered Markdown (WI-1.1).
 *
 * The canonical Rust renderer emits math as `<span class="math-inline">TEX</span>`
 * and `<div class="math-display">TEX</div>` carrying the raw (HTML-escaped) TeX
 * in `textContent`. This module walks those placeholders in a container and
 * replaces each one's content with KaTeX HTML, mirroring the highlight.js pass
 * in Preview.tsx.
 *
 * Fail-soft (DESIGN.md "respect the file"): invalid TeX never blanks the block
 * or throws — the raw source is kept in a `code`-styled span and a danger badge
 * is shown, so the user is always one glance from their source.
 *
 * Performance (plan decision P1): each block is keyed by its source TeX; a block
 * already typeset for the same source is skipped on re-render. A Weak-ish cache
 * is avoided in favor of a `data-` attribute marker so the cache survives the
 * `dangerouslySetInnerHTML` swap (which replaces the nodes entirely).
 *
 * @coordinates-with src-tauri/src/services/markdown_ext.rs (emits the wrappers)
 * @coordinates-with src/components/Preview/Preview.tsx (invokes the pass)
 */
import katex from "katex";

/** Marker attribute set once a block has been successfully typeset. */
const RENDERED_ATTR = "data-math-rendered";
/** Holds the source TeX so a re-render can detect an unchanged block. */
const SOURCE_ATTR = "data-math-source";

export const MATH_INLINE_SELECTOR = "span.math-inline";
export const MATH_DISPLAY_SELECTOR = "div.math-display";

/**
 * Render a single math element in place. Returns true if it typeset (or was a
 * no-op because the source was unchanged), false if it fell back to an error.
 *
 * Exported for unit testing without a full Preview render.
 */
export function renderMathElement(el: HTMLElement, displayMode: boolean): boolean {
  // The raw TeX is the element's text content for a fresh node (Rust
  // HTML-escaped it; the DOM un-escapes on read). Once a node has been
  // typeset, its textContent is the rendered math — so the source is stashed
  // in SOURCE_ATTR and read back from there for the memo check.
  const stashed = el.getAttribute(SOURCE_ATTR);
  const tex = stashed ?? el.textContent ?? "";

  // Memoize: a node already typeset for this exact source is a no-op. Preview
  // replaces nodes wholesale on each render (dangerouslySetInnerHTML), so this
  // mainly guards against double-processing within a single pass; an unchanged
  // block whose node persisted (e.g. a re-invoked pass) is skipped here.
  if (el.getAttribute(RENDERED_ATTR) === "true" && stashed === tex) {
    return true;
  }

  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      // Never inject raw HTML from \href etc.; KaTeX output is MathML+spans only.
      trust: false,
      strict: false,
    });
    el.innerHTML = html;
    el.setAttribute(RENDERED_ATTR, "true");
    el.setAttribute(SOURCE_ATTR, tex);
    el.classList.remove("math-error");
    return true;
  } catch (err) {
    // Fail-soft: keep the raw source visible, add a danger badge. Never blank.
    const message = err instanceof Error ? err.message : String(err);
    el.classList.add("math-error");
    el.setAttribute("title", message);
    // Preserve the source as plain text inside a code-style span so the user
    // can read/fix it. textContent assignment escapes automatically.
    const code = document.createElement("code");
    code.className = "math-error-source";
    code.textContent = tex;
    el.replaceChildren(code);
    el.removeAttribute(RENDERED_ATTR);
    el.setAttribute(SOURCE_ATTR, tex);
    return false;
  }
}

/**
 * Typeset every math placeholder within `container`. Inline and display blocks
 * are handled independently so a single bad block never stops the others.
 */
export function renderMathInContainer(container: HTMLElement): void {
  container
    .querySelectorAll<HTMLElement>(MATH_INLINE_SELECTOR)
    .forEach((el) => renderMathElement(el, false));
  container
    .querySelectorAll<HTMLElement>(MATH_DISPLAY_SELECTOR)
    .forEach((el) => renderMathElement(el, true));
}

/**
 * Pre-render math in an HTML body string for the zero-JS export path (WI-1.1).
 * Parses the body into a detached container, typesets math in place, and
 * returns the resulting HTML. The exported file then carries static KaTeX
 * output (no client JS needed). The body is re-sanitized server-side by
 * `export_rendered_html` before it is written.
 */
export function prerenderMathForExport(bodyHtml: string): string {
  const container = document.createElement("div");
  container.innerHTML = bodyHtml;
  renderMathInContainer(container);
  return container.innerHTML;
}
