/**
 * Purpose: KaTeX typesetting pass for rendered Markdown (WI-1.1).
 *
 * The canonical Rust renderer emits math as `<span class="math-inline">TEX</span>`
 * and `<div class="math-display">TEX</div>` carrying the raw (HTML-escaped) TeX
 * in `textContent`. This module walks those placeholders in a container and
 * replaces each one's content with KaTeX HTML.
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
 * @coordinates-with src/services/exportService.ts (invokes `prerenderMathForExport`)
 *
 * NOTE (corrected in stage 2.5): an earlier note here claimed
 * `renderMathInContainer` had "no production caller" once the Preview pane was
 * deleted. That was wrong, and self-refuting — `prerenderMathForExport` calls it
 * directly a few lines below, so it sits on the live export path
 * `exportService.ts` → `prerenderMathForExport` → `renderMathInContainer`.
 * Deleting it would break math in HTML export.
 *
 * What is true is narrower: it has no caller **outside this module**. It and
 * `renderMathElement` are exported only so tests can drive them directly, and
 * the `mathmlOnly = false` branch is reached only by tests, because the export
 * path always passes `true`. That is a visibility smell, not dead code.
 */
import katex from "katex";

/** Marker attribute set once a block has been successfully typeset. */
const RENDERED_ATTR = "data-math-rendered";
/** Holds the source TeX so a re-render can detect an unchanged block. */
const SOURCE_ATTR = "data-math-source";

const MATH_INLINE_SELECTOR = "span.math-inline";
const MATH_DISPLAY_SELECTOR = "div.math-display";

/**
 * Render a single math element in place. Returns true if it typeset (or was a
 * no-op because the source was unchanged), false if it fell back to an error.
 *
 * Exported for unit testing without a full container pass.
 */
export function renderMathElement(
  el: HTMLElement,
  displayMode: boolean,
  /**
   * Export-only: emit MathML instead of KaTeX HTML. KaTeX HTML positions
   * glyphs with inline `style="height:…;vertical-align:…"`, but the server-side
   * `sanitize_html` (ammonia) forbids `style` (it has no CSS-property allow-list,
   * so permitting `style` would reopen the `url()` exfiltration vector Phase 0
   * closed). MathML needs no inline style — `<math>` renders natively in the
   * browser — so the exported math survives sanitization with its structure
   * intact. The in-container pass keeps the default HTML+MathML output, for a
   * host where the KaTeX stylesheet is loaded.
   */
  mathmlOnly = false,
): boolean {
  // The raw TeX is the element's text content for a fresh node (Rust
  // HTML-escaped it; the DOM un-escapes on read). Once a node has been
  // typeset, its textContent is the rendered math — so the source is stashed
  // in SOURCE_ATTR and read back from there for the memo check.
  const stashed = el.getAttribute(SOURCE_ATTR);
  const tex = stashed ?? el.textContent ?? "";

  // Memoize: a node already typeset for this exact source is a no-op. A host
  // that replaces nodes wholesale on each render gains nothing from it, so this
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
      // Export emits MathML only (no inline-style HTML the sanitizer would strip).
      ...(mathmlOnly ? { output: "mathml" as const } : {}),
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
export function renderMathInContainer(container: HTMLElement, mathmlOnly = false): void {
  container
    .querySelectorAll<HTMLElement>(MATH_INLINE_SELECTOR)
    .forEach((el) => renderMathElement(el, false, mathmlOnly));
  container
    .querySelectorAll<HTMLElement>(MATH_DISPLAY_SELECTOR)
    .forEach((el) => renderMathElement(el, true, mathmlOnly));
}

/**
 * Pre-render math in an HTML body string for the zero-JS export path (WI-1.1).
 * Parses the body into a detached container, typesets math in place as **MathML**
 * (not KaTeX HTML), and returns the resulting HTML. MathML carries no inline
 * `style`, so it survives the server-side `sanitize_html` (ammonia forbids
 * `style`) with its structure intact and renders natively in the browser with
 * zero JS. The body is re-sanitized server-side by `export_rendered_html` before
 * it is written.
 */
export function prerenderMathForExport(bodyHtml: string): string {
  const container = document.createElement("div");
  container.innerHTML = bodyHtml;
  renderMathInContainer(container, /* mathmlOnly */ true);
  return container.innerHTML;
}
