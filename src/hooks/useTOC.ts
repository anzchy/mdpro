import { useEffect, useCallback, useRef, useMemo } from "react";
import { EditorView } from "@codemirror/view";
import { useTOCStore, setNavigationCallback, buildTOCHierarchy } from "../stores/tocStore";
import { asAnchorSlug } from "../types/toc";
import type { HeadingKey, ParsedTOCEntry, TOCEntry } from "../types/toc";
import { parseHeadingsFromContent } from "../services/tocService";
import { useEditorStore } from "../stores/editorStore";
import type { ViewMode } from "../types/editor";
import { pickActiveKey, resolveHeadingElements } from "../utils/tocElementResolution";
import { loggingService } from "../services/loggingService";

interface UseTOCOptions {
  /** Document content to parse for headings */
  content: string;
  /**
   * Id of the document `content` came from — paired with it so a debounced parse that
   * lands after a tab switch cannot be attributed to the wrong document. Supplied by
   * the owner of document selection (`App.tsx`), never read from `documentStore` here:
   * importing the document store would couple two features that must change apart, and
   * would reintroduce the stale-read the pairing exists to remove.
   *
   * **Required, with no default.** `null` is a real value meaning "no document open"
   * and the store handles it explicitly; a defaulted parameter would instead let a
   * caller silently drop the pairing and get the same behaviour as "no document".
   */
  documentId: string | null;
  /** ID of the editor/preview container element */
  containerId?: string;
  /** Debounce delay for content parsing (ms) */
  debounceMs?: number;
  /** Whether to enable spy scrolling */
  enableSpyScrolling?: boolean;
  /** Current view mode — used to choose the right scroll strategy */
  viewMode?: ViewMode;
}

interface UseTOCReturn {
  /** Flat list of TOC entries */
  entries: TOCEntry[];
  /** Hierarchical TOC structure */
  hierarchy: TOCEntry[];
  /** Currently active entry, by coordination key (from scroll position) */
  activeEntryId: HeadingKey | null;
  /** Whether TOC sidebar is visible */
  isVisible: boolean;
  /** Toggle TOC visibility */
  toggleVisibility: () => void;
  /** Navigate to a specific heading, by coordination key */
  navigateToEntry: (key: HeadingKey) => void;
  /** Collapsed entries, by coordination key */
  collapsedIds: Set<HeadingKey>;
  /** Toggle collapsed state */
  toggleCollapsed: (key: HeadingKey) => void;
}

/**
 * Hook for managing Table of Contents state and spy scrolling
 */
export function useTOC({
  content,
  documentId,
  containerId = "editor-container",
  debounceMs = 300,
  enableSpyScrolling = true,
  viewMode,
}: UseTOCOptions): UseTOCReturn {
  // Per-field selectors, not a whole-store destructure (rule 50 §1). A bare
  // `useTOCStore()` subscribes to the state object's identity, so the per-document
  // archive bookkeeping (`documentId` / `byDocument`) — which this hook never reads —
  // would re-render `App` on every keystroke's debounce tick.
  const entries = useTOCStore((state) => state.entries);
  const activeEntryId = useTOCStore((state) => state.activeEntryId);
  const isVisible = useTOCStore((state) => state.isVisible);
  const collapsedIds = useTOCStore((state) => state.collapsedIds);
  const setEntries = useTOCStore((state) => state.setEntries);
  const setActiveEntry = useTOCStore((state) => state.setActiveEntry);
  const toggleVisibility = useTOCStore((state) => state.toggleVisibility);
  const toggleCollapsed = useTOCStore((state) => state.toggleCollapsed);

  // Both maps are one resolution pass's output, replaced wholesale by the observe
  // effect and never merged across passes: a heading element that survives an edit is
  // a coincidence, not an invariant (`tocElementResolution.ts` P1/P2).
  const headingElementsRef = useRef<Map<HeadingKey, Element>>(new Map());
  /** The inverse. The observer callback is handed elements and must get back keys. */
  const elementKeysRef = useRef<Map<Element, HeadingKey>>(new Map());
  /** D7 — the last pass's `(entryCount, domCount)` signature, per hook instance. */
  const mismatchSignatureRef = useRef<string | null>(null);
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse headings from content (debounced)
  useEffect(() => {
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
    }

    parseTimeoutRef.current = setTimeout(() => {
      const headings = parseHeadingsFromContent(content);
      // The parser produces anchor slugs, never keys — `ParsedTOCEntry` makes that a
      // compile-time guarantee. `setEntries` mints the keys.
      const tocEntries: ParsedTOCEntry[] = headings.map((h) => ({
        anchorSlug: asAnchorSlug(h.id),
        level: h.level as 1 | 2 | 3 | 4 | 5 | 6,
        text: h.text,
        lineNumber: h.line,
        offset: h.offset,
      }));
      setEntries(tocEntries, documentId);
    }, debounceMs);

    // Cancellation, not a post-hoc guard, is what pairs `(content, documentId)`: this
    // cleanup runs on *any* dependency change, so a document switch clears the pending
    // timeout before it can fire. No `getState()` re-read and no "is this still the
    // current document?" branch is needed, and adding one would be a second, weaker
    // answer to a question already settled here.
    return () => {
      if (parseTimeoutRef.current) {
        clearTimeout(parseTimeoutRef.current);
      }
    };
    // `documentId` belongs in the deps even though `content` usually changes too: two
    // documents can hold identical content (two empty buffers is the common case), and
    // without it the effect would not re-run and B would inherit A's entries.
  }, [content, documentId, debounceMs, setEntries]);

  // Build hierarchical structure
  const hierarchy = useMemo(() => buildTOCHierarchy(entries), [entries]);

  // Set up navigation callback
  const scrollToHeading = useCallback((headingKey: HeadingKey) => {
    const tocEntry = entries.find((e) => e.key === headingKey);

    // For source (CodeMirror) mode, use the editor's scroll API to navigate by line number.
    // This is the only reliable approach because the source surface renders markdown as
    // syntax-highlighted text: there is no heading element to scroll to, so the
    // document-order correspondence the WYSIWYG path uses has nothing to correspond with.
    //
    // D4 — the guard is `viewMode === "source"` **alone**. It used to also require a
    // truthy `tocEntry?.lineNumber`, which made `lineNumber: 0` fall *past* this branch
    // into the WYSIWYG DOM path and scroll a heading element while in source mode. The
    // Lezer parser is 1-indexed and cannot emit `0` today, so nothing reached it — but
    // that conjunct was the only route by which source mode could reach
    // `resolveHeadingElements` at all, and "unreachable today" is not a property a later
    // edit preserves. Closing it here means the mode, not the payload, decides the branch.
    if (viewMode === "source") {
      const editorView = useEditorStore.getState().editorView;
      if (editorView && tocEntry) {
        try {
          const lineCount = editorView.state.doc.lines;
          const targetLine = Math.min(tocEntry.lineNumber, lineCount);
          const pos = editorView.state.doc.line(targetLine).from;
          editorView.dispatch({
            effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }),
          });
          setActiveEntry(headingKey);
        } catch {
          // line number out of range — ignore
        }
      }
      // In source mode there is no preview pane to scroll; we're done.
      return;
    }

    // DOM-based scroll: used for wysiwyg mode.
    const container = document.getElementById(containerId);
    if (!container) return;
    // D2 — neither the key nor the anchor slug is ever a DOM address. The entry is
    // needed only to reject a key that no longer names a live heading.
    if (!tocEntry) return;

    // Resolved fresh on every navigation rather than read from `headingElementsRef`:
    // the editor replaces heading nodes on every edit, and the observe effect does not
    // re-run for a DOM change (its deps carry no DOM). A cached element would be
    // detached — `scrollIntoView` on it is a silent no-op the user reads as a dead link.
    const { byKey } = resolveHeadingElements(entries, container);
    const heading = byKey.get(headingKey);
    // Unresolved is a no-op, never a fallback: the fallbacks this replaced (a DOM-id
    // lookup, then a first-text-match scan) are exactly how a duplicate heading scrolled
    // to the wrong element.
    if (!heading) return;

    heading.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveEntry(headingKey);
  }, [containerId, entries, setActiveEntry, viewMode]);

  useEffect(() => {
    setNavigationCallback(scrollToHeading);
  }, [scrollToHeading]);

  // Set up Intersection Observer for spy scrolling
  useEffect(() => {
    if (!enableSpyScrolling || entries.length === 0) return;

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
  }, [entries, containerId, documentId, enableSpyScrolling, setActiveEntry]);

  // Navigate to entry handler
  const navigateToEntry = useCallback((key: HeadingKey) => {
    scrollToHeading(key);
  }, [scrollToHeading]);

  return {
    entries,
    hierarchy,
    activeEntryId,
    isVisible,
    toggleVisibility,
    navigateToEntry,
    collapsedIds,
    toggleCollapsed,
  };
}
