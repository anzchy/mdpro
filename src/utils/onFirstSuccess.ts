/**
 * Purpose: a one-shot latch, `onFirstSuccess(fn)`, that runs `fn` on its first
 * invocation and never again. One is created per multi-file open (the drop in
 * `useOpenPaths.openDroppedMarkdown`, Finder `open -a` while running in
 * `useFileOpenEvent`, one per event)
 * and invoked after each file that opened and became active, so the default view
 * mode is applied exactly once — after the first success — and not at all when
 * every file fails or is refused (D51, D95).
 *
 * Key decisions:
 * - The latch is marked fired before `fn` runs, so an `fn` that throws is not
 *   re-run by a later invocation.
 * - Switching before the open and reverting on failure was rejected: during the
 *   await the CURRENT document would already be loaded into the new mode, and a
 *   Source → WYSIWYG load drops surplus table cells (ADR-0063).
 *
 * @coordinates-with src/hooks/useOpenPaths.ts — openDroppedMarkdown, openPaths
 * @coordinates-with src/hooks/useFileOpenEvent.ts — handleFileOpenEvent
 */
export function onFirstSuccess(fn: () => void): () => void {
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    fn();
  };
}
