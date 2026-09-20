/**
 * Purpose: the **React wiring** for the source-mode scroll spy — the one place where
 * the three pure units are composed and attached to a live CodeMirror scroller:
 *
 *   `readSpyLineRange` (pixels → lines **+ `atScrollLimit`**) → `pickActiveKeyByLine`
 *   (lines → key) → `retainVisibleActiveKey` (the tail clamp, which applies only at
 *   the scroll limit) → `tocStore.setActiveEntry`.
 *
 * The hook reads **no geometry of its own**. `readSpyLineRange` is the sole seam: it
 * already holds the `scrollDOM` and is the one place allowed to measure it, so the
 * scroll-limit decision arrives here as a boolean on the range and is passed straight
 * through. Recomputing it here would put a second geometry seam in `src/`, and two
 * seams reading the same element drift.
 *
 * `@module src/hooks/useSourceScrollSpy`
 * `@coordinates-with` `src/utils/codemirrorViewportLine.ts` (the sole geometry seam),
 * `src/utils/tocLineSpy.ts` (both pure selectors), `src/stores/editorStore.ts` (the
 * installed `EditorView`), `src/stores/tocStore.ts` (`activeEntryId`),
 * `src/hooks/useTOC.ts` (the caller — WI-5 routes by `resolveSpyMode`).
 *
 * ---------------------------------------------------------------------------
 * Why this is its own file and not three more effects inside `useTOC`
 * ---------------------------------------------------------------------------
 * `useTOC.ts` is at 292 lines against rule 50 §6's 300-line cap, and it already owns a
 * debounced parser, a navigation callback and an `IntersectionObserver`. A fourth
 * concern with its own refs and its own teardown rules would push it over the cap and
 * put two *different* spy mechanisms — DOM-intersection for WYSIWYG, line-arithmetic
 * for source — in one function where a reader cannot tell which deps belong to which.
 *
 * ---------------------------------------------------------------------------
 * The deps split is the whole design. Getting it wrong has two named costs.
 * ---------------------------------------------------------------------------
 * `entries` gets a **new array identity on every 300 ms debounced parse**, i.e. at
 * typing speed. That forces the split below, and each half pays for a different bug:
 *
 *   - **The listener effect's deps are `[editorView, enabled, schedule]` and must never
 *     contain `entries` or `documentId`** (`schedule` is stable while `setActiveEntry`
 *     is). `entries` in these deps re-attaches the listener — and re-emits the attach
 *     log — on every keystroke, flooding `~/.mdpro/mdpro.log`. That is rule 20's
 *     "no per-scroll logging" arriving by a different door, and it is risk R-5.
 *   - **A second, cheap effect keyed on `[entries, documentId]` updates the refs and
 *     re-samples** (plan amendment A-7). Not a nicety: `tocStore.ts:199-200` is
 *     `carriedActive !== null && present.has(carriedActive) ? carriedActive : null`, so
 *     **every document switch nulls `activeEntryId`** — and so does a same-document
 *     re-parse the moment the active heading's key is retired (changing its level or
 *     ordinal). Without the re-sample the outline goes blank on every Source-mode tab
 *     switch, and mid-typing while editing the active heading, and **stays blank until
 *     the user happens to scroll**.
 *
 * Effect declaration order matters and is deliberate. React runs all destroys before all
 * creates, then creates in declaration order, so on a commit that changes both `entries`
 * and `editorView` the sequence is: listener destroy (which clears `attachedViewRef`, so
 * the ref effect cannot schedule against the departing view) → ref effect → listener
 * attach with the fresh refs already in place.
 *
 * ---------------------------------------------------------------------------
 * `null` from the geometry seam means RETAIN. It does not mean detach.
 * ---------------------------------------------------------------------------
 * A zero-height or unlaid-out `scrollDOM` is the production shape of **every** mode
 * toggle and every remount for the frame before layout, and `readSpyLineRange` answers
 * `null` for it. Detaching on `null` would therefore kill the spy permanently on the
 * first mode toggle — and it would still *look* plausible to a human, because a frozen
 * highlight is not obviously a broken one. The frame returns without writing and the
 * listener stays; the next healthy frame recovers.
 *
 * ---------------------------------------------------------------------------
 * Throttling, and the two filters that stop redundant renders
 * ---------------------------------------------------------------------------
 * At most one pending animation frame exists at a time; N scroll events inside one frame
 * collapse to one sample, read at **frame** time so it reflects the final scroll
 * position rather than the first event's. On top of that, the store is written only when
 * the composed key **differs** from the one already active — without it the whole
 * sidebar re-renders on every frame of a scroll.
 *
 * ---------------------------------------------------------------------------
 * Logging (rule 20)
 * ---------------------------------------------------------------------------
 * One `ui.toc.spy.attach` per attach and one `ui.toc.spy.detach` per teardown. **Nothing
 * per scroll and nothing per sample** — this runs once per animation frame while the
 * user scrolls, so a line here would write thousands per gesture. Same reasoning
 * `tocStore.resetCoordination` and `codemirrorViewportLine.ts` already record.
 */
import { useCallback, useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";

import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import { useTOCStore } from "../stores/tocStore";
import type { TOCEntry } from "../types/toc";
import { readSpyLineRange } from "../utils/codemirrorViewportLine";
import { pickActiveKeyByLine, retainVisibleActiveKey } from "../utils/tocLineSpy";

export interface UseSourceScrollSpyOptions {
  /** The current document's headings, in document order. New identity per re-parse. */
  entries: readonly TOCEntry[];
  /** Id of the document `entries` came from. Logged, and a re-sample trigger. */
  documentId: string | null;
  /**
   * Whether the source spy owns the highlight right now. WI-5 derives this from
   * `resolveSpyMode(enableSpyScrolling, viewMode)`; this hook only obeys it.
   */
  enabled: boolean;
}

/**
 * Keep `tocStore.activeEntryId` in step with the source editor's scroll position.
 *
 * Attaches exactly one passive `scroll` listener to `editorView.scrollDOM` while
 * `enabled` and a view is installed, and none otherwise. Samples once at attach time (so
 * entering Source mode highlights without requiring a scroll) and again whenever
 * `entries` or `documentId` change (so a tab switch does not blank the outline).
 * Returns nothing: the result is the store.
 */
export function useSourceScrollSpy({
  entries,
  documentId,
  enabled,
}: UseSourceScrollSpyOptions): void {
  const editorView = useEditorStore((state) => state.editorView);
  const setActiveEntry = useTOCStore((state) => state.setActiveEntry);

  // Refs, not deps: see the header. These are the values the frame callback reads.
  const entriesRef = useRef<readonly TOCEntry[]>(entries);
  const documentIdRef = useRef<string | null>(documentId);
  /**
   * The view this hook currently owns a listener on, or `null`. Set and cleared **only**
   * by the listener effect, which makes "is the spy live?" a single fact rather than a
   * conjunction of `enabled` and `editorView` re-derived in three places — and makes it
   * impossible for the re-sample effect to schedule work while nothing is attached.
   */
  const attachedViewRef = useRef<EditorView | null>(null);
  const frameRef = useRef<number | null>(null);

  const sample = useCallback(() => {
    const view = attachedViewRef.current;
    if (!view) return;

    const range = readSpyLineRange(view);
    // RETAIN, never blank and never detach. See the header.
    if (range === null) return;

    const list = entriesRef.current;
    // `getState()` and not a subscribed value: the callback runs a frame later than the
    // render that created it, so a captured `activeEntryId` would be stale (rule 50 §1).
    const currentKey = useTOCStore.getState().activeEntryId;
    const picked = pickActiveKeyByLine(list, range.topLine);
    const next = retainVisibleActiveKey(
      picked,
      currentKey,
      list,
      range.topLine,
      range.bottomLine,
      range.atScrollLimit,
    );

    // Two filters in one condition: `null` is the retain-on-null step the pure layer
    // deliberately left to its caller, and `!== currentKey` is the redundancy filter
    // that stops a sidebar re-render on every frame of a scroll.
    if (next !== null && next !== currentKey) setActiveEntry(next);
  }, [setActiveEntry]);

  const schedule = useCallback(() => {
    if (!attachedViewRef.current) return;
    // One pending frame maximum; the sample is read when it fires, not now.
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      sample();
    });
  }, [sample]);

  // Declared FIRST so that on an update it runs after the listener effect's destroy and
  // before its create — see the header's note on effect ordering.
  useEffect(() => {
    entriesRef.current = entries;
    documentIdRef.current = documentId;
    // A-7 — re-sample without re-attaching. No-ops when nothing is attached.
    schedule();
  }, [entries, documentId, schedule]);

  useEffect(() => {
    if (!enabled || !editorView) return;
    const scroller = editorView.scrollDOM;
    if (!scroller) return;

    attachedViewRef.current = editorView;

    loggingService.logEventSync({
      level: "info",
      event: "ui.toc.spy.attach",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        documentId: documentIdRef.current,
        entryCount: entriesRef.current.length,
        mode: "source",
      },
    });

    const onScroll = () => schedule();
    // `passive`: the handler never calls `preventDefault`, and saying so keeps the
    // scroll off the main thread's critical path.
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // AC 9 — one sample at attach time, so entering Source mode highlights correctly
    // without requiring the user to scroll.
    schedule();

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      // The cancel lives HERE, in the effect that owns both the listener and the
      // pending-frame ref — not in a mount-scoped `[]` effect. A `[]`-dep cancel fires
      // only on unmount, so a frame pending across a **view swap** or a **disable**
      // survives and then writes a key computed from the departing view's geometry:
      // the outline jumps for no reason the user can see.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      attachedViewRef.current = null;

      loggingService.logEventSync({
        level: "info",
        event: "ui.toc.spy.detach",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: { documentId: documentIdRef.current, mode: "source" },
      });
    };
  }, [editorView, enabled, schedule]);
}
