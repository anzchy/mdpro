/**
 * Purpose: shared harness for the D17 WI-4 WYSIWYG scroll-spy suites — `useTOC` rendered
 * over a `scriptedScrollGeometry` surface, plus the oracle every case compares against.
 * Contract: WI-4 of `.claude/tdd-guardian/tests-20260922-210708.md` (Revision 1).
 *
 * New exports live HERE rather than in `scriptedScrollGeometry.ts` /
 * `geometricIntersectionObserver.ts`: those two files are fingerprinted by WI-3's red
 * receipt (`D17-WI-3`) and must not change on the way to green.
 *
 * The oracle is the specification, restated independently of `src/`: the active heading
 * is the LAST heading whose top is at or above `SPY_ANCHOR_OFFSET_PX` below the scroller
 * top (ADR-0026). It is computed from `ScriptedSurface.relTop` (or a caller's `relTop`),
 * never from the code under test.
 */
import { act, renderHook } from "@testing-library/react";
import { expect, vi } from "vitest";

import { useTOC } from "../../src/hooks/useTOC";
import { useTOCStore } from "../../src/stores/tocStore";
import type { ViewMode } from "../../src/types/editor";
import type { HeadingKey, TOCEntry } from "../../src/types/toc";
import { SPY_ANCHOR_OFFSET_PX } from "../../src/utils/codemirrorViewportLine";
import {
  frame as ioFrame,
  installGeometricIntersectionObserver,
} from "./geometricIntersectionObserver";
import {
  mountScriptedSurface,
  type ScriptedHeading,
  type ScriptedSurface,
  type ScriptedSurfaceOptions,
} from "./scriptedScrollGeometry";

export const CONTAINER_ID = "milkdown-container";

const realSetEntries = useTOCStore.getState().setEntries;

export function resetTocStore(): void {
  useTOCStore.setState({
    entries: [],
    documentId: null,
    activeEntryId: null,
    isVisible: false,
    collapsedIds: new Set<HeadingKey>(),
    byDocument: new Map(),
    setEntries: realSetEntries,
  });
}

/** An empty `#milkdown-container` appended to the body (the spy's `root`). */
export function mountContainer(id: string = CONTAINER_ID): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

export interface SpyProps {
  content: string;
  documentId: string | null;
  viewMode?: ViewMode;
  containerId?: string;
  enableSpyScrolling?: boolean;
}

export function renderSpy(initialProps: SpyProps) {
  return renderHook(
    (p: SpyProps) =>
      useTOC({
        content: p.content,
        documentId: p.documentId,
        containerId: p.containerId ?? CONTAINER_ID,
        viewMode: p.viewMode ?? "wysiwyg",
        enableSpyScrolling: p.enableSpyScrolling ?? true,
      }),
    { initialProps },
  );
}

export function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** MutationObserver records are microtasks; fake timers do not fake them. */
export async function flushMutations(): Promise<void> {
  await act(async () => {});
}

export function entries(): TOCEntry[] {
  return useTOCStore.getState().entries;
}

export function active(): HeadingKey | null {
  return useTOCStore.getState().activeEntryId;
}

export function preset(key: HeadingKey | null): void {
  act(() => useTOCStore.getState().setActiveEntry(key));
}

/** Standing rule H2: entry keys are pairwise distinct, so a key names one heading. */
export function expectDistinctKeys(where: string, count?: number): void {
  const keys = entries().map((e) => e.key);
  if (count !== undefined) expect(keys, where).toHaveLength(count);
  expect(new Set(keys).size, `${where}: H2 — keys must be pairwise distinct`).toBe(keys.length);
}

/** Markdown whose parsed headings are exactly `headings`, in order. */
export function contentOf(headings: readonly Pick<ScriptedHeading, "level" | "text">[]): string {
  return headings.map((h) => `${"#".repeat(h.level)} ${h.text}\n\nbody`).join("\n\n");
}

/** `n` level-2 headings with distinct texts; `body(i)` gives each section's body height. */
export function makeHeadings(
  n: number,
  body: (i: number) => number = () => 400,
  height = 40,
): ScriptedHeading[] {
  return Array.from({ length: n }, (_, i) => ({
    level: 2 as const,
    text: `Section ${i}`,
    height,
    bodyHeight: body(i),
  }));
}

/** The last index with `relTop(i) <= SPY_ANCHOR_OFFSET_PX`, or null. Linear, independent. */
export function oracleIndex(count: number, relTop: (i: number) => number): number | null {
  let found: number | null = null;
  for (let i = 0; i < count; i++) if (relTop(i) <= SPY_ANCHOR_OFFSET_PX) found = i;
  return found;
}

export function oracle(surface: ScriptedSurface): number | null {
  return oracleIndex(surface.headings.length, (i) => surface.relTop(i));
}

export function keyAt(index: number | null): HeadingKey | null {
  return index === null ? null : entries()[index].key;
}

/** A `scrollTop` write (the fixture emits `scroll` when the clamped value changes). */
export function scrollTo(surface: ScriptedSurface, top: number): void {
  act(() => {
    surface.scroller.scrollTop = top;
  });
}

/**
 * One rendering update: rAF callbacks, then the IO double's compute-and-deliver (a no-op
 * once nothing constructs an IntersectionObserver). Same step the WI-3 suite uses, so the
 * pre-D17 spy fails these cases on the assertion rather than by never being driven.
 */
export function frame(): void {
  ioFrame();
}

const tracked: ScriptedSurface[] = [];

/**
 * Install the geometric IntersectionObserver double as a DETECTOR (matrix §0): after
 * WI-4 nothing constructs it. It measures through `peekRect`, so it never touches the
 * rect-read counters the cases own.
 */
export function installIoDetector(): void {
  tracked.length = 0;
  installGeometricIntersectionObserver({
    measure: (el) => {
      for (const s of tracked) {
        const r = s.peekRect(el);
        if (r) return r;
      }
      return el.getBoundingClientRect();
    },
  });
}

/** `mountScriptedSurface`, registered with the IO detector's uncounted measure. */
export function mountSurface(
  container: HTMLElement,
  options: ScriptedSurfaceOptions,
): ScriptedSurface {
  const surface = mountScriptedSurface(container, options);
  tracked.push(surface);
  return surface;
}

export function scrollAndFrame(surface: ScriptedSurface, top: number): void {
  scrollTo(surface, top);
  frame();
}

/** Scroll so heading `i`'s top sits `rel` px below the scroller top, then a frame. */
export function scrollHeadingTo(surface: ScriptedSurface, i: number, rel: number): void {
  scrollAndFrame(surface, surface.scrollTopForHeadingAt(i, rel));
}

export function headingReads(surface: ScriptedSurface): number {
  return surface.rectReads.headings.reduce((a, b) => a + b, 0);
}

/** Upper bound on heading rect reads for one recompute over `n` headings. */
export function readBudget(n: number): number {
  return Math.ceil(Math.log2(n)) + 2;
}

/**
 * `activeEntryId` writes, counted mock-free with `tocStore.subscribe`. Zustand notifies on
 * every `set`, even a same-value one, so an unconditional `setActiveEntry` is visible.
 * Notifications from `setEntries` (a new `entries` array) are not spy writes and are
 * excluded.
 */
export function recordWrites(): { writes: Array<HeadingKey | null>; stop: () => void } {
  const writes: Array<HeadingKey | null> = [];
  const stop = useTOCStore.subscribe((state, prev) => {
    if (state.entries !== prev.entries) return;
    writes.push(state.activeEntryId);
  });
  return { writes, stop };
}

/**
 * `setNodeMarkup`'s DOM face: heading `i` becomes a new element with the same text and
 * the same scripted geometry (reads on it count as heading `i`). Reads on the detached
 * old element are diverted to `staleReads()`.
 */
export function replaceScriptedHeading(surface: ScriptedSurface, i: number) {
  const old = surface.headings[i];
  const fresh = document.createElement(old.tagName.toLowerCase());
  fresh.textContent = old.textContent;
  fresh.getBoundingClientRect = old.getBoundingClientRect;
  fresh.scrollIntoView = old.scrollIntoView;
  let stale = 0;
  const peek = () => surface.peekRect(fresh) as DOMRect;
  old.getBoundingClientRect = () => {
    stale += 1;
    return peek();
  };
  old.replaceWith(fresh);
  surface.headings[i] = fresh;
  return { old, fresh, staleReads: () => stale };
}

/**
 * Move every heading `delta` px down WITHOUT a `scrollTop` write (an image loading above
 * them). Wraps each heading's counted rect reader; returns the shifted `relTop`.
 */
export function shiftLayout(surface: ScriptedSurface, delta: number): (i: number) => number {
  for (const el of surface.headings) {
    const read = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => {
      const r = read();
      return { ...r, top: r.top + delta, bottom: r.bottom + delta, y: r.y + delta } as DOMRect;
    };
  }
  return (i) => surface.relTop(i) + delta;
}

/** Report `0/0` scroll metrics (unlaid-out), or restore the fixture's real ones. */
export function setLaidOut(surface: ScriptedSurface, laidOut: boolean): void {
  Object.defineProperty(surface.scroller, "clientHeight", {
    configurable: true,
    get: () => (laidOut ? surface.viewHeight : 0),
  });
  Object.defineProperty(surface.scroller, "scrollHeight", {
    configurable: true,
    get: () => (laidOut ? surface.scrollHeight : 0),
  });
}
