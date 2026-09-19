import { useEffect, useCallback, useRef, useMemo } from "react";
import { EditorView } from "@codemirror/view";
import { useTOCStore, setNavigationCallback, buildTOCHierarchy } from "../stores/tocStore";
import { asAnchorSlug } from "../types/toc";
import type { HeadingKey, ParsedTOCEntry, TOCEntry } from "../types/toc";
import { parseHeadingsFromContent } from "../services/tocService";
import { useEditorStore } from "../stores/editorStore";
import type { ViewMode } from "../types/editor";

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

  const observerRef = useRef<IntersectionObserver | null>(null);
  const headingElementsRef = useRef<Map<string, Element>>(new Map());
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
    // This is the only reliable approach since CodeMirror doesn't render heading HTML elements
    // with data-heading-id attributes — it renders plain text with syntax highlighting spans.
    if (viewMode === "source" && tocEntry?.lineNumber) {
      const editorView = useEditorStore.getState().editorView;
      if (editorView) {
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
    // The DOM knows headings by anchor slug; the key is ours and never appears there.
    if (!tocEntry) return;
    const anchorSlug = tocEntry.anchorSlug as string;

    // Find the heading element by anchor slug or data attribute
    let heading = container.querySelector(
      `[data-heading-id="${anchorSlug}"], #${CSS.escape(anchorSlug)}`
    );

    // If not found, try to find by matching heading text (for WYSIWYG mode)
    if (!heading) {
      // For Milkdown/ProseMirror, headings are inside .ProseMirror
      const proseMirror = container.querySelector(".ProseMirror");
      const searchRoot = proseMirror || container;

      const headings = searchRoot.querySelectorAll("h1, h2, h3, h4, h5, h6");
      const normalizedTarget = tocEntry.text.replace(/\s+/g, " ").trim();

      for (const h of headings) {
        // Normalize whitespace for comparison
        const text = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (text === normalizedTarget) {
          heading = h;
          break;
        }
      }
    }

    if (heading) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveEntry(headingKey);
    }
  }, [containerId, entries, setActiveEntry, viewMode]);

  useEffect(() => {
    setNavigationCallback(scrollToHeading);
  }, [scrollToHeading]);

  // Set up Intersection Observer for spy scrolling
  useEffect(() => {
    if (!enableSpyScrolling || entries.length === 0) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Track visible headings
    const visibleHeadings = new Set<string>();

    // Create observer with rootMargin for spy scrolling
    // "-66%" means the active heading is one that's in the top 33% of the viewport
    observerRef.current = new IntersectionObserver(
      (observerEntries) => {
        observerEntries.forEach((entry) => {
          const headingId = entry.target.getAttribute("data-heading-id") ||
            entry.target.id;

          if (entry.isIntersecting) {
            visibleHeadings.add(headingId);
          } else {
            visibleHeadings.delete(headingId);
          }
        });

        // Find the topmost visible heading
        if (visibleHeadings.size > 0) {
          // Get all heading elements in document order
          for (const tocEntry of entries) {
            if (visibleHeadings.has(tocEntry.anchorSlug as string)) {
              setActiveEntry(tocEntry.key);
              break;
            }
          }
        }
      },
      {
        root: container,
        rootMargin: "0px 0px -66% 0px",
        threshold: 0,
      }
    );

    // Observe heading elements
    headingElementsRef.current.clear();

    // For Milkdown/ProseMirror, headings are inside .ProseMirror
    const proseMirror = container.querySelector(".ProseMirror");
    const searchRoot = proseMirror || container;

    entries.forEach((tocEntry) => {
      const anchorSlug = tocEntry.anchorSlug as string;
      // First try by anchor slug or data attribute
      let heading = searchRoot.querySelector(
        `[data-heading-id="${anchorSlug}"], #${CSS.escape(anchorSlug)}`
      );

      // Fall back to text matching for WYSIWYG mode
      if (!heading) {
        const headings = searchRoot.querySelectorAll("h1, h2, h3, h4, h5, h6");
        const normalizedTarget = tocEntry.text.replace(/\s+/g, " ").trim();

        for (const h of headings) {
          const text = (h.textContent || "").replace(/\s+/g, " ").trim();
          if (text === normalizedTarget) {
            heading = h;
            break;
          }
        }
      }

      if (heading) {
        headingElementsRef.current.set(anchorSlug, heading);
        observerRef.current?.observe(heading);
      }
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [entries, containerId, enableSpyScrolling, setActiveEntry]);

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
