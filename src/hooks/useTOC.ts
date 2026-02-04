import { useEffect, useCallback, useRef, useMemo } from "react";
import { useTOCStore, setNavigationCallback, buildTOCHierarchy } from "../stores/tocStore";
import type { TOCEntry } from "../stores/tocStore";
import { parseHeadingsFromContent } from "../services/tocService";

interface UseTOCOptions {
  /** Document content to parse for headings */
  content: string;
  /** ID of the editor/preview container element */
  containerId?: string;
  /** Debounce delay for content parsing (ms) */
  debounceMs?: number;
  /** Whether to enable spy scrolling */
  enableSpyScrolling?: boolean;
}

interface UseTOCReturn {
  /** Flat list of TOC entries */
  entries: TOCEntry[];
  /** Hierarchical TOC structure */
  hierarchy: TOCEntry[];
  /** Currently active entry ID (from scroll position) */
  activeEntryId: string | null;
  /** Whether TOC sidebar is visible */
  isVisible: boolean;
  /** Toggle TOC visibility */
  toggleVisibility: () => void;
  /** Navigate to a specific heading */
  navigateToEntry: (id: string) => void;
  /** Collapsed entry IDs */
  collapsedIds: Set<string>;
  /** Toggle collapsed state */
  toggleCollapsed: (id: string) => void;
}

/**
 * Hook for managing Table of Contents state and spy scrolling
 */
export function useTOC({
  content,
  containerId = "editor-container",
  debounceMs = 300,
  enableSpyScrolling = true,
}: UseTOCOptions): UseTOCReturn {
  const {
    entries,
    activeEntryId,
    isVisible,
    collapsedIds,
    setEntries,
    setActiveEntry,
    toggleVisibility,
    toggleCollapsed,
  } = useTOCStore();

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
      const tocEntries: TOCEntry[] = headings.map((h) => ({
        id: h.id,
        level: h.level as 1 | 2 | 3 | 4 | 5 | 6,
        text: h.text,
        lineNumber: h.line,
        offset: h.offset,
        isActive: false,
        children: [],
      }));
      setEntries(tocEntries);
    }, debounceMs);

    return () => {
      if (parseTimeoutRef.current) {
        clearTimeout(parseTimeoutRef.current);
      }
    };
  }, [content, debounceMs, setEntries]);

  // Build hierarchical structure
  const hierarchy = useMemo(() => buildTOCHierarchy(entries), [entries]);

  // Set up navigation callback
  const scrollToHeading = useCallback((headingId: string) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Find the heading element by ID or data attribute
    let heading = container.querySelector(
      `[data-heading-id="${headingId}"], #${CSS.escape(headingId)}`
    );

    // If not found, try to find by matching heading text (for WYSIWYG mode)
    if (!heading) {
      const tocEntry = entries.find((e) => e.id === headingId);
      if (tocEntry) {
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
    }

    if (heading) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveEntry(headingId);
    }
  }, [containerId, entries, setActiveEntry]);

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
            if (visibleHeadings.has(tocEntry.id)) {
              setActiveEntry(tocEntry.id);
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
      // First try by ID or data attribute
      let heading = searchRoot.querySelector(
        `[data-heading-id="${tocEntry.id}"], #${CSS.escape(tocEntry.id)}`
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
        headingElementsRef.current.set(tocEntry.id, heading);
        observerRef.current?.observe(heading);
      }
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [entries, containerId, enableSpyScrolling, setActiveEntry]);

  // Navigate to entry handler
  const navigateToEntry = useCallback((id: string) => {
    scrollToHeading(id);
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
