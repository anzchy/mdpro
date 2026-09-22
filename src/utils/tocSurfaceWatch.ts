/**
 * Purpose: the two cheap predicates `useWysiwygScrollSpy` runs on every
 * `MutationObserver` batch from the WYSIWYG container (D14), so that a late-mounting
 * `.ProseMirror` or a Milkdown-replaced heading element re-arms the scroll spy, while an
 * ordinary keystroke costs a handful of `matches`/`querySelector` calls and no heading
 * scan.
 *
 *   `mutationTouchesHeadings(records)` — did any added/removed **element** be, or contain,
 *   an `h1`–`h6` or a `.ProseMirror`? Text nodes are skipped outright: typing inside a
 *   heading replaces its text node, never the heading element.
 *   `headingListChanged(previous, next)` — is the observed element list stale (length or
 *   any identity differs)?
 *
 * Pure: no React, no globals, no module-scope mutable state.
 *
 * `@module src/utils/tocSurfaceWatch`
 * `@coordinates-with` `src/hooks/useWysiwygScrollSpy.ts` (the only caller),
 * `src/utils/tocElementResolution.ts` (`collectHeadingElements` produces the lists compared
 * here; its heading selector is the same six tags).
 */

/** Headings, plus the editor root itself — its arrival or removal is the D14 trigger. */
const SURFACE_SELECTOR = "h1, h2, h3, h4, h5, h6, .ProseMirror";

function nodeTouchesHeadings(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  return element.matches(SURFACE_SELECTOR) || element.querySelector(SURFACE_SELECTOR) !== null;
}

/** `true` iff some record added or removed a heading, a `.ProseMirror`, or an ancestor of one. */
export function mutationTouchesHeadings(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) {
      if (nodeTouchesHeadings(node)) return true;
    }
    for (const node of Array.from(record.removedNodes)) {
      if (nodeTouchesHeadings(node)) return true;
    }
  }
  return false;
}

/** `true` iff the two lists differ in length or in any element's identity, position-wise. */
export function headingListChanged(
  previous: readonly Element[],
  next: readonly Element[],
): boolean {
  if (previous.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    if (previous[i] !== next[i]) return true;
  }
  return false;
}
