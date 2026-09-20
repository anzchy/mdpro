/**
 * Purpose: the **WYSIWYG** half of the outline's scroll spy — the IntersectionObserver
 * over the Milkdown surface's heading elements, lifted out of `useTOC` verbatim by
 * WI-5b so that `useTOC` can be a router instead of a place where two different spy
 * mechanisms share one function's dependency list.
 *
 *   `resolveHeadingElements` (entries → elements, both directions)
 *   → `IntersectionObserver(root: container, rootMargin: "0px 0px -66% 0px")`
 *   → `pickActiveKey` (document order over the visible set) → `tocStore.setActiveEntry`.
 *
 * `@module src/hooks/useWysiwygScrollSpy`
 * `@coordinates-with` `src/utils/tocElementResolution.ts` (both halves of the mapping and
 * the document-order picker), `src/stores/tocStore.ts` (`activeEntryId`),
 * `src/hooks/useTOC.ts` (the caller — routes by `resolveSpyMode`),
 * `src/hooks/useSourceScrollSpy.ts` (the other mechanism; never live at the same time).
 *
 * ---------------------------------------------------------------------------
 * This is an extraction, not a rewrite. The behaviour is the specification.
 * ---------------------------------------------------------------------------
 * Every line below was `useTOC.ts:190-271` before WI-5b, and it is **observationally
 * identical** through `useTOC`'s public surface: the same observer options, the same
 * document-order `pickActiveKey`, the same retention-on-empty (DECISION A, pinned as
 * specification at `tests/use-toc-scroll-spy-identity.test.ts:11-22`), the same
 * one-warning-per-changed-signature `ui.toc.resolve.mismatch` (D7), and the same
 * one-`disconnect`-per-construction pairing. The refactor's only acceptance evidence is
 * that `tests/use-toc-scroll-spy-identity.test.ts` and
 * `tests/use-toc-navigation-identity.test.ts` stay green with **zero assertion edits**;
 * deliberately, no new test was written for this file, because a second and easier bar
 * would dilute that one.
 *
 * ---------------------------------------------------------------------------
 * `enabled` replaces the old `enableSpyScrolling` conjunct, and means something narrower
 * ---------------------------------------------------------------------------
 * The effect used to read the raw master switch. It now reads
 * `resolveSpyMode(enableSpyScrolling, viewMode) === "dom"`, decided by the caller. The
 * difference is the whole point of WI-5: in Source mode this hook must not merely
 * resolve zero headings and sit there — it must **never construct an observer at all**,
 * because `#source-container` holds no `.ProseMirror`, `collectHeadingElements` returns
 * `[]`, and an armed-but-empty observer is exactly the silent failure that left the
 * outline frozen in Source mode.
 *
 * Logging (rule 20): the D7 mismatch warning and nothing else. There is no per-record
 * log — the observer callback runs at scroll frequency, and a line here would write
 * thousands per gesture. Same reasoning `useSourceScrollSpy.ts` records.
 */
import { useEffect, useRef } from "react";

import { loggingService } from "../services/loggingService";
import { useTOCStore } from "../stores/tocStore";
import type { HeadingKey, TOCEntry } from "../types/toc";
import { pickActiveKey, resolveHeadingElements } from "../utils/tocElementResolution";

export interface UseWysiwygScrollSpyOptions {
  /** The current document's headings, in document order. New identity per re-parse. */
  entries: readonly TOCEntry[];
  /** Id of the document `entries` came from. Logged with the D7 mismatch warning. */
  documentId: string | null;
  /** Id of the element the observer uses as its `root`. */
  containerId: string;
  /**
   * Whether the DOM spy owns the highlight right now. WI-5 derives this from
   * `resolveSpyMode(enableSpyScrolling, viewMode) === "dom"`; this hook only obeys it.
   */
  enabled: boolean;
}

/**
 * Keep `tocStore.activeEntryId` in step with which heading is in the top third of the
 * WYSIWYG surface.
 *
 * Constructs exactly one `IntersectionObserver` per resolution pass while `enabled` and
 * the container exists, and disconnects it on every re-run. Returns nothing: the result
 * is the store.
 */
export function useWysiwygScrollSpy({
  entries,
  documentId,
  containerId,
  enabled,
}: UseWysiwygScrollSpyOptions): void {
  const setActiveEntry = useTOCStore((state) => state.setActiveEntry);

  // Both maps are one resolution pass's output, replaced wholesale by the observe
  // effect and never merged across passes: a heading element that survives an edit is
  // a coincidence, not an invariant (`tocElementResolution.ts` P1/P2).
  const headingElementsRef = useRef<Map<HeadingKey, Element>>(new Map());
  /** The inverse. The observer callback is handed elements and must get back keys. */
  const elementKeysRef = useRef<Map<Element, HeadingKey>>(new Map());
  /** D7 — the last pass's `(entryCount, domCount)` signature, per hook instance. */
  const mismatchSignatureRef = useRef<string | null>(null);

  // Set up Intersection Observer for spy scrolling
  useEffect(() => {
    if (!enabled || entries.length === 0) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    // One pass, feeding both directions: the observe loop below reads `byKey`, the
    // callback reads `byElement`.
    const resolution = resolveHeadingElements(entries, container);
    headingElementsRef.current = resolution.byKey;
    elementKeysRef.current = resolution.byElement;

    // D7 — one warning per *changed* signature, per hook instance. Unconditional
    // emission would fire once per 300 ms debounce tick for as long as the document
    // holds a heading our parser cannot see.
    const entryCount = entries.length;
    const domCount = resolution.mismatch?.domCount ?? entryCount;
    const signature = `${entryCount}:${domCount}`;
    if (resolution.mismatch && signature !== mismatchSignatureRef.current) {
      loggingService.logEventSync({
        level: "warn",
        event: "ui.toc.resolve.mismatch",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: {
          documentId,
          entryCount,
          domCount,
          resolvedCount: resolution.byKey.size,
        },
      });
    }
    mismatchSignatureRef.current = signature;

    // Keys, not DOM ids: element identity is the only address the observe loop and the
    // callback can agree on, because Milkdown rewrites ids asynchronously (P2).
    const visibleKeys = new Set<HeadingKey>();

    // Create observer with rootMargin for spy scrolling
    // "-66%" means the active heading is one that's in the top 33% of the viewport
    const observer = new IntersectionObserver(
      (observerEntries) => {
        for (const observerEntry of observerEntries) {
          const key = elementKeysRef.current.get(observerEntry.target);
          // A record for an element from a superseded pass is ignored — not thrown on,
          // and never resolved by some other route back to a key.
          if (key === undefined) continue;

          if (observerEntry.isIntersecting) {
            visibleKeys.add(key);
          } else {
            visibleKeys.delete(key);
          }
        }

        // Once per batch, in document order — never once per record in arrival order.
        const activeKey = pickActiveKey(entries, visibleKeys);
        // An emptied visible set RETAINS the previous active entry rather than blanking
        // it (the behaviour `if (visibleHeadings.size > 0)` bought before this rewrite).
        // Scrolling past the last heading must not make the highlight blink off.
        if (activeKey !== null) {
          setActiveEntry(activeKey);
        }
      },
      {
        root: container,
        rootMargin: "0px 0px -66% 0px",
        threshold: 0,
      }
    );

    // Document order: `byKey` is built by iterating `entries`.
    for (const heading of headingElementsRef.current.values()) {
      observer.observe(heading);
    }

    // The observer is captured in this closure rather than held in a ref, so exactly
    // one `disconnect` pairs with each construction even when the effect re-runs.
    return () => {
      observer.disconnect();
    };
  }, [entries, containerId, documentId, enabled, setActiveEntry]);
}
