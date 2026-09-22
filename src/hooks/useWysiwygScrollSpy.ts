/**
 * Purpose: the **WYSIWYG** half of the outline's scroll spy — the IntersectionObserver
 * over the Milkdown surface's heading elements, lifted out of `useTOC` by WI-5b so that
 * `useTOC` can be a router instead of a place where two different spy mechanisms share
 * one function's dependency list.
 *
 * Pipeline:
 *   `resolveHeadingElements` (entries → elements, both directions)
 *   → `IntersectionObserver(root: container, rootMargin: "0px 0px -66% 0px")`
 *   → `pickActiveKey` (document order over the visible set) → `tocStore.setActiveEntry`.
 *   `MutationObserver(container, childList+subtree)` → `mutationTouchesHeadings`
 *   → `headingListChanged` → re-arm the same IntersectionObserver (D14).
 *
 * `@module src/hooks/useWysiwygScrollSpy`
 * `@coordinates-with` `src/utils/tocElementResolution.ts` (both halves of the mapping and
 * the document-order picker), `src/utils/tocSurfaceWatch.ts` (the mutation filter and the
 * staleness test), `src/stores/tocStore.ts` (`activeEntryId`),
 * `src/hooks/useTOC.ts` (the caller — routes by `resolveSpyMode`),
 * `src/hooks/useSourceScrollSpy.ts` (the other mechanism; never live at the same time).
 *
 * Key decisions:
 * - WI-5b was a pure extraction of `useTOC.ts:190-271`: the same observer options, the
 *   same document-order `pickActiveKey`, the same retention-on-empty (DECISION A,
 *   `tests/use-toc-scroll-spy-identity.test.ts:11-22`), the same one-warning-per-changed-
 *   signature `ui.toc.resolve.mismatch` (D7), and one `disconnect` per construction.
 *   Those remain the specification, pinned by that file and
 *   `tests/use-toc-navigation-identity.test.ts`.
 * - **D14 — the effect's deps carry no DOM, so the DOM must be watched.** The effect runs
 *   before `@milkdown/react` has created `.ProseMirror`; it resolved zero headings and
 *   nothing re-armed it until `entries` changed — which a Source→WYSIWYG switch never
 *   does. Milkdown also replaces heading elements (`setNodeMarkup` in
 *   `syncHeadingIdPlugin`), leaving the observer on detached nodes. A `MutationObserver`
 *   on the container now re-arms — unobserve old, clear the visible set, re-resolve,
 *   observe new — whenever the resolved heading list is stale. Still exactly one
 *   IntersectionObserver per effect run; teardown disconnects both observers. Pinned by
 *   `tests/use-wysiwyg-scroll-spy-late-surface.test.ts`.
 * - The mutation filter only re-scans when an added/removed element is or contains an
 *   `hN` or `.ProseMirror`, so typing in a 3,000-heading document does not pay a heading
 *   scan per keystroke.
 * - A re-arm does **not** touch `activeEntryId`: the previous highlight stays until a new
 *   intersection record arrives (the same retention DECISION A buys on an empty set).
 * - D7 on a re-arm is skipped while `.ProseMirror` is absent — a provider teardown is "not
 *   mounted", not a mismatch. The **initial** pass still warns with `domCount: 0` when the
 *   surface is absent: `tests/use-toc-navigation-identity.test.ts` N-3/N-5 pin exactly one
 *   warning in that state, and that recorded behaviour is preserved rather than changed.
 *
 * `enabled` is `resolveSpyMode(enableSpyScrolling, viewMode) === "dom"`, decided by the
 * caller. In Source mode this hook must **never construct an observer at all** — neither
 * observer — because `#source-container` holds no `.ProseMirror`.
 *
 * Logging (rule 20): the D7 mismatch warning and nothing else. There is no per-record or
 * per-mutation log — both callbacks run at scroll/keystroke frequency.
 */
import { useEffect, useRef } from "react";

import { loggingService } from "../services/loggingService";
import { useTOCStore } from "../stores/tocStore";
import type { HeadingKey, TOCEntry } from "../types/toc";
import {
  collectHeadingElements,
  pickActiveKey,
  resolveHeadingElements,
} from "../utils/tocElementResolution";
import { headingListChanged, mutationTouchesHeadings } from "../utils/tocSurfaceWatch";

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
 * Constructs exactly one `IntersectionObserver` and one `MutationObserver` per effect run
 * while `enabled` and the container exists, re-arms the former in place when the
 * container's heading elements change, and disconnects both on every re-run. Returns
 * nothing: the result is the store.
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

  // Set up the Intersection Observer for spy scrolling, and the surface watch that re-arms it
  useEffect(() => {
    if (!enabled || entries.length === 0) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    // Keys, not DOM ids: element identity is the only address the observe loop and the
    // callback can agree on, because Milkdown rewrites ids asynchronously (P2).
    const visibleKeys = new Set<HeadingKey>();
    /** Every `hN` in `.ProseMirror` at the last pass — what staleness is judged against. */
    let domHeadings: Element[] = [];

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
        // it. Scrolling past the last heading must not make the highlight blink off.
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

    const reportMismatch = (resolution: ReturnType<typeof resolveHeadingElements>) => {
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
    };

    /** One resolution pass, feeding both directions, then observe in document order. */
    const arm = (isRearm: boolean) => {
      if (isRearm) {
        for (const heading of headingElementsRef.current.values()) {
          observer.unobserve(heading);
        }
        // The old keys' visibility was reported for old elements; the new ones will
        // report afresh. `activeEntryId` is deliberately left alone until they do.
        visibleKeys.clear();
      }
      domHeadings = collectHeadingElements(container);
      const resolution = resolveHeadingElements(entries, container);
      headingElementsRef.current = resolution.byKey;
      elementKeysRef.current = resolution.byElement;

      // A re-arm with no `.ProseMirror` is a provider teardown, not a mismatch. The
      // initial pass keeps warning in that state (N-3/N-5 pin it).
      if (!isRearm || container.querySelector(".ProseMirror")) {
        reportMismatch(resolution);
      }

      // Document order: `byKey` is built by iterating `entries`.
      for (const heading of resolution.byKey.values()) {
        observer.observe(heading);
      }
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

    // Both observers are captured in this closure rather than held in refs, so exactly
    // one `disconnect` pairs with each construction even when the effect re-runs.
    return () => {
      surfaceWatch.disconnect();
      observer.disconnect();
    };
  }, [entries, containerId, documentId, enabled, setActiveEntry]);
}
