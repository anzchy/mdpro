/**
 * Purpose: shared setup for the WYSIWYG click-to-navigate LANDING suites (D17 WI-5):
 * `useTOC` rendered over a `scriptedScrollGeometry` surface, with `landing(i)` as the
 * independent oracle. Contract: WI-5 and the §5 migration table of
 * `.claude/tdd-guardian/tests-20260922-210708.md` (Revision 1).
 *
 * `landing(i) = clamp(contentOffset(i) − SPY_ANCHOR_OFFSET_PX, 0, maxScrollTop())` —
 * restated from the matrix, never computed by `src/`.
 *
 * A new file rather than additions to `wysiwygSpyHarness.ts`, which is fingerprinted by
 * the D17-WI-4 receipt.
 */
import { act } from "@testing-library/react";

import type { HeadingKey } from "../../src/types/toc";
import { SPY_ANCHOR_OFFSET_PX } from "../../src/utils/codemirrorViewportLine";
import type { ScriptedHeading, ScriptedSurface } from "./scriptedScrollGeometry";
import { mountContainer, mountSurface, renderSpy, tick } from "./wysiwygSpyHarness";

/** Non-zero start position, so navigating to a landing of 0 is a visible move. */
export const PRESET_SCROLL_TOP = 300;

export interface NavSpec {
  level: ScriptedHeading["level"];
  text: string;
  /** Milkdown-style DOM id (measured/derived per the original §5 fixtures). */
  id?: string;
}

export interface NavSetupOptions {
  /** `enableSpyScrolling`, default true. */
  spy?: boolean;
  /** Body height of every section, default 700. */
  bodyHeight?: number;
  /** Runs after the surface is built and BEFORE the hook renders (e.g. drop `.ProseMirror`). */
  beforeRender?: (container: HTMLElement, surface: ScriptedSurface) => void;
}

/** 40 px headings with equal bodies, so every element has its own content offset. */
export function setupNavigation(specs: readonly NavSpec[], content: string, opts: NavSetupOptions = {}) {
  const container = mountContainer();
  const bodyHeight = opts.bodyHeight ?? 700;
  const surface = mountSurface(container, {
    headings: specs.map((s) => ({ level: s.level, text: s.text, height: 40, bodyHeight })),
  });
  specs.forEach((s, i) => {
    if (s.id != null) surface.headings[i].id = s.id;
  });
  surface.setScrollTopSilently(PRESET_SCROLL_TOP);
  opts.beforeRender?.(container, surface);
  const { result, rerender } = renderSpy({
    content,
    documentId: "doc-a",
    enableSpyScrolling: opts.spy ?? true,
  });
  tick(300);
  const navigate = (key: HeadingKey) => {
    act(() => result.current.navigateToEntry(key));
  };
  return { container, surface, navigate, rerender };
}

export function landing(surface: ScriptedSurface, i: number): number {
  return Math.max(0, Math.min(surface.contentOffset(i) - SPY_ANCHOR_OFFSET_PX, surface.maxScrollTop()));
}

/** Rename `.ProseMirror` away (tier 3: nothing resolves), or restore it. */
export function setProseMirror(surface: ScriptedSurface, present: boolean): void {
  surface.proseMirror.className = present ? "ProseMirror" : "not-prosemirror";
}

/**
 * A modal's `<h3>` inside the container but outside `.ProseMirror`, scripted at its own
 * content offset (rect and `scrollIntoView`), so landing on it is distinguishable.
 */
export function appendModalTitle(
  container: HTMLElement,
  surface: ScriptedSurface,
  title: string,
  offset: number,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "dialog-card";
  const el = document.createElement("h3");
  el.className = "dialog-title";
  el.textContent = title;
  el.getBoundingClientRect = () => {
    const top = surface.rootTop + offset - surface.scroller.scrollTop;
    return { top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: top } as DOMRect;
  };
  el.scrollIntoView = () => {
    surface.scroller.scrollTop = offset;
  };
  card.appendChild(el);
  container.appendChild(card);
  return el;
}

/** Every `ui.toc.resolve.mismatch` payload in a `logEventSync` spy's calls, in order. */
export function mismatchLogsOf(calls: ReadonlyArray<ReadonlyArray<unknown>>): Array<Record<string, unknown>> {
  return calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((payload) => payload.event === "ui.toc.resolve.mismatch");
}
