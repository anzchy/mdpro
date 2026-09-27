/**
 * D17 regression suite — the WYSIWYG outline highlight after a Source→WYSIWYG switch and
 * while scrolling inside a long section. Matrix: WI-3 of
 * `.claude/tdd-guardian/tests-20260922-210708.md` (R-D17-0…R-D17-3), ported from the D17
 * diagnostic seed (Part B: B0, B2, B3, B1). B4 and Part A are not ported (see matrix).
 *
 * The switch is replayed in the order the release log shows it: Source spy left a heading
 * active → the WYSIWYG spy arms over an empty container (no warning since D21: no
 * `.ProseMirror` means no report) → `.ProseMirror` arrives in one insert (D14 re-arm) →
 * the first rendering update at scrollTop 0 → WI-8's restore (`scrollTop` write plus the
 * `scroll` event a browser fires) → the next rendering update.
 *
 * Real: `useTOC` → `useWysiwygScrollSpy` → `tocStore`, jsdom DOM, MutationObserver, scroll
 * event dispatch. Scripted: layout and scroll writes (`scriptedScrollGeometry`), rAF (fake
 * timers), and IntersectionObserver (`geometricIntersectionObserver` — computed from the
 * same layout, so the pre-D17 IO spy fails on the wrong key, not on a ReferenceError).
 *
 * Rule: the active heading is the LAST heading whose top is at or above the anchor,
 * `SPY_ANCHOR_OFFSET_PX` below the scroller top — the same rule Source uses (ADR-0026).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTOC } from "../src/hooks/useTOC";
import { loggingService } from "../src/services/loggingService";
import { useTOCStore } from "../src/stores/tocStore";
import type { ViewMode } from "../src/types/editor";
import type { HeadingKey } from "../src/types/toc";
import { SPY_ANCHOR_OFFSET_PX } from "../src/utils/codemirrorViewportLine";
import { frame, installGeometricIntersectionObserver } from "./helpers/geometricIntersectionObserver";
import {
  mountScriptedSurface,
  type ScriptedHeading,
  type ScriptedSurface,
} from "./helpers/scriptedScrollGeometry";

// ---------------------------------------------------------------------------
// Fixture: repro-a.md's shape — one H1, then 12 `##` sections of 15 paragraphs.
// Geometry roughly the 1152×768 GUI run: scroller top at y=90, 660 px tall.
// ---------------------------------------------------------------------------
const SECTIONS = 12;
const PARAS = 15;
const ROOT_TOP = 90;
const VIEW_H = 660;
/** Height of the pre-D17 IO band (`rootMargin "0px 0px -66% 0px"`), for guards only. */
const OLD_BAND_PX = VIEW_H * 0.34;
const H1_H = 48;
const H2_H = 40;
const P_H = 50;
const GAP = 12;
const H1_TEXT = "Repro fixture A";

const sectionTitle = (s: number) => `A H${String(s).padStart(2, "0")}`;

function fixtureMarkdown(): string {
  const out = [`# ${H1_TEXT}`, ""];
  for (let s = 1; s <= SECTIONS; s++) {
    const h = String(s).padStart(2, "0");
    out.push(`## ${sectionTitle(s)}`, "");
    for (let p = 1; p <= PARAS; p++) {
      out.push(`A-H${h}-P${String(p).padStart(2, "0")} Lorem ipsum dolor sit amet.`, "");
    }
  }
  return out.join("\n");
}
const CONTENT = fixtureMarkdown();

const HEADINGS: ScriptedHeading[] = [
  { level: 1, text: H1_TEXT, height: H1_H, bodyHeight: 0 },
  ...Array.from({ length: SECTIONS }, (_, k) => ({
    level: 2 as const,
    text: sectionTitle(k + 1),
    height: H2_H,
    bodyHeight: PARAS * P_H,
  })),
];

/** scrollTop that puts the viewport top `paras` paragraphs into heading i's body. */
function intoBody(surface: ScriptedSurface, i: number, paras: number): number {
  return surface.contentOffset(i) + H2_H + GAP + paras * P_H;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
interface Props {
  viewMode: ViewMode;
}

function renderTOC(viewMode: ViewMode) {
  return renderHook(
    (p: Props) =>
      useTOC({
        content: CONTENT,
        documentId: "doc-a",
        containerId: p.viewMode === "wysiwyg" ? "milkdown-container" : "source-container",
        viewMode: p.viewMode,
        enableSpyScrolling: true,
      }),
    { initialProps: { viewMode } },
  );
}

function activeText(): string | null {
  const { entries, activeEntryId } = useTOCStore.getState();
  return entries.find((e) => e.key === activeEntryId)?.text ?? null;
}

function keyOf(text: string): HeadingKey {
  const entry = useTOCStore.getState().entries.find((e) => e.text === text);
  if (!entry) throw new Error(`no entry ${text}`);
  return entry.key;
}

/** Standing rule H2: entry keys are pairwise distinct, so a key names one heading. */
function expectDistinctKeys() {
  const keys = useTOCStore.getState().entries.map((e) => e.key);
  expect(keys).toHaveLength(1 + SECTIONS);
  expect(new Set(keys).size).toBe(keys.length);
}

/** WI-8's `scroller.scrollTop += y - probeY`, plus the `scroll` event WKWebView fires. */
function restoreScroll(scroller: HTMLElement, scrollTop: number) {
  act(() => {
    scroller.scrollTop = scrollTop;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

function userScroll(scroller: HTMLElement, scrollTop: number) {
  restoreScroll(scroller, scrollTop);
  frame();
}

/** Hands the mounted surface to the IO double's `measure` (uncounted rect reads). */
let currentSurface: (s: ScriptedSurface) => void = () => {};

let logSpy: ReturnType<typeof vi.spyOn>;
const realSetEntries = useTOCStore.getState().setEntries;

beforeEach(() => {
  let surfaceRef: ScriptedSurface | null = null;
  installGeometricIntersectionObserver({
    measure: (el) => surfaceRef?.peekRect(el) ?? el.getBoundingClientRect(),
  });
  currentSurface = (s) => {
    surfaceRef = s;
  };
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  useTOCStore.setState({
    entries: [],
    documentId: null,
    activeEntryId: null,
    isVisible: false,
    collapsedIds: new Set<HeadingKey>(),
    byDocument: new Map(),
    setEntries: realSetEntries,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/**
 * The switch, in log order, ending BEFORE the first rendering update: Source spy left
 * `start` active → WYSIWYG spy arms over an empty container (no D7 warning: D21)
 * → `.ProseMirror` arrives in one insert → mutations flushed (D14 re-arm).
 */
async function switchToWysiwyg(start: string) {
  vi.useFakeTimers();
  const container = document.createElement("div");
  container.id = "milkdown-container";
  document.body.appendChild(container);

  const harness = renderTOC("source");
  act(() => {
    vi.advanceTimersByTime(300); // parse debounce
  });
  expectDistinctKeys();
  act(() => useTOCStore.getState().setActiveEntry(keyOf(start)));
  expect(activeText()).toBe(start);

  harness.rerender({ viewMode: "wysiwyg" });
  const mismatch = logSpy.mock.calls
    .map((c) => c[0] as { event: string; context: Record<string, unknown> })
    .filter((p) => p.event === "ui.toc.resolve.mismatch");
  // D21 — the empty-container initial pass is pre-mount, not a mismatch; `[0]` pinned the defect.
  expect(mismatch).toHaveLength(0);

  const surface = mountScriptedSurface(container, {
    headings: HEADINGS,
    rootTop: ROOT_TOP,
    viewHeight: VIEW_H,
    gap: GAP,
  });
  currentSurface(surface);
  await act(async () => {}); // flush the MutationObserver (D14 re-arm)
  return { harness, surface, scroller: surface.scroller };
}

describe("D17 — WYSIWYG spy after a Source→WYSIWYG switch (seed Part B)", () => {
  it("R-D17-0 (B0 precondition): the first frame at scrollTop 0 makes the H1 active", async () => {
    const { surface } = await switchToWysiwyg(sectionTitle(6));
    expect(surface.scroller.scrollTop).toBe(0);
    // Guard: H01 has not reached the anchor, so only the H1 qualifies.
    expect(surface.relTop(1)).toBeGreaterThan(SPY_ANCHOR_OFFSET_PX);
    frame();
    expect(activeText()).toBe(H1_TEXT);
  });

  it("R-D17-1 (B2/G6): restore mid-section with no heading near the anchor → H06", async () => {
    const { surface, scroller } = await switchToWysiwyg(sectionTitle(6));
    frame(); // scrollTop 0 → H1
    expect(activeText()).toBe(H1_TEXT);

    restoreScroll(scroller, intoBody(surface, 6, 6.5)); // viewport top at A-H06-P07's middle
    // Guards: H06 is above the viewport; H07 is below the anchor AND below the old band.
    expect(surface.relTop(6)).toBeLessThan(0);
    expect(surface.relTop(7)).toBeGreaterThan(OLD_BAND_PX);
    frame();
    expect(activeText()).toBe(sectionTitle(6));
  });

  it("R-D17-2 (B3/S6): scrolling up from H07 into H06's body highlights H06", async () => {
    const { surface, scroller } = await switchToWysiwyg(sectionTitle(1));
    frame();

    userScroll(scroller, surface.scrollTopForHeadingAt(7, 20)); // H07 just under the top
    expect(surface.relTop(7)).toBeLessThanOrEqual(SPY_ANCHOR_OFFSET_PX);
    expect(activeText()).toBe(sectionTitle(7));

    userScroll(scroller, intoBody(surface, 6, 4)); // up into A-H06-P05
    // Guards: H06 is above the anchor; H07 is below the anchor AND below the old band.
    expect(surface.relTop(6)).toBeLessThan(SPY_ANCHOR_OFFSET_PX);
    expect(surface.relTop(7)).toBeGreaterThan(OLD_BAND_PX);
    expect(activeText()).toBe(sectionTitle(6));
  });

  it(
    "R-D17-3 (B1, SPECIFICATION CHANGE): restore puts H07 at rel 114 → H06. The band rule " +
      "('a heading in the top 34% wins') is replaced by the anchor rule (ADR-0026): H07 " +
      "has not reached the anchor, so the section owning the anchor — H06 — is active",
    async () => {
      const rel = 204 - ROOT_TOP; // GUI capture: H07 at viewport y≈204
      expect(rel).toBeGreaterThan(SPY_ANCHOR_OFFSET_PX);
      expect(rel).toBeLessThan(OLD_BAND_PX);

      const { surface, scroller } = await switchToWysiwyg(sectionTitle(7));
      frame(); // scrollTop 0 → H1
      restoreScroll(scroller, surface.scrollTopForHeadingAt(7, rel));
      expect(surface.relTop(7)).toBe(rel);
      expect(surface.relTop(6)).toBeLessThan(SPY_ANCHOR_OFFSET_PX);
      frame();
      expect(activeText()).toBe(sectionTitle(6));
    },
  );
});
