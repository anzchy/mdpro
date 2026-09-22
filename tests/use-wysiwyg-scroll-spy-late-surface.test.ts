/**
 * D14 — the WYSIWYG spy must recover when the Milkdown surface mounts after it armed
 * (`ui.toc.resolve.mismatch domCount: 0` right after `editor.milkdown.mount`; a
 * Source→WYSIWYG switch leaves `entries` identical, so nothing else re-arms it), and must
 * follow Milkdown's heading replacements.
 *
 * Migrated in D17 WI-4 (matrix `tests-20260922-210708.md`, "late-surface (D14) — WI-4"):
 * D17 disproved the IO-record specification; DECISION A is superseded by ADR-0026. T1–T6
 * assert the active key over a `scriptedScrollGeometry` surface; T7 (D7) is unchanged; T8
 * (pinned IO options) is deleted — H-18 proves no IntersectionObserver is constructed.
 *
 * Doubles: layout and scroll writes, rAF (fake timers), ResizeObserver where counted.
 * `MutationObserver` is jsdom's real one; its records are microtasks, flushed with
 * `await act(async () => {})` (Vitest 3 fake timers do not fake `queueMicrotask`).
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { SPY_ANCHOR_OFFSET_PX } from "../src/utils/codemirrorViewportLine";
import {
  DEFAULT_CONTAINER_ID,
  mountMilkdownDom,
  unmountMilkdownDom,
} from "./helpers/milkdownHeadingDom";
import type { MilkdownDomFixture, MilkdownHeadingSpec } from "./helpers/milkdownHeadingDom";
import { installResizeObserverDouble } from "./helpers/resizeObserverDouble";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import {
  active, entries, flushMutations, frame, headingReads, installIoDetector,
  mountContainer as mountEmptyContainer, mountSurface, oracleIndex, recordWrites,
  renderSpy, replaceScriptedHeading, resetTocStore, scrollHeadingTo, shiftLayout, tick,
} from "./helpers/wysiwygSpyHarness";

const THREE: MilkdownHeadingSpec[] = [
  { level: 1, text: "Alpha" },
  { level: 2, text: "Beta" },
  { level: 2, text: "Gamma" },
];
const THREE_CONTENT = "# Alpha\n\n## Beta\n\n## Gamma";
/** THREE with distinct scripted offsets (0, 460, 912); Gamma can reach the anchor. */
const SCRIPTED: ScriptedHeading[] = [
  { level: 1, text: "Alpha", height: 48, bodyHeight: 400 },
  { level: 2, text: "Beta", height: 40, bodyHeight: 400 },
  { level: 2, text: "Gamma", height: 40, bodyHeight: 800 },
];

let mounted: MilkdownDomFixture[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

function mountContainer(withProseMirror: boolean): MilkdownDomFixture {
  const fixture = mountMilkdownDom(withProseMirror ? THREE : [], {
    containerId: DEFAULT_CONTAINER_ID,
    withProseMirror,
  });
  mounted.push(fixture);
  return fixture;
}

/**
 * What `@milkdown/react` does after the spy armed: insert a whole `.ProseMirror`
 * subtree, headings included, into the surviving container in one mutation.
 */
function mountSurfaceLate(
  fixture: MilkdownDomFixture,
  specs: ReadonlyArray<MilkdownHeadingSpec> = THREE,
): HTMLElement[] {
  const proseMirror = document.createElement("div");
  proseMirror.className = "ProseMirror";
  const headings = specs.map((spec) => {
    const el = document.createElement(`h${spec.level}`);
    el.textContent = spec.text;
    proseMirror.appendChild(el);
    return el;
  });
  fixture.container.appendChild(proseMirror);
  fixture.proseMirror = proseMirror;
  fixture.headings = headings;
  return headings;
}

/** `setNodeMarkup`'s DOM face: the same heading, a new element. */
function replaceHeading(fixture: MilkdownDomFixture, index: number): HTMLElement {
  const old = fixture.headings[index];
  const fresh = document.createElement(old.tagName.toLowerCase());
  fresh.textContent = old.textContent;
  old.replaceWith(fresh);
  fixture.headings[index] = fresh;
  return fresh;
}

/** `useTOC` over `#milkdown-container` with the spy switched on. */
const renderTOC = renderSpy;

function mismatchLogs(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((payload) => payload.event === "ui.toc.resolve.mismatch");
}

/** A scripted surface already mounted, and the spy rendered and settled over it. */
function renderOverSurface() {
  const surface = mountSurface(mountEmptyContainer(), { headings: SCRIPTED });
  renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
  tick(300);
  return surface;
}

beforeEach(() => {
  vi.useFakeTimers();
  mounted = [];
  installIoDetector();
  logSpy = vi.spyOn(loggingService, "logEventSync");
  resetTocStore();
});

afterEach(() => {
  for (const fixture of mounted) unmountMilkdownDom(fixture);
  mounted = [];
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("D14 useWysiwygScrollSpy — late surface and replaced headings", () => {
  it("T1: cold mount — the surface arrives after the spy armed, and the spy recovers", async () => {
    const container = mountEmptyContainer();
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(entries()).toHaveLength(3);
    // Built detached: the spy has nothing to read yet.
    const surface = mountSurface(document.createElement("div"), { headings: SCRIPTED });
    frame();
    expect(headingReads(surface)).toBe(0);
    expect(active()).toBeNull();

    act(() => void container.appendChild(surface.wrapper)); // one insert, as @milkdown/react
    await flushMutations();
    scrollHeadingTo(surface, 1, 10);
    expect(active()).toBe(entries()[1].key);
  });

  it("T2: Source→WYSIWYG with identical entries — the late surface drives the spy", async () => {
    const container = mountEmptyContainer();
    const add = vi.spyOn(container, "addEventListener");
    const { rerender } = renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "source" });
    tick(300);
    expect(entries()).toHaveLength(3);
    const entriesBefore = entries();

    rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    // Same identity: nothing about `entries` can re-arm the spy.
    expect(entries()).toBe(entriesBefore);

    const surface = mountSurface(container, { headings: SCRIPTED });
    await flushMutations();
    scrollHeadingTo(surface, 2, 10);
    expect(active()).toBe(entries()[2].key);
    const isCapture = (c: unknown[]) => c[0] === "scroll" && (c[2] as AddEventListenerOptions)?.capture;
    expect(add.mock.calls.filter(isCapture)).toHaveLength(1);
  });

  it("T3: a replaced heading's old element is never read; the fresh one becomes active", async () => {
    const surface = renderOverSurface();
    expect(active()).toBe(entries()[0].key);

    const beta = replaceScriptedHeading(surface, 1);
    await flushMutations();
    scrollHeadingTo(surface, 1, SPY_ANCHOR_OFFSET_PX);
    expect(beta.staleReads()).toBe(0);
    expect(surface.rectReads.headings[1]).toBeGreaterThan(0);
    expect(active()).toBe(entries()[1].key);
  });

  it("T4: unrelated edits recompute nothing; a replaced Gamma at the anchor becomes active", async () => {
    const surface = renderOverSurface();
    surface.resetRectReads();
    const rec = recordWrites();

    surface.proseMirror.appendChild(document.createElement("p"));
    // Text inside a heading changes, the element survives.
    surface.headings[0].textContent = "Alpha edited";
    await flushMutations();
    frame();
    expect(headingReads(surface)).toBe(0);
    expect(rec.writes).toEqual([]);

    replaceScriptedHeading(surface, 2);
    await flushMutations();
    scrollHeadingTo(surface, 2, SPY_ANCHOR_OFFSET_PX);
    rec.stop();
    expect(active()).toBe(entries()[2].key);
  });

  it("T5 (expectation changed): a re-arm recomputes — replaced, shifted headings move 0 → 2 with no scroll", async () => {
    const surface = renderOverSurface();
    expect(active()).toBe(entries()[0].key);

    // Milkdown re-renders every heading, and the layout above them changed.
    for (let i = 0; i < surface.headings.length; i++) replaceScriptedHeading(surface, i);
    const shifted = shiftLayout(surface, -900);
    expect(oracleIndex(3, shifted)).toBe(2);
    await flushMutations();
    frame();
    expect(active()).toBe(entries()[2].key);
  });

  it("T6: after disable or unmount a late surface never writes; every attachment is detached", async () => {
    const ro = installResizeObserverDouble();
    const moObserve = vi.spyOn(MutationObserver.prototype, "observe");
    const moDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const adds: Array<ReturnType<typeof vi.spyOn>> = [];
    const removes: Array<ReturnType<typeof vi.spyOn>> = [];
    const spyContainer = () => {
      const el = mountEmptyContainer();
      adds.push(vi.spyOn(el, "addEventListener"));
      removes.push(vi.spyOn(el, "removeEventListener"));
      return el;
    };
    const lateSurface = (el: HTMLElement) =>
      mountSurface(el, { headings: SCRIPTED }).setScrollTopSilently(912 - 10); // Gamma: oracle

    // (a) disable: WYSIWYG → Source before the surface mounts.
    const first = spyContainer();
    const harness = renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(moObserve).toHaveBeenCalledTimes(1);
    const rec = recordWrites();
    harness.rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "source" });
    lateSurface(first);
    await flushMutations();
    frame();
    // (b) unmount: back to WYSIWYG over an empty container, then unmount the hook.
    first.remove();
    const second = spyContainer();
    harness.rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    expect(moObserve).toHaveBeenCalledTimes(2);
    harness.unmount();
    lateSurface(second);
    await flushMutations();
    frame();
    rec.stop();

    expect(rec.writes).toEqual([]);
    const scrollCalls = (spies: typeof adds) =>
      spies.reduce((n, spy) => n + spy.mock.calls.filter((c) => c[0] === "scroll").length, 0);
    expect(scrollCalls(adds)).toBeGreaterThan(0);
    expect(scrollCalls(removes)).toBe(scrollCalls(adds));
    expect(moDisconnect).toHaveBeenCalledTimes(moObserve.mock.calls.length);
    expect(ro.disconnectCount()).toBe(ro.constructCount());

    // Positive guard: the same late mount under a live WYSIWYG spy writes Gamma.
    second.remove();
    const third = mountEmptyContainer();
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    lateSurface(third);
    await flushMutations();
    frame();
    expect(active()).toBe(entries()[2].key);
  });

  it("T7: a surface teardown is not a mismatch; a real changed signature warns exactly once", async () => {
    const fixture = mountContainer(true);
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(mismatchLogs()).toHaveLength(0);

    // Provider re-key: `.ProseMirror` goes away while the container survives.
    fixture.proseMirror?.remove();
    await flushMutations();
    expect(mismatchLogs()).toHaveLength(0);

    // It comes back holding a heading our parser does not report.
    mountSurfaceLate(fixture, [...THREE, { level: 2, text: "Extra" }]);
    await flushMutations();
    const logs = mismatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({
      documentId: "doc-a",
      entryCount: 3,
      domCount: 4,
      resolvedCount: 3,
    });

    // Same signature again after a replacement: no second warning.
    replaceHeading(fixture, 1);
    await flushMutations();
    expect(mismatchLogs()).toHaveLength(1);
  });
});
