/**
 * @module extractCodeSource
 * Purpose: Recover the EXACT raw source text of a rendered code block for the
 * preview "copy" button (WI-2). Strips highlight.js markup and excludes any
 * injected copy-button label, while preserving special chars, CJK, emoji, and
 * internal newlines verbatim (no trim, no injected trailing newline).
 *
 * @coordinates-with attachCopyButtons.ts (supplies the click value)
 *
 * Key decisions:
 * - Read from the inner `<code>` element when present (the canonical source
 *   container); fall back to the node itself for a bare `<code>`.
 * - The copy button is identifiable by `[data-copy-button]` (or a `<button>`),
 *   so its label is excluded even when injected as a sibling inside the wrapper.
 */

/** Marks elements whose text is chrome, not source, and must be excluded. */
const EXCLUDE_SELECTOR = "button, [data-copy-button]";

/**
 * Extract the raw source text of a code block.
 *
 * @param node A `<pre>` or `<code>` element (may contain nested hljs `<span>`
 *   tokens and an injected copy `<button>` child/sibling).
 * @returns The code's source text with markup stripped, button label excluded,
 *   and whitespace/newlines preserved exactly.
 */
export function extractCodeSource(node: HTMLElement): string {
  // Prefer the inner <code> as the source container; a bare <code> uses itself.
  const code = node.querySelector("code") ?? node;

  // Clone so removing the button doesn't mutate the live DOM.
  const clone = code.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(EXCLUDE_SELECTOR).forEach((el) => el.remove());

  return clone.textContent ?? "";
}
