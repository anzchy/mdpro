/**
 * Purpose: the **WYSIWYG** half of the outline's scroll spy — a **geometric** spy over
 * the Milkdown surface's heading elements (D17, ADR-0026). The active heading is the
 * LAST heading whose scroller-relative top is at or above `SPY_ANCHOR_OFFSET_PX` — the
 * same rule Source applies in line space (`tocLineSpy.ts`).
 *
 * Pipeline:
 *   triggers — capture-phase passive `scroll` on the container, the `MutationObserver`
 *   re-arm, and a `ResizeObserver` (when the platform has one) → one pending rAF
 *   → `findMilkdownScrollerIn` (fresh every frame) → `selectActiveHeading` over the
 *   resolved list (`resolveHeadingElements`, document order) → `tocStore.setActiveEntry`
 *   only when the key changes.
 *   `MutationObserver(container, childList+subtree)` → `mutationTouchesHeadings`
 *   → `headingListChanged` → re-arm: re-resolve, re-observe sizes, recompute (D14).
 *
 * `@module src/hooks/useWysiwygScrollSpy`
 * `@coordinates-with` `src/utils/tocGeometrySpy.ts` (the pure selection),
 * `src/utils/scrollAnchor/milkdown.ts` (`findMilkdownScrollerIn`),
 * `src/utils/tocElementResolution.ts` (entries → elements), `src/utils/tocSurfaceWatch.ts`
 * (the mutation filter and the staleness test), `src/stores/tocStore.ts`
 * (`activeEntryId`), `src/hooks/useTOC.ts` (the caller — routes by `resolveSpyMode`),
 * `src/hooks/useSourceScrollSpy.ts` (the other mechanism; never live at the same time).
 *
 * Key decisions:
 * - **D17 — geometry, not IntersectionObserver records.** The IO version (DECISION A)
 *   derived the key from which headings crossed a `-66%` root margin; D17 showed that set
 *   is empty or stale between two headings and after a layout shift, so the highlight
 *   froze. ADR-0026 supersedes it: every frame reads the scroller rect once and at most
 *   ⌈log2 n⌉+2 heading rects (binary search), and no IntersectionObserver exists.
 * - **L6 — one index space.** `selectActiveHeading` indexes the resolved list, and the
 *   current key is mapped into that list — never into `entries`, where an unresolved
 *   (tier-3) entry would shift every index after it.
 * - `null` from the selection keeps the shown key (bad geometry, or nothing above the
 *   anchor). Retain-at-limit lives inside `selectActiveHeading` (ADR-0017 asymmetry).
 * - The scroller is looked up every frame, never cached: Milkdown can replace it, and a
 *   captured scroll from an inner scroller (`.tableWrapper`) only schedules a frame — it
 *   is never measured as the scroller. No scroller → nothing is read.
 * - **D14 — the deps carry no DOM, so the DOM is watched.** The effect runs before
 *   `@milkdown/react` creates `.ProseMirror`, and Milkdown replaces heading elements; the
 *   `MutationObserver` re-arms whenever the heading list is stale, and a re-arm
 *   recomputes (a layout change with no scroll still moves the key). The filter only
 *   re-scans when an added/removed node is or contains `hN` / `.ProseMirror`.
 * - D7: one `ui.toc.resolve.mismatch` warning per changed signature, per hook instance
 *   (`tocResolveMismatch.ts`). A re-arm with no `.ProseMirror` is a provider teardown and
 *   does not warn; the initial pass does (N-3/N-5 pin it).
 * - A pending frame never writes after teardown: `disposed` plus `cancelAnimationFrame`.
 *
 * `enabled` is `resolveSpyMode(enableSpyScrolling, viewMode) === "dom"`, decided by the
 * caller. Disabled, this hook attaches nothing.
 *
 * Logging (rule 20): the D7 mismatch warning and nothing else — the frame runs at scroll
 * frequency. No document content is logged.
 */
import { useEffect, useRef } from "react";

import { useTOCStore } from "../stores/tocStore";
import type { HeadingKey, TOCEntry } from "../types/toc";
import { findMilkdownScrollerIn } from "../utils/scrollAnchor/milkdown";
import { collectHeadingElements, resolveHeadingElements } from "../utils/tocElementResolution";
import { selectActiveHeading } from "../utils/tocGeometrySpy";
import { reportResolveMismatch } from "../utils/tocResolveMismatch";
import { headingListChanged, mutationTouchesHeadings } from "../utils/tocSurfaceWatch";

export interface UseWysiwygScrollSpyOptions {
  /** The current document's headings, in document order. New identity per re-parse. */
  entries: readonly TOCEntry[];
  /** Id of the document `entries` came from. Logged with the D7 mismatch warning. */
  documentId: string | null;
  /** Id of the element that holds the Milkdown surface. */
  containerId: string;
  /**
   * Whether the DOM spy owns the highlight right now. `useTOC` derives this from
   * `resolveSpyMode(enableSpyScrolling, viewMode) === "dom"`; this hook only obeys it.
   */
  enabled: boolean;
}

/**
 * Keep `tocStore.activeEntryId` on the last heading at or above the anchor line of the
 * WYSIWYG scroller.
 *
 * Per effect run while `enabled` and the container exists: one capture-phase scroll
 * listener, one `MutationObserver`, and one `ResizeObserver` when available, all
 * detached on every re-run. Returns nothing: the result is the store.
 */
export function useWysiwygScrollSpy({
  entries,
  documentId,
  containerId,
  enabled,
}: UseWysiwygScrollSpyOptions): void {
  const setActiveEntry = useTOCStore((state) => state.setActiveEntry);
  /** D7 — the last pass's `(entryCount, domCount)` signature, per hook instance. */
  const mismatchSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || entries.length === 0) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    let disposed = false;
    let pendingFrame: number | null = null;
    /** Every `hN` in `.ProseMirror` at the last pass — what staleness is judged against. */
    let domHeadings: Element[] = [];
    /** One resolution pass's output, in document order; replaced wholesale per arm. */
    let resolved: Array<[HeadingKey, Element]> = [];
    let indexByKey = new Map<HeadingKey, number>();
    let sizeTargets: Element[] = [];

    const recompute = () => {
      pendingFrame = null;
      if (disposed) return;
      const scroller = findMilkdownScrollerIn(container);
      if (!scroller) return;
      const rootTop = scroller.getBoundingClientRect().top;
      const currentKey = useTOCStore.getState().activeEntryId;
      const currentIndex = currentKey === null ? null : (indexByKey.get(currentKey) ?? null);
      const index = selectActiveHeading(
        {
          count: resolved.length,
          topAt: (i) => resolved[i][1].getBoundingClientRect().top - rootTop,
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
        },
        currentIndex,
      );
      if (index === null) return;
      const key = resolved[index][0];
      if (key !== useTOCStore.getState().activeEntryId) setActiveEntry(key);
    };

    /** At most one frame pending, however many triggers fire before it runs. */
    const schedule = () => {
      if (disposed || pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(recompute);
    };

    const sizeWatch = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;

    const observeSizes = () => {
      if (!sizeWatch) return;
      for (const target of sizeTargets) sizeWatch.unobserve(target);
      const scroller = findMilkdownScrollerIn(container);
      const viewDom = container.querySelector(".ProseMirror");
      sizeTargets = [scroller, viewDom].filter((el): el is Element => el !== null);
      for (const target of sizeTargets) sizeWatch.observe(target);
    };

    /**
     * One resolution pass, then observe sizes and recompute. The initial pass computes
     * in place — the effect runs after commit, so the answer for the current geometry is
     * in the store before anything else reads it; a re-arm (inside a MutationObserver
     * callback, possibly mid-burst) defers to the next frame.
     */
    const arm = (isRearm: boolean) => {
      domHeadings = collectHeadingElements(container);
      const resolution = resolveHeadingElements(entries, container);
      // Document order: `byKey` is built by iterating `entries`.
      resolved = [...resolution.byKey];
      indexByKey = new Map(resolved.map(([key], i) => [key, i]));

      // A re-arm with no `.ProseMirror` is a provider teardown, not a mismatch. The
      // initial pass keeps warning in that state (N-3/N-5 pin it).
      if (!isRearm || container.querySelector(".ProseMirror")) {
        reportResolveMismatch(resolution, entries.length, documentId, mismatchSignatureRef);
      }
      observeSizes();
      if (isRearm) schedule();
      else recompute();
    };

    arm(false);

    // D14 — the deps above carry no DOM, so the late `.ProseMirror` mount and Milkdown's
    // heading replacements are only visible here.
    const surfaceWatch = new MutationObserver((records) => {
      if (!mutationTouchesHeadings(records)) return;
      if (!headingListChanged(domHeadings, collectHeadingElements(container))) return;
      arm(true);
    });
    surfaceWatch.observe(container, { childList: true, subtree: true });

    // Capture: `scroll` does not bubble, and the scroller is a descendant that Milkdown
    // may replace — the container is the one stable element to listen on.
    const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };
    container.addEventListener("scroll", schedule, listenerOptions);

    return () => {
      disposed = true;
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      container.removeEventListener("scroll", schedule, { capture: true });
      surfaceWatch.disconnect();
      sizeWatch?.disconnect();
    };
  }, [entries, containerId, documentId, enabled, setActiveEntry]);
}
