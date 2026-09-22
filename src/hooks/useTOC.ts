/**
 * Purpose: the outline's single entry point — parse the document into headings, expose
 * the list and the navigation callback, and **route the highlight to whichever scroll
 * spy the current surface can actually observe**.
 *
 * Pipeline:
 *   `content` → 300 ms debounced `parseHeadingsFromContent` → `tocStore.setEntries`
 *   `(enableSpyScrolling, viewMode)` → `resolveSpyMode` → one of
 *       `"dom"`  → `useWysiwygScrollSpy` (geometric: Milkdown heading rects at the 40px anchor)
 *       `"line"` → `useSourceScrollSpy`  (CodeMirror line sampling at the 40px anchor)
 *       `"off"`  → neither
 *   `navigateToEntry` → `scrollToHeading` (branches on `viewMode` for the same reason);
 *       both branches land the heading at the 40px anchor, instantly (D17 WI-5)
 *
 * `@module src/hooks/useTOC`
 * `@coordinates-with` `src/utils/tocSpyMode.ts` (the routing decision),
 * `src/hooks/useWysiwygScrollSpy.ts` and `src/hooks/useSourceScrollSpy.ts` (the two
 * mechanisms), `src/utils/scrollAnchor/milkdown.ts` (`scrollHeadingToAnchor`),
 * `src/stores/tocStore.ts`, `src/stores/editorStore.ts` (the installed `EditorView`),
 * `src/services/tocService.ts`, `src/App.tsx` (the only caller).
 *
 * ---------------------------------------------------------------------------
 * Key decision — routing, not a boolean, and the caller no longer gets a vote
 * ---------------------------------------------------------------------------
 * `App.tsx` used to pass `enableSpyScrolling: viewMode !== "source"`, which turned the
 * spy **off** in Source mode: the DOM observer was the only mechanism, `#source-container`
 * holds no `.ProseMirror`, so leaving it on would have armed an observer over zero
 * elements. Deleting that argument (WI-5) is the fix, not a tidy-up — with two mechanisms
 * available, "which surface is this?" is a routing question, and a caller-computed
 * boolean can only answer it by encoding the routing table at the call site, where the
 * next surface will not think to update it. `enableSpyScrolling` survives as what its
 * name says: a master switch, defaulting to `true`.
 *
 * Both spy hooks are called **unconditionally** and told `enabled`; exactly one is live
 * at a time. Calling them behind an `if` would violate the rules of hooks, and gating
 * inside each hook keeps its own refs and teardown correct across the transition.
 *
 * ---------------------------------------------------------------------------
 * Key decision — the two spy mechanisms live in their own files
 * ---------------------------------------------------------------------------
 * Geometric heading-rect sampling (WYSIWYG, ADR-0026) and line arithmetic (Source) have
 * different refs, deps and teardown rules. Kept here they shared one dependency list, where
 * a reader could not tell which dep belonged to which — and the file stood at 293 of rule
 * 50 §6's 300 lines. This file is now the router and the parser; each mechanism documents
 * its own invariants next to the code that has to honour them.
 */
import { useEffect, useCallback, useRef, useMemo } from "react";
import { EditorView } from "@codemirror/view";
import { useTOCStore, setNavigationCallback, buildTOCHierarchy } from "../stores/tocStore";
import { asAnchorSlug } from "../types/toc";
import type { HeadingKey, ParsedTOCEntry, TOCEntry } from "../types/toc";
import { parseHeadingsFromContent } from "../services/tocService";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import type { ViewMode } from "../types/editor";
import { resolveHeadingElements } from "../utils/tocElementResolution";
import { SPY_ANCHOR_OFFSET_PX } from "../utils/codemirrorViewportLine";
import { scrollHeadingToAnchor } from "../utils/scrollAnchor/milkdown";
import { resolveSpyMode } from "../utils/tocSpyMode";
import { useSourceScrollSpy } from "./useSourceScrollSpy";
import { useWysiwygScrollSpy } from "./useWysiwygScrollSpy";

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
  /**
   * Master switch for spy scrolling, defaulting to `true`. It says *whether* the
   * outline follows the scroll position, never *how*: callers must not use it to
   * suppress a mode whose mechanism they think is missing — that is `viewMode`'s job,
   * and `resolveSpyMode` is where the two combine.
   */
  enableSpyScrolling?: boolean;
  /**
   * Current view mode. Chooses the scroll spy mechanism (`resolveSpyMode`) and the
   * navigation strategy in `scrollToHeading`. `undefined` is treated as WYSIWYG.
   */
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
 * Manage Table of Contents state: parse headings from `content`, publish them to
 * `tocStore`, install the navigation callback, and route scroll-spy duty to the one
 * mechanism the current `viewMode` can observe.
 *
 * The returned shape is stable across this routing change — WI-5 added no member and
 * removed none.
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

  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The routing decision, in one place. Derived on every render rather than memoised:
  // it is a two-argument lookup over primitives, and a `useMemo` here would cost more
  // than it saves while adding a dependency array that can go stale.
  const spyMode = resolveSpyMode(enableSpyScrolling, viewMode);

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
            effects: EditorView.scrollIntoView(pos, {
              y: "start",
              yMargin: SPY_ANCHOR_OFFSET_PX,
            }),
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

    // Resolved fresh on every navigation, never cached: the editor replaces heading
    // nodes on every edit, and a cached element would be detached — its rect is empty,
    // so the scroll lands nowhere useful. The geometric spy (ADR-0026) re-resolves on
    // every DOM mutation for the same reason.
    const { byKey } = resolveHeadingElements(entries, container);
    const heading = byKey.get(headingKey);
    // Unresolved is a no-op, never a fallback: the fallbacks this replaced (a DOM-id
    // lookup, then a first-text-match scan) are exactly how a duplicate heading scrolled
    // to the wrong element.
    if (!heading) return;

    // D17 WI-5 — instant, landing at the spy's anchor line (Source parity), so the next
    // spy frame picks the clicked heading rather than one passed during a smooth scroll.
    // A scroll that threw moved nothing, so the old highlight is still the true one.
    if (!scrollHeadingToAnchor(container, heading)) {
      loggingService.logEventSync({
        level: "warn",
        event: "ui.toc.navigate",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: { documentId, entryIndex: entries.indexOf(tocEntry), entryKey: headingKey },
      });
      return;
    }
    // Conditional: a repeat click on the shown heading writes nothing (N-6).
    if (useTOCStore.getState().activeEntryId !== headingKey) setActiveEntry(headingKey);
  }, [containerId, documentId, entries, setActiveEntry, viewMode]);

  useEffect(() => {
    setNavigationCallback(scrollToHeading);
  }, [scrollToHeading]);

  // Scroll spy, routed. Both hooks are called on every render — the rules of hooks
  // leave no choice — and exactly one of them is `enabled`. In `"off"` mode neither is,
  // which is the only state where the highlight stops following the scroll position.
  useWysiwygScrollSpy({
    entries,
    documentId,
    containerId,
    enabled: spyMode === "dom",
  });
  // No `containerId`: the source spy reads `editorStore.editorView.scrollDOM` rather
  // than a DOM id, because CodeMirror owns its own scroller and the id `App.tsx` passes
  // for source mode names the wrapper around it, not the element that scrolls.
  useSourceScrollSpy({
    entries,
    documentId,
    enabled: spyMode === "line",
  });

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
