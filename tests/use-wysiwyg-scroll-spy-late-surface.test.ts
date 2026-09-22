/**
 * D14 — the WYSIWYG scroll spy stays dead when the Milkdown surface mounts after the
 * spy armed, and goes stale when Milkdown replaces heading elements.
 *
 * Root cause (from `~/.mdpro/mdpro.log`: `ui.toc.resolve.mismatch` with `domCount: 0`
 * right after `editor.milkdown.mount`): `useWysiwygScrollSpy`'s observe effect runs
 * before `@milkdown/react` has created `.ProseMirror`, resolves zero headings, and
 * nothing re-arms it until `entries` changes. A Source→WYSIWYG switch leaves `entries`
 * identical, so the spy never recovers.
 *
 * One boundary double: `IntersectionObserver` (jsdom lacks it). `MutationObserver` is
 * jsdom's real one; its records are microtasks, flushed with `await act(async () => {})`.
 * The debounce uses fake timers, which in Vitest 3 do not fake `queueMicrotask`.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTOC } from "../src/hooks/useTOC";
import { loggingService } from "../src/services/loggingService";
import { useTOCStore } from "../src/stores/tocStore";
import type { ViewMode } from "../src/types/editor";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import {
  DEFAULT_CONTAINER_ID,
  mountMilkdownDom,
  unmountMilkdownDom,
} from "./helpers/milkdownHeadingDom";
import type { MilkdownDomFixture, MilkdownHeadingSpec } from "./helpers/milkdownHeadingDom";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import type { IntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

const realSetEntries = useTOCStore.getState().setEntries;

interface Props {
  content: string;
  documentId: string | null;
  viewMode: ViewMode;
}

const THREE: MilkdownHeadingSpec[] = [
  { level: 1, text: "Alpha" },
  { level: 2, text: "Beta" },
  { level: 2, text: "Gamma" },
];
const THREE_CONTENT = "# Alpha\n\n## Beta\n\n## Gamma";

let mounted: MilkdownDomFixture[] = [];
let double: IntersectionObserverDouble;
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

function renderTOC(initialProps: Props) {
  return renderHook(
    (props: Props) =>
      useTOC({
        content: props.content,
        documentId: props.documentId,
        containerId: DEFAULT_CONTAINER_ID,
        viewMode: props.viewMode,
        enableSpyScrolling: true,
      }),
    { initialProps },
  );
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

async function flushMutations() {
  await act(async () => {});
}

function entries(): TOCEntry[] {
  return useTOCStore.getState().entries;
}

function active(): HeadingKey | null {
  return useTOCStore.getState().activeEntryId;
}

function mismatchLogs(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((payload) => payload.event === "ui.toc.resolve.mismatch");
}

/**
 * Identity, not equality: Vitest compares DOM nodes with `isEqualNode`, so
 * `toEqual(new Set(els))` would accept a detached element with the same markup.
 */
function expectObservedExactly(elements: readonly Element[]): void {
  expect(double.observed.size).toBe(elements.length);
  for (const [i, el] of elements.entries()) {
    expect(double.observed.has(el), `element ${i} is observed by identity`).toBe(true);
  }
}

function totalObserveCalls(): number {
  return double.instances.reduce((sum, instance) => sum + instance.observeCalls.length, 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  mounted = [];
  double = installIntersectionObserverDouble();
  logSpy = vi.spyOn(loggingService, "logEventSync");
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
  for (const fixture of mounted) unmountMilkdownDom(fixture);
  mounted = [];
  vi.useRealTimers();
});

describe("D14 useWysiwygScrollSpy — late surface and replaced headings", () => {
  it("T1: cold mount — the surface arrives after the spy armed, and the spy recovers", async () => {
    const fixture = mountContainer(false);
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(entries()).toHaveLength(3);
    // Wrong-reason guard: the bug's precondition really holds before the mount.
    expect(double.observed.size).toBe(0);

    const headings = mountSurfaceLate(fixture);
    await flushMutations();

    expectObservedExactly(headings);
    act(() => {
      double.intersect(headings[1], true);
    });
    expect(active()).toBe(entries()[1].key);
  });

  it("T2: Source→WYSIWYG with identical entries — the late surface is still observed", async () => {
    const fixture = mountContainer(false);
    const { rerender } = renderTOC({
      content: THREE_CONTENT,
      documentId: "doc-a",
      viewMode: "source",
    });
    tick(300);
    expect(entries()).toHaveLength(3);
    const entriesBefore = entries();

    rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    // Same identity: nothing about `entries` can re-arm the spy.
    expect(entries()).toBe(entriesBefore);
    const constructedAtSwitch = double.constructCount;
    expect(constructedAtSwitch).toBe(1);

    const headings = mountSurfaceLate(fixture);
    await flushMutations();

    expectObservedExactly(headings);
    expect(double.constructCount).toBe(constructedAtSwitch);
    act(() => {
      double.intersect(headings[2], true);
    });
    expect(active()).toBe(entries()[2].key);
  });

  it("T3: a heading element replaced with the same text is re-observed; the old one is dead", async () => {
    const fixture = mountContainer(true);
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    const oldBeta = fixture.headings[1];
    expect(double.observed.has(oldBeta)).toBe(true);

    const freshBeta = replaceHeading(fixture, 1);
    await flushMutations();

    expect(double.observed.has(freshBeta)).toBe(true);
    expect(double.observed.has(oldBeta)).toBe(false);
    expectObservedExactly(fixture.headings);

    // A late record for the detached element must not activate anything.
    act(() => {
      double.deliverUnchecked(double.instances.length - 1, oldBeta, true);
    });
    expect(active()).toBeNull();

    act(() => {
      double.intersect(freshBeta, true);
    });
    expect(active()).toBe(entries()[1].key);
  });

  it("T4: unrelated edits re-arm nothing; a real replacement re-arms the same observer", async () => {
    const fixture = mountContainer(true);
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    const constructed = double.constructCount;
    const callsBefore = double.observeCalls.length;

    const paragraph = document.createElement("p");
    paragraph.textContent = "typed text";
    fixture.proseMirror?.appendChild(paragraph);
    // Text inside a heading changes, the element survives.
    fixture.headings[0].textContent = "Alpha edited";
    await flushMutations();

    expect(double.constructCount).toBe(constructed);
    expect(double.observeCalls.length).toBe(callsBefore);
    expectObservedExactly(fixture.headings);

    const freshGamma = replaceHeading(fixture, 2);
    await flushMutations();

    expect(double.constructCount).toBe(constructed);
    expect(double.observeCalls.slice(callsBefore)).toContain(freshGamma);
    expectObservedExactly(fixture.headings);
  });

  it("T5: the active entry is retained across a re-arm until a new record arrives", async () => {
    const fixture = mountContainer(true);
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    act(() => {
      double.intersect(fixture.headings[0], true);
    });
    expect(active()).toBe(entries()[0].key);

    // Milkdown re-renders every heading.
    for (let i = 0; i < fixture.headings.length; i++) replaceHeading(fixture, i);
    await flushMutations();

    expectObservedExactly(fixture.headings);
    expect(active()).toBe(entries()[0].key);

    act(() => {
      double.intersect(fixture.headings[2], true);
    });
    expect(active()).toBe(entries()[2].key);
  });

  it("T6: after unmount or disable, a late surface is never observed and both observers are torn down", async () => {
    const moObserve = vi.spyOn(MutationObserver.prototype, "observe");
    const moDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");

    // (a) disable: WYSIWYG → Source before the surface mounts.
    const first = mountContainer(false);
    const harness = renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(moObserve).toHaveBeenCalledTimes(1);
    harness.rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "source" });
    mountSurfaceLate(first);
    await flushMutations();
    expect(totalObserveCalls()).toBe(0);

    // (b) unmount: back to WYSIWYG over an empty container, then unmount the hook.
    unmountMilkdownDom(first);
    const second = mountContainer(false);
    harness.rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    expect(moObserve).toHaveBeenCalledTimes(2);
    harness.unmount();
    mountSurfaceLate(second);
    await flushMutations();

    expect(totalObserveCalls()).toBe(0);
    expect(double.disconnectCount).toBe(double.constructCount);
    expect(moDisconnect).toHaveBeenCalledTimes(moObserve.mock.calls.length);
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

  it("T8: the observer that watches the late surface keeps the pinned options", async () => {
    const fixture = mountContainer(false);
    renderTOC({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);

    const headings = mountSurfaceLate(fixture);
    await flushMutations();

    const watching = double.instances.filter((instance) => instance.observed.has(headings[0]));
    expect(watching).toHaveLength(1);
    expect(watching[0].options).toEqual({
      root: fixture.container,
      rootMargin: "0px 0px -66% 0px",
      threshold: 0,
    });
  });
});
