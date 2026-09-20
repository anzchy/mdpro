/**
 * Purpose: WI-5 — the **routing** layer of `src/hooks/useTOC.ts`. One hook, two spy
 * mechanisms, and exactly one of them live per render:
 *
 *   `resolveSpyMode(enableSpyScrolling, viewMode)`
 *     `"dom"`  ⇒ the IntersectionObserver effect (WYSIWYG), and **no** scroll listener
 *     `"line"` ⇒ `useSourceScrollSpy` (Source), and **no `IntersectionObserver` ever
 *                constructed — not even referenced**
 *     `"off"`  ⇒ neither
 *
 * Matrix §6 of `.claude/tdd-guardian/tests-20260919-151931.md`, cases **T-1 … T-10**.
 * §0 is binding throughout. This is the work item's **regression cycle**: T-1 is red on
 * HEAD for a semantic reason.
 *
 * ---------------------------------------------------------------------------
 * §6.0 — what makes the red meaningful, honoured literally
 * ---------------------------------------------------------------------------
 * 1. **No new module is imported here.** Not `tocSpyMode`, not `tocLineSpy`, not
 *    `codemirrorViewportLine`, not `useSourceScrollSpy`. Everything below reaches the new
 *    behaviour through `useTOC`'s public surface, so a red cannot degenerate into "a file
 *    does not exist yet".
 * 2. **The fake geometry does not encode `SPY_ANCHOR_OFFSET_PX`.** `lineAtY` is coarse —
 *    `y => y < 100 ? top : bottom` — so the anchor probe lands in the same bucket for any
 *    offset in `(0, 100)` and the bottom probe (`rect.bottom - 1 === 599`) in the other.
 *    Pinning the constant is V-8 / V-8b's business, not this file's.
 * 3. **HEAD fails on an assertion, not on a `TypeError`.** `installIntersectionObserverDouble()`
 *    runs in `beforeEach` and `#source-container` is mounted, so on HEAD the Source-mode
 *    render *succeeds*: the observer is built over a container with no `.ProseMirror`,
 *    `collectHeadingElements` returns `[]`, nothing is observed, no record can ever be
 *    delivered, and `activeEntryId` stays `null`. The red therefore reads
 *    `expected null to be "…"` — "Source mode does not track scroll position".
 *
 * ---------------------------------------------------------------------------
 * Two deviations from the matrix text, stated rather than silent
 * ---------------------------------------------------------------------------
 * - **T-3 clause 2** is asserted through the public surface (the attach/re-sample at the
 *   clamped geometry lands on `entries[1]`) instead of by calling `pickActiveKeyByLine`
 *   directly, because §6.0.1 forbids importing that module into this file. The claim is
 *   the same one — "the raw sample genuinely disagrees with the retained answer" — and is
 *   observed one layer further out.
 * - **T-10** pins the return type by **mutual assignability against a locally written
 *   shape**, because `UseTOCReturn` is *not exported* from `src/hooks/useTOC.ts` on HEAD
 *   and §6.0.1 forbids this file from depending on a symbol that has to be created for
 *   it. Mutual assignability is strictly stronger than the matrix's one-way
 *   `const _shape: UseTOCReturn = result.current`: it fails on an added member as well as
 *   on a removed or retyped one. Proven by `pnpm typecheck:tests` (§0.14).
 *
 * ---------------------------------------------------------------------------
 * Mock boundary, and the obligation it creates
 * ---------------------------------------------------------------------------
 * Real: `useTOC` itself, `tocStore` and its real key coordinator, `useEditorStore`, the
 * real `EditorState`, the real jsdom DOM and the real `scroll` event, the real heading
 * resolution, and every pure unit. Faked: CodeMirror **geometry** (§0.8),
 * `IntersectionObserver` (§0.8 — jsdom implements none), `requestAnimationFrame` via
 * `vi.useFakeTimers()` (§0.10), and `loggingService` (§0.12).
 *
 * jsdom has no layout engine, so nothing here proves the highlight follows the reader's
 * eye. **The integration obligation is UNMET** (§8 D-1) and is discharged by WI-7 manual
 * checks QA-1 (T-1, T-2), QA-3 (T-3) and QA-4 (T-4, T-6, T-8).
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { useTOC } from "../src/hooks/useTOC";
import { useEditorStore } from "../src/stores/editorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { ViewMode } from "../src/types/editor";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import {
  AT_LIMIT_SCROLL,
  createFakeView,
  expectFixtureGeometry,
  MID_SCROLL,
} from "./helpers/fakeCodemirrorView";
import type { FakeViewFixture, FixtureScrollMetrics } from "./helpers/fakeCodemirrorView";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import type { IntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { mountMilkdownDom, unmountMilkdownDom } from "./helpers/milkdownHeadingDom";
import type { MilkdownDomFixture, MilkdownHeadingSpec } from "./helpers/milkdownHeadingDom";

// §0.12 — the established logging double. Log assertions are Level 6 supplements and are
// never a case's sole assertion; here the double exists only to keep the JSONL writer out
// of the test process.
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: () => "test-action-id" },
}));

const realSetEntries = useTOCStore.getState().setEntries;

const WYSIWYG_CONTAINER_ID = "milkdown-container";
const SOURCE_CONTAINER_ID = "source-container";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface TocProps {
  content: string;
  documentId: string | null;
  containerId: string;
  viewMode: ViewMode;
  /**
   * Deliberately **optional**, and deliberately passed through by presence rather than by
   * value: T-1 and T-6 exist to prove that *omitting* the argument — which is what
   * deleting `App.tsx:140` makes App do — still arms the right mechanism.
   */
  enableSpyScrolling?: boolean;
}

function toOptions(props: TocProps) {
  const base = {
    content: props.content,
    documentId: props.documentId,
    containerId: props.containerId,
    viewMode: props.viewMode,
  };
  // §0.4 — `Object.hasOwn` does not compile under `lib: ["ES2020"]`.
  return Object.prototype.hasOwnProperty.call(props, "enableSpyScrolling")
    ? { ...base, enableSpyScrolling: props.enableSpyScrolling }
    : base;
}

function renderTOC(initialProps: TocProps) {
  return renderHook((props: TocProps) => useTOC(toOptions(props)), { initialProps });
}

interface HeadingSpec {
  line: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

/**
 * A markdown document of exactly `lineCount` lines with ATX headings at the named 1-based
 * lines. Filler lines carry no `-`, so no setext heading can form by accident.
 */
function buildDoc(lineCount: number, headings: readonly HeadingSpec[]): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i += 1) lines.push(`filler line ${i}`);
  for (const h of headings) lines[h.line - 1] = `${"#".repeat(h.level)} ${h.text}`;
  return lines.join("\n");
}

/** The `.ProseMirror` heading DOM matching a `buildDoc` heading list, in document order. */
function domSpecsFor(headings: readonly HeadingSpec[]): MilkdownHeadingSpec[] {
  return headings.map((h, i) => ({ level: h.level, text: h.text, id: `h-${i}` }));
}

let fixtures: FakeViewFixture[] = [];
let mountedDom: MilkdownDomFixture[] = [];
let sourceContainer: HTMLElement | null = null;
let double: IntersectionObserverDouble;

interface SpyView {
  fake: FakeViewFixture;
  scrollDOM: HTMLDivElement;
  /** Swap the pixel→line mapping on a live view; the rect is untouched. */
  setGeo: (topLine: number, bottomLine: number) => void;
  /** Every transaction spec the navigate path dispatched. */
  dispatches: unknown[];
  /** `scroll` listeners added / removed on this scroller, by call-through spies. */
  adds: () => number;
  removes: () => number;
}

/**
 * A fake view whose anchor probe resolves to `top` and whose bottom probe resolves to
 * `bottom`, both changeable mid-test.
 *
 * The `dispatch` is added **here** rather than in `tests/helpers/fakeCodemirrorView.ts`:
 * that helper models the geometry seam, its lines are fingerprinted by WI-1's red
 * receipt, and only this file's T-3 needs the navigate path to survive
 * `editorView.dispatch(...)` (without it `useTOC`'s `try { … } catch {}` swallows a
 * `TypeError` and the navigate silently never writes).
 *
 * `scroll` defaults to `MID_SCROLL` — a healthy scroller far from either end, which is
 * what an ordinary case means. Defaulting to `AT_LIMIT_SCROLL` would re-enable the tail
 * clamp in every case in this file; the two that genuinely mean "at the bottom" (T-3,
 * T-11) say so. `fixture.setScrollMetrics` reaches the live view through `spy.fake`.
 */
function makeSpyView(
  doc: string,
  top: number,
  bottom: number,
  scroll: FixtureScrollMetrics = MID_SCROLL,
): SpyView {
  let geo = { top, bottom };
  // §6.0.2 — coarse on purpose: insensitive to the exact anchor offset.
  const fake = createFakeView({
    doc,
    lineAtY: (y) => (y < 100 ? geo.top : geo.bottom),
    scroll,
  });
  fixtures.push(fake);

  const dispatches: unknown[] = [];
  (fake.view as unknown as { dispatch: (spec: unknown) => void }).dispatch = (spec) => {
    dispatches.push(spec);
  };

  const addSpy = vi.spyOn(fake.scrollDOM, "addEventListener");
  const removeSpy = vi.spyOn(fake.scrollDOM, "removeEventListener");
  return {
    fake,
    scrollDOM: fake.scrollDOM,
    setGeo: (nextTop, nextBottom) => {
      geo = { top: nextTop, bottom: nextBottom };
    },
    dispatches,
    adds: () => addSpy.mock.calls.filter((call) => call[0] === "scroll").length,
    removes: () => removeSpy.mock.calls.filter((call) => call[0] === "scroll").length,
  };
}

function installView(spy: SpyView | null): void {
  act(() => {
    useEditorStore.setState({ editorView: spy ? spy.fake.view : null });
  });
}

function mountSourceContainer(): HTMLElement {
  const el = document.createElement("div");
  el.id = SOURCE_CONTAINER_ID;
  // No `.ProseMirror` inside — that is the real Source-mode shape, and it is why the
  // HEAD observer resolves zero headings (§6.0.3).
  document.body.appendChild(el);
  sourceContainer = el;
  return el;
}

function mountWysiwygDom(headings: readonly HeadingSpec[]): MilkdownDomFixture {
  const fixture = mountMilkdownDom(domSpecsFor(headings), {
    containerId: WYSIWYG_CONTAINER_ID,
  });
  mountedDom.push(fixture);
  return fixture;
}

/** Flush `useTOC`'s 300 ms parse debounce. */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function flushFrame(): void {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

function scroll(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

function entries(): TOCEntry[] {
  return useTOCStore.getState().entries;
}

function activeKey(): HeadingKey | null {
  return useTOCStore.getState().activeEntryId;
}

/** Standing rule H2 (§0.5). */
function expectDistinctKeys(list: readonly TOCEntry[], where: string): void {
  expect(
    new Set(list.map((e) => e.key)).size,
    `${where}: H2 — entry keys must be pairwise distinct`,
  ).toBe(list.length);
}

/** The heading lines really landed where `buildDoc` put them — not a literal in a case. */
function expectHeadingLines(list: readonly TOCEntry[], expected: readonly number[]): void {
  expect(list.map((e) => e.lineNumber)).toEqual([...expected]);
}

/**
 * §0.10 — proves `advanceTimersToNextFrame` really runs rAF callbacks **in this case's
 * timer state**, independently of the code under test. A throttle or flush test that
 * passes because the frame never fired is worse than no test.
 */
function expectFrameClockLive(where: string): void {
  expect(vi.isFakeTimers(), `${where}: §0.10 requires fake timers`).toBe(true);
  let sentinel = false;
  requestAnimationFrame(() => {
    sentinel = true;
  });
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  expect(sentinel, `${where}: §0.10 — the frame clock must actually fire`).toBe(true);
}

/** §0.11 — mock-free write counting against the real store. */
interface WriteRecorder {
  observed: Array<HeadingKey | null>;
  entriesStable: () => boolean;
  stop: () => void;
}

function recordWrites(): WriteRecorder {
  const observed: Array<HeadingKey | null> = [];
  const entriesAtStart = useTOCStore.getState().entries;
  const unsubscribe = useTOCStore.subscribe((state) => {
    observed.push(state.activeEntryId);
  });
  return {
    observed,
    entriesStable: () => useTOCStore.getState().entries === entriesAtStart,
    stop: unsubscribe,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Headings on lines 1, 12, 30 of a 100-line document. */
const STD_HEADINGS: HeadingSpec[] = [
  { line: 1, level: 1, text: "Alpha" },
  { line: 12, level: 2, text: "Beta" },
  { line: 30, level: 2, text: "Gamma" },
];
const STD_DOC = buildDoc(100, STD_HEADINGS);
const STD_LINES = [1, 12, 30];

/** Headings on lines 5, 12, 30 — leaves an "above the first heading" band. */
const OFFSET_HEADINGS: HeadingSpec[] = [
  { line: 5, level: 1, text: "Alpha" },
  { line: 12, level: 2, text: "Beta" },
  { line: 30, level: 2, text: "Gamma" },
];
const OFFSET_DOC = buildDoc(100, OFFSET_HEADINGS);
const OFFSET_LINES = [5, 12, 30];

/** Headings on lines 1, 40, 90 — the EOF tail-clamp shape (A-1). */
const TAIL_HEADINGS: HeadingSpec[] = [
  { line: 1, level: 1, text: "Alpha" },
  { line: 40, level: 2, text: "Beta" },
  { line: 90, level: 2, text: "Gamma" },
];
const TAIL_DOC = buildDoc(100, TAIL_HEADINGS);
const TAIL_LINES = [1, 40, 90];

beforeEach(() => {
  vi.useFakeTimers();
  fixtures = [];
  mountedDom = [];
  sourceContainer = null;
  double = installIntersectionObserverDouble();
  useTOCStore.setState({
    entries: [],
    documentId: null,
    activeEntryId: null,
    isVisible: false,
    collapsedIds: new Set<HeadingKey>(),
    byDocument: new Map(),
    setEntries: realSetEntries,
  });
  useEditorStore.setState({ editorView: null });
});

afterEach(() => {
  for (const fixture of fixtures) fixture.destroy();
  fixtures = [];
  for (const fixture of mountedDom) unmountMilkdownDom(fixture);
  mountedDom = [];
  sourceContainer?.remove();
  sourceContainer = null;
  useEditorStore.setState({ editorView: null });
  vi.useRealTimers();
});

describe("useTOC spy routing — matrix §6 (WI-5)", () => {
  // -------------------------------------------------------------------------
  it("T-1: REGRESSION — scrolling in Source mode moves the highlight", () => {
    expectFrameClockLive("T-1");
    mountSourceContainer();

    const spy = makeSpyView(STD_DOC, 2, 25);
    expectFixtureGeometry(spy.fake);
    installView(spy);

    // `enableSpyScrolling` is deliberately omitted — that omission is the whole point of
    // deleting `App.tsx:140`.
    renderTOC({
      content: STD_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
    });
    tick(300);
    flushFrame();

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "T-1");
    expectHeadingLines(list, STD_LINES);

    // Wrong-reason guard: the attach/re-sample geometry lands somewhere else entirely, so
    // the scroll below is what moves the highlight rather than the mount.
    expect(activeKey()).toBe(list[0].key);

    const writes = recordWrites();
    spy.setGeo(14, 25);
    scroll(spy.scrollDOM);
    flushFrame();
    writes.stop();

    expect(activeKey()).toBe(list[1].key);
    expect(activeKey()).not.toBe(list[0].key);
    // Exactly one store write, and the right final state (§0.10).
    expect(writes.observed).toEqual([list[1].key]);
    expect(writes.entriesStable()).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("T-2: retention through the public surface — above the first heading keeps the highlight", () => {
    expectFrameClockLive("T-2");
    mountSourceContainer();

    const spy = makeSpyView(OFFSET_DOC, 14, 25);
    expectFixtureGeometry(spy.fake);
    installView(spy);

    renderTOC({
      content: OFFSET_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "T-2");
    expectHeadingLines(list, OFFSET_LINES);

    scroll(spy.scrollDOM);
    flushFrame();
    // Mandatory wrong-reason guard: "unchanged" must not be satisfiable by "never set".
    expect(activeKey()).toBe(list[1].key);

    // S2 — the whole above-first band. `(2, 10)` makes the raw pick `null` with the
    // current heading off screen; `(4, 30)` makes it `null` with the current heading
    // still visible. Both must preserve, by two different routes through the pipeline.
    for (const [top, bottom] of [
      [2, 10],
      [4, 30],
    ]) {
      spy.setGeo(top, bottom);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey(), `anchor ${top}: the highlight must be retained`).toBe(list[1].key);
      expect(activeKey()).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  it("T-3: tail clamp through the public surface — a clicked tail heading keeps the highlight (A-1)", () => {
    expectFrameClockLive("T-3");
    mountSourceContainer();

    // SPY-WI-4 fixture change, not an expectation change — same meaning and same reason
    // as H-3's: this case has always meant "the user clicked the tail heading and the
    // scroller is at the bottom", a condition that was unstated only because the pure
    // layer could not read it. At the default `MID_SCROLL` it would assert the defect.
    const spy = makeSpyView(TAIL_DOC, 78, 100, AT_LIMIT_SCROLL);
    expectFixtureGeometry(spy.fake);
    installView(spy);

    const { result } = renderTOC({
      content: TAIL_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "T-3"); // clause 1
    expectHeadingLines(list, TAIL_LINES);
    // clause 2, through the public surface (see the header's deviation note): with no
    // highlight to retain, the sample at the clamped anchor lands on `entries[1]` — so
    // the raw pick genuinely disagrees with the retained answer asserted below.
    expect(activeKey()).toBe(list[1].key);
    // clause 3 — the tail heading really is below the clamped anchor and on screen.
    expect(list[2].lineNumber).toBeGreaterThan(78);
    expect(list[2].lineNumber).toBeLessThanOrEqual(100);

    // The real navigate path: dispatches through the view and writes the store.
    act(() => {
      result.current.navigateToEntry(list[2].key);
    });
    expect(spy.dispatches).toHaveLength(1);
    expect(activeKey()).toBe(list[2].key);

    // clause 4 — the scroll the navigate's own `scrollIntoView` would fire changes nothing.
    const writes = recordWrites();
    scroll(spy.scrollDOM);
    flushFrame();
    writes.stop();
    expect(activeKey()).toBe(list[2].key);
    expect(writes.observed).toEqual([]);
    expect(writes.entriesStable()).toBe(true);

    // NEGATIVE CONTROL — with the tail heading off the bottom of the pane the highlight
    // *does* move, so the retention above is a decision and not a dead code path.
    spy.setGeo(78, 79);
    scroll(spy.scrollDOM);
    flushFrame();
    expect(activeKey()).toBe(list[1].key);
  });

  // -------------------------------------------------------------------------
  it("T-4: GUARD — Source mode constructs no IntersectionObserver; the WYSIWYG control constructs one", () => {
    expectFrameClockLive("T-4");
    mountSourceContainer();

    const spy = makeSpyView(STD_DOC, 14, 25);
    installView(spy);
    renderTOC({
      content: STD_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    const sourceList = entries();
    expect(sourceList).toHaveLength(3);
    expectDistinctKeys(sourceList, "T-4(a)");
    // (a) The double's constructor never throws — it registers and returns — so a count of
    // 0 means the constructor was never *entered*, not that it was entered and swallowed.
    expect(double.constructCount).toBe(0);

    cleanup();
    installView(null);

    // (b) The control, otherwise identical: the observer path is demonstrably live.
    const dom = mountWysiwygDom(STD_HEADINGS);
    renderTOC({
      content: STD_DOC,
      documentId: "doc-b",
      containerId: WYSIWYG_CONTAINER_ID,
      viewMode: "wysiwyg",
      enableSpyScrolling: true,
    });
    tick(300);

    const wysiwygList = entries();
    expect(wysiwygList).toHaveLength(3);
    expectDistinctKeys(wysiwygList, "T-4(b)");
    // `>= 1`, not `=== 1`: a *fresh mount* whose store already holds the previous row's
    // entries arms the observer once at mount and again after its own debounced parse
    // replaces the array. The load-bearing asymmetry is 0 against at-least-one, and an
    // exact count here would be pinning a fixture artefact rather than the routing.
    expect(double.constructCount).toBeGreaterThanOrEqual(1);

    act(() => {
      double.intersect(dom.headings[1], true);
    });
    expect(activeKey()).toBe(wysiwygList[1].key);
  });

  // -------------------------------------------------------------------------
  it("T-5: GUARD — Source mode never even reads globalThis.IntersectionObserver", () => {
    expectFrameClockLive("T-5");
    mountSourceContainer();

    let accesses = 0;
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      get() {
        accesses += 1;
        return undefined;
      },
    });

    try {
      const spy = makeSpyView(STD_DOC, 2, 25);
      installView(spy);
      renderTOC({
        content: STD_DOC,
        documentId: "doc-a",
        containerId: SOURCE_CONTAINER_ID,
        viewMode: "source",
        enableSpyScrolling: true,
      });
      tick(300);
      flushFrame();

      const list = entries();
      expect(list).toHaveLength(3);
      expectDistinctKeys(list, "T-5");

      // The strictly earlier question than T-4's: was the global read **at all**?
      expect(accesses).toBe(0);

      // Level 4 pairing — Source mode is alive and merely uninterested in the observer.
      spy.setGeo(14, 25);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey()).toBe(list[1].key);

      cleanup();
      installView(null);

      // Control: the counter is wired, and the *only* reason Source was quiet is that it
      // never looked. A `wysiwyg` render reads the global and blows up on `undefined`.
      mountWysiwygDom(STD_HEADINGS);
      expect(() => {
        renderTOC({
          content: STD_DOC,
          documentId: "doc-b",
          containerId: WYSIWYG_CONTAINER_ID,
          viewMode: "wysiwyg",
          enableSpyScrolling: true,
        });
        tick(300);
      }).toThrow();
      expect(accesses).toBeGreaterThanOrEqual(1);
    } finally {
      // §8 D-9 — `unstubGlobals: true` only reverts `vi.stubGlobal` records, and this is
      // a hand-defined property. It must be removed by hand.
      delete (globalThis as Record<string, unknown>).IntersectionObserver;
    }
  });

  // -------------------------------------------------------------------------
  it("T-6: default-on — omitting enableSpyScrolling in WYSIWYG keeps the observer live, and App.tsx no longer passes it", () => {
    const dom = mountWysiwygDom(STD_HEADINGS);

    // `enableSpyScrolling` omitted, exactly as App.tsx must now call it.
    renderTOC({
      content: STD_DOC,
      documentId: "doc-a",
      containerId: WYSIWYG_CONTAINER_ID,
      viewMode: "wysiwyg",
    });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "T-6");
    expect(double.constructCount).toBe(1);

    act(() => {
      double.intersect(dom.headings[1], true);
    });
    expect(activeKey()).toBe(list[1].key);
    expect(activeKey()).not.toBe(list[0].key);

    // ---- T-9, folded in: the structural supplement (Level 6, never a sole assertion).
    // Precedent for reading component source text: `tests/focus-trap.test.ts`.
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8");
    expect(appSource).not.toMatch(/enableSpyScrolling/);
    expect(appSource).not.toMatch(/yMargin/);

    // Clause 2: `viewMode` must **stay** in the call site. `resolveSpyMode(true, undefined)`
    // is `"dom"`, so dropping that one property silently restores the original bug with the
    // whole suite green — every other case here passes `viewMode` explicitly.
    const callStart = appSource.indexOf("useTOC({");
    expect(callStart, "App.tsx must call useTOC({ … })").toBeGreaterThanOrEqual(0);
    const callEnd = appSource.indexOf("})", callStart);
    expect(callEnd).toBeGreaterThan(callStart);
    const callArgs = appSource.slice(callStart, callEnd + 2);
    expect(callArgs).toMatch(/\bviewMode\b/);
  });

  // -------------------------------------------------------------------------
  it("T-7: master switch — enableSpyScrolling: false is inert in BOTH modes", () => {
    expectFrameClockLive("T-7");

    // ---- (a) wysiwyg, off
    const dom = mountWysiwygDom(STD_HEADINGS);
    renderTOC({
      content: STD_DOC,
      documentId: "doc-a",
      containerId: WYSIWYG_CONTAINER_ID,
      viewMode: "wysiwyg",
      enableSpyScrolling: false,
    });
    tick(300);

    const listA = entries();
    expect(listA).toHaveLength(3);
    expectDistinctKeys(listA, "T-7(a)");
    act(() => {
      double.intersect(dom.headings[1], true);
    });
    expect(double.constructCount).toBe(0);
    expect(activeKey()).toBeNull();

    // Wrong-reason guard: the same setup with the flag ON must move the highlight.
    cleanup();
    const constructsBeforeOn = double.constructCount;
    renderTOC({
      content: STD_DOC,
      documentId: "doc-a",
      containerId: WYSIWYG_CONTAINER_ID,
      viewMode: "wysiwyg",
      enableSpyScrolling: true,
    });
    tick(300);
    // Relative, for the reason given at T-4(b): a fresh mount over an already-populated
    // store arms the observer twice, which is fixture bookkeeping, not routing.
    expect(double.constructCount).toBeGreaterThan(constructsBeforeOn);
    act(() => {
      double.intersect(dom.headings[1], true);
    });
    expect(activeKey()).toBe(entries()[1].key);

    // ---- (b) source, off
    cleanup();
    useTOCStore.setState({ activeEntryId: null });
    mountSourceContainer();
    const spy = makeSpyView(STD_DOC, 14, 25);
    installView(spy);
    renderTOC({
      content: STD_DOC,
      documentId: "doc-b",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: false,
    });
    tick(300);
    flushFrame();
    scroll(spy.scrollDOM);
    flushFrame();

    const listB = entries();
    expect(listB).toHaveLength(3);
    expectDistinctKeys(listB, "T-7(b)");
    expect(spy.adds()).toBe(0);
    expect(activeKey()).toBeNull();

    // Wrong-reason guard again: flag ON, same fixture, must move.
    cleanup();
    renderTOC({
      content: STD_DOC,
      documentId: "doc-b",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();
    scroll(spy.scrollDOM);
    flushFrame();
    expect(spy.adds()).toBe(1);
    expect(activeKey()).toBe(entries()[1].key);
  });

  // -------------------------------------------------------------------------
  it("T-8: mode transition wysiwyg → source → wysiwyg, one live mechanism per stop and no leak", () => {
    expectFrameClockLive("T-8");

    const dom = mountWysiwygDom(OFFSET_HEADINGS);
    mountSourceContainer();
    // The two mechanisms are aimed at DIFFERENT headings at every stop, so "the highlight
    // is right" can never be satisfied by both being live.
    const spy = makeSpyView(OFFSET_DOC, 14, 25);
    expectFixtureGeometry(spy.fake);
    installView(spy);

    const { rerender, unmount } = renderTOC({
      content: OFFSET_DOC,
      documentId: "doc-a",
      containerId: WYSIWYG_CONTAINER_ID,
      viewMode: "wysiwyg",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "T-8");
    expectHeadingLines(list, OFFSET_LINES);

    // ---- stop 1: wysiwyg
    expect(double.constructCount).toBe(1);
    expect(spy.adds()).toBe(0);
    // The other mode's stimulus: the line spy would answer `entries[1]` for this geometry.
    scroll(spy.scrollDOM);
    flushFrame();
    expect(activeKey()).toBeNull();
    // This mode's own stimulus.
    act(() => {
      double.intersect(dom.headings[2], true);
    });
    expect(activeKey()).toBe(list[2].key);

    // ---- stop 2: source. Enter on an above-first anchor, so the attach sample cannot
    // move the highlight and a jump would be visible as one.
    spy.setGeo(2, 10);
    rerender({
      content: OFFSET_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    expect(double.constructCount).toBe(1);
    expect(double.disconnectCount).toBe(1);
    expect(spy.adds()).toBe(1);
    expect(activeKey()).toBe(list[2].key);

    // The other mode's stimulus: the observer is disconnected, so nothing is delivered.
    act(() => {
      double.intersect(dom.headings[0], true);
    });
    expect(activeKey()).toBe(list[2].key);
    // This mode's own stimulus, aimed at a different heading than the observer was.
    spy.setGeo(14, 25);
    scroll(spy.scrollDOM);
    flushFrame();
    expect(activeKey()).toBe(list[1].key);

    // ---- stop 3: back to wysiwyg
    rerender({
      content: OFFSET_DOC,
      documentId: "doc-a",
      containerId: WYSIWYG_CONTAINER_ID,
      viewMode: "wysiwyg",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    expect(double.constructCount).toBe(2);
    expect(double.disconnectCount).toBe(1);
    expect(spy.adds()).toBe(1);
    expect(spy.removes()).toBe(1);

    // The other mode's stimulus: this geometry would answer `entries[2]` if the line spy
    // were still live.
    spy.setGeo(30, 40);
    scroll(spy.scrollDOM);
    flushFrame();
    expect(activeKey()).toBe(list[1].key);
    // This mode's own stimulus, aimed at a third heading.
    act(() => {
      double.intersect(dom.headings[0], true);
    });
    expect(activeKey()).toBe(list[0].key);

    // ---- teardown: every construction disconnected, every listener removed.
    unmount();
    expect(double.disconnectCount).toBe(double.constructCount);
    expect(spy.removes()).toBe(spy.adds());
    expect(spy.adds()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  it("T-10: UseTOCReturn is unchanged — eight members, same types", () => {
    mountSourceContainer();
    const spy = makeSpyView(STD_DOC, 2, 25);
    installView(spy);

    const { result } = renderTOC({
      content: STD_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
    });
    tick(300);

    expect(Object.keys(result.current).sort()).toEqual([
      "activeEntryId",
      "collapsedIds",
      "entries",
      "hierarchy",
      "isVisible",
      "navigateToEntry",
      "toggleCollapsed",
      "toggleVisibility",
    ]);

    // Compile-time, proven by `pnpm typecheck:tests` (§0.14). Mutual assignability, so an
    // ADDED member fails here too — see the header's deviation note on why the shape is
    // written locally rather than imported.
    type PinnedReturn = {
      entries: TOCEntry[];
      hierarchy: TOCEntry[];
      activeEntryId: HeadingKey | null;
      isVisible: boolean;
      toggleVisibility: () => void;
      navigateToEntry: (key: HeadingKey) => void;
      collapsedIds: Set<HeadingKey>;
      toggleCollapsed: (key: HeadingKey) => void;
    };
    const asPinned: PinnedReturn = result.current;
    const asReturned: ReturnType<typeof useTOC> = asPinned;
    expect(asReturned).toBe(result.current);
  });

  // -------------------------------------------------------------------------
  it("T-11: a clicked tail heading at the limit survives its own scroll; scrolling up releases it", () => {
    expectFrameClockLive("T-11");
    mountSourceContainer();

    // §6.0.1 note, so a later reader does not delete the import as a rule violation:
    // `AT_LIMIT_SCROLL` / `MID_SCROLL` come from `./helpers/fakeCodemirrorView`, which
    // this file already imports at the top. §6.0.1 forbids importing the `src/` modules
    // under test — `tocSpyMode`, `tocLineSpy`, `codemirrorViewportLine`,
    // `useSourceScrollSpy` — so a red cannot degenerate into "a file does not exist
    // yet". A test helper is not a subject.
    const spy = makeSpyView(TAIL_DOC, 78, 100, AT_LIMIT_SCROLL);
    expectFixtureGeometry(spy.fake);
    installView(spy);

    const { result } = renderTOC({
      content: TAIL_DOC,
      documentId: "doc-a",
      containerId: SOURCE_CONTAINER_ID,
      viewMode: "source",
      enableSpyScrolling: true,
    });
    tick(300);
    flushFrame();

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "T-11");
    expectHeadingLines(list, TAIL_LINES);
    // With nothing to retain, the clamped anchor lands on `list[1]`, so the raw sample
    // genuinely disagrees with the retained answer asserted below.
    expect(activeKey()).toBe(list[1].key);

    // The real navigate dispatch — what clicking the tail outline entry does.
    act(() => {
      result.current.navigateToEntry(list[2].key);
    });
    expect(spy.dispatches).toHaveLength(1);
    expect(activeKey()).toBe(list[2].key);

    // "Nothing but the scroll metrics changed", made executable: the probed coordinates
    // and the reported rect are snapshotted here and asserted unchanged at the end.
    // `setGeo` is never called anywhere in this case.
    const probeCoords = (): string[] =>
      [...new Set(spy.fake.probeLog.map((p) => `${p.x},${p.y}`))].sort();
    const probesBefore = probeCoords();
    const rectBottomBefore = spy.fake.scrollDOM.getBoundingClientRect().bottom;
    expect(probesBefore.length).toBeGreaterThan(0);

    // --- at the limit: the heading survives the scroll its own navigate fires
    const heldWrites = recordWrites();
    scroll(spy.scrollDOM);
    flushFrame();
    heldWrites.stop();
    expect(activeKey(), "at the limit the clicked tail heading is retained").toBe(list[2].key);
    expect(heldWrites.observed).toEqual([]);
    expect(heldWrites.entriesStable()).toBe(true);

    // --- off the limit: the same line geometry now follows the anchor -------
    spy.fake.setScrollMetrics(MID_SCROLL);
    expect(spy.fake.scrollDOM.scrollTop).toBe(MID_SCROLL.scrollTop);
    const movedWrites = recordWrites();
    scroll(spy.scrollDOM);
    flushFrame();
    movedWrites.stop();

    expect(activeKey(), "off the limit the highlight follows the anchor").toBe(list[1].key);
    expect(movedWrites.observed, "exactly one store write").toEqual([list[1].key]);
    expect(movedWrites.entriesStable()).toBe(true);

    // The line geometry never moved: same probe coordinates, same rect.
    expect(probeCoords(), "the pixel→line mapping is unchanged").toEqual(probesBefore);
    expect(spy.fake.scrollDOM.getBoundingClientRect().bottom).toBe(rectBottomBefore);
  });
});
