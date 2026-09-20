/**
 * Purpose: WI-4 — `src/hooks/useSourceScrollSpy.ts`, the React wiring that composes the
 * three pure units (`readSpyLineRange` → `pickActiveKeyByLine` → `retainVisibleActiveKey`)
 * into a throttled scroll listener on the source editor's scroller.
 *
 * Matrix §5 of `.claude/tdd-guardian/tests-20260919-151931.md`, cases **H-0 … H-17**.
 * §0 is binding throughout.
 *
 * ---------------------------------------------------------------------------
 * The three laws
 * ---------------------------------------------------------------------------
 *   1. **Idempotence** (H-6) — repeated identical samples produce at most one store
 *      write. This is the *redundancy filter*, not the frame throttle; no amount of
 *      frame flushing exercises it, which is why H-5 and H-6 are different cases.
 *   2. **Retention** (H-2, H-3, H-16) — a `null` composed result never mutates state.
 *      `null` from the geometry seam means "retain", never "blank" and never "detach".
 *   3. **Listener conservation** (H-15) — at any moment the number of live `scroll`
 *      listeners this hook owns is exactly 1 when enabled with a view, and 0 otherwise.
 *
 * ---------------------------------------------------------------------------
 * Mock boundary, and the obligation it creates
 * ---------------------------------------------------------------------------
 * Real: `tocStore` (and its real key coordinator), `useEditorStore`, the jsdom `<div>`
 * that is `scrollDOM`, the real `EditorState`, the real DOM `scroll` event, and all
 * three pure units. Faked: **CodeMirror geometry only** (§0.8), `requestAnimationFrame`
 * via `vi.useFakeTimers()` (§0.10), and `loggingService` (§0.12).
 *
 * jsdom implements no layout, so every case here is blind to whether the anchor points
 * at the line a reader is actually looking at. **The integration obligation is UNMET**
 * and is discharged by WI-7 manual QA (QA-1 … QA-8). A green file here is not evidence
 * the highlight follows the reader.
 *
 * ---------------------------------------------------------------------------
 * Deviations from the matrix text, stated rather than silent
 * ---------------------------------------------------------------------------
 * - **H-1** mounts with an attach geometry that resolves to `entries[0]` and *then*
 *   scrolls to the line-14 anchor, instead of using one geometry for both. The matrix's
 *   literal input would have the attach sample already produce the expected key, making
 *   "a scroll moves the highlight" vacuous. The assertion is unchanged and the case is
 *   strictly stronger: the pre-scroll value is asserted to be a *different* key first.
 * - **H-17** runs row (b) on the same mount row (a) leaves behind (same `editorView`,
 *   same `enabled`, same geometry), which is what the case's own preamble requires.
 */
import { act, renderHook } from "@testing-library/react";
// A second import from the same module, deliberately: the line above is a recorded
// specification line (the red receipt fingerprints every line of this file), and
// widening it would read as the specification moving. `cleanup` is needed by the
// multi-row cases whose earlier row renders a hook it cannot capture a handle to —
// see the note at H-7 row (c) and H-13 row (a).
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSourceScrollSpy } from "../src/hooks/useSourceScrollSpy";
import { loggingService } from "../src/services/loggingService";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { useEditorStore } from "../src/stores/editorStore";
import { useTOCStore } from "../src/stores/tocStore";
import { asAnchorSlug } from "../src/types/toc";
import type { HeadingKey, ParsedTOCEntry, TOCEntry } from "../src/types/toc";
import { readSpyLineRange } from "../src/utils/codemirrorViewportLine";
import { pickActiveKeyByLine, retainVisibleActiveKey } from "../src/utils/tocLineSpy";
import {
  AT_LIMIT_SCROLL,
  createFakeView,
  DEFAULT_FIXTURE_RECT,
  expectFixtureGeometry,
  MID_SCROLL,
  ZERO_RECT,
} from "./helpers/fakeCodemirrorView";
import type { FakeViewFixture, FixtureScrollMetrics } from "./helpers/fakeCodemirrorView";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";

// §0.12 — the established logging double. Log assertions are Level 6 supplements and
// are never a case's sole assertion.
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: () => "test-action-id" },
}));

const realSetEntries = useTOCStore.getState().setEntries;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface SpyProps {
  entries: TOCEntry[];
  documentId: string | null;
  enabled: boolean;
}

interface HeadingSpec {
  line: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

/**
 * A markdown document of exactly `lineCount` lines with ATX headings at the named
 * 1-based lines. Filler lines carry no `-` so no setext heading can form by accident.
 */
function buildDoc(lineCount: number, headings: readonly HeadingSpec[]): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i += 1) lines.push(`filler line ${i}`);
  for (const h of headings) lines[h.line - 1] = `${"#".repeat(h.level)} ${h.text}`;
  return lines.join("\n");
}

function parseToEntries(content: string): ParsedTOCEntry[] {
  return parseHeadingsFromContent(content).map((h) => ({
    anchorSlug: asAnchorSlug(h.id),
    level: h.level as 1 | 2 | 3 | 4 | 5 | 6,
    text: h.text,
    lineNumber: h.line,
    offset: h.offset,
  }));
}

/** Push a revision through the **real** store and hand back the keyed entries. */
function installEntries(content: string, documentId: string | null): TOCEntry[] {
  act(() => {
    useTOCStore.getState().setEntries(parseToEntries(content), documentId);
  });
  return useTOCStore.getState().entries;
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

let fixtures: FakeViewFixture[] = [];

interface SpyView {
  fake: FakeViewFixture;
  scrollDOM: HTMLDivElement;
  /** Swap the pixel→line mapping on a live view; the rect is untouched. */
  setGeo: (topLine: number, bottomLine: number) => void;
  /** `scroll` listeners added / removed on this scroller, counted by call-through spies. */
  adds: () => number;
  removes: () => number;
}

/**
 * A fake view whose anchor probe resolves to `top` and whose bottom probe resolves to
 * `bottom`, both changeable mid-test.
 *
 * With `DEFAULT_FIXTURE_RECT` the seam probes `y = 40` (anchor) and `y = 599` (bottom).
 * With `ZERO_RECT` it probes `y = 40` and `y = -1`; the `y <= 0` branch answers line 1,
 * so a `top` above 1 inverts the pair and the **real** `readSpyLineRange` returns `null`
 * — which is the degenerate route H-16(b) needs.
 *
 * `scroll` defaults to `MID_SCROLL` — a healthy scroller a long way from either end,
 * which is what an ordinary case means. Defaulting to `AT_LIMIT_SCROLL` would re-enable
 * the tail clamp across every case in this file and hide the directional-freeze defect;
 * the two cases that genuinely mean "at the bottom" (H-3, H-19 mount A) say so.
 */
function makeSpyView(
  doc: string,
  top: number,
  bottom: number,
  scroll: FixtureScrollMetrics = MID_SCROLL,
): SpyView {
  let geo = { top, bottom };
  const fake = createFakeView({
    doc,
    lineAtY: (y) => (y <= 0 ? 1 : y >= DEFAULT_FIXTURE_RECT.bottom - 1 ? geo.bottom : geo.top),
    scroll,
  });
  fixtures.push(fake);
  const addSpy = vi.spyOn(fake.scrollDOM, "addEventListener");
  const removeSpy = vi.spyOn(fake.scrollDOM, "removeEventListener");
  return {
    fake,
    scrollDOM: fake.scrollDOM,
    setGeo: (nextTop, nextBottom) => {
      geo = { top: nextTop, bottom: nextBottom };
    },
    adds: () => addSpy.mock.calls.filter((call) => call[0] === "scroll").length,
    removes: () => removeSpy.mock.calls.filter((call) => call[0] === "scroll").length,
  };
}

function renderSpy(initialProps: SpyProps) {
  return renderHook((props: SpyProps) => useSourceScrollSpy(props), { initialProps });
}

function installView(spy: SpyView | null): void {
  act(() => {
    useEditorStore.setState({ editorView: spy ? spy.fake.view : null });
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

function activeKey(): HeadingKey | null {
  return useTOCStore.getState().activeEntryId;
}

function logCount(): number {
  return vi.mocked(loggingService.logEventSync).mock.calls.length;
}

/**
 * H-0 / §0.10 — proves `advanceTimersToNextFrame` really runs rAF callbacks **in this
 * case's timer state**, independently of the code under test. A throttle test that
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

/**
 * §0.11 — mock-free write counting. Records every value the real store subscriber
 * observes, so a case can assert a *sequence*, not merely a count. `setActiveEntry` is
 * deliberately never wrapped: it sits in the hook's effect deps.
 */
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

/** The composed expectation, computed from the **real** pure functions. */
function composeExpected(
  spy: SpyView,
  entries: readonly TOCEntry[],
  current: HeadingKey | null,
): HeadingKey | null {
  const range = readSpyLineRange(spy.fake.view);
  if (range === null) return current;
  const picked = pickActiveKeyByLine(entries, range.topLine);
  // `range.atScrollLimit` by property name, from the same sample: the composition stays
  // computed from the **real** pure functions rather than transcribing the hook's answer,
  // so H-15 / H-16(c) / H-17 self-adjust instead of recording the implementation.
  const retained = retainVisibleActiveKey(
    picked,
    current,
    entries,
    range.topLine,
    range.bottomLine,
    range.atScrollLimit,
  );
  return retained ?? current;
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

beforeEach(() => {
  vi.useFakeTimers();
  fixtures = [];
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
  useEditorStore.setState({ editorView: null });
  vi.useRealTimers();
});

describe("useSourceScrollSpy — matrix §5 (WI-4)", () => {
  // -------------------------------------------------------------------------
  it("H-0: the frame clock is live — advanceTimersToNextFrame runs rAF callbacks", () => {
    expect(vi.isFakeTimers()).toBe(true);
    let sentinel = false;
    requestAnimationFrame(() => {
      sentinel = true;
    });
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(sentinel).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("H-1: a scroll moves the highlight to the heading at the anchor", () => {
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-1");
    expectHeadingLines(entries, STD_LINES);

    const spy = makeSpyView(STD_DOC, 2, 10);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    // Pre-scroll control: the attach sample landed somewhere else entirely, so the
    // scroll below is what moves the highlight.
    expect(activeKey()).toBe(entries[0].key);

    spy.setGeo(14, 29);
    scroll(spy.scrollDOM);
    flushFrame();

    expect(activeKey()).toBe(entries[1].key);
    expect(activeKey()).not.toBe(entries[0].key);
    expect(activeKey()).not.toBe(entries[2].key);
  });

  // -------------------------------------------------------------------------
  it("H-2: retention — an anchor above the first heading preserves the previous highlight", () => {
    const doc = buildDoc(100, [
      { line: 5, level: 1, text: "Alpha" },
      { line: 12, level: 2, text: "Beta" },
      { line: 30, level: 2, text: "Gamma" },
    ]);
    const entries = installEntries(doc, "doc-a");
    expectDistinctKeys(entries, "H-2");
    expectHeadingLines(entries, [5, 12, 30]);

    const spy = makeSpyView(doc, 14, 29);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    scroll(spy.scrollDOM);
    flushFrame();
    // Mandatory wrong-reason guard: "unchanged" must not be satisfiable by "never set".
    expect(activeKey()).toBe(entries[1].key);

    // S2 — the whole above-first band. (1,4) and (2,10) make the raw pick `null` with
    // the current heading off-screen; (4,30) makes it `null` with the current heading
    // visible. All three must preserve.
    for (const [top, bottom] of [
      [1, 4],
      [2, 10],
      [4, 30],
    ]) {
      expect(pickActiveKeyByLine(entries, top)).toBeNull();
      spy.setGeo(top, bottom);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey(), `anchor ${top}: the highlight must be retained`).toBe(entries[1].key);
      expect(activeKey()).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  it("H-3: TAIL CLAMP — an EOF-clamped anchor keeps the visible last heading highlighted", () => {
    const doc = buildDoc(100, [
      { line: 1, level: 1, text: "Alpha" },
      { line: 40, level: 2, text: "Beta" },
      { line: 90, level: 2, text: "Gamma" },
    ]);
    const entries = installEntries(doc, "doc-a");
    expectDistinctKeys(entries, "H-3"); // clause 1
    expectHeadingLines(entries, [1, 40, 90]);
    // clause 2 — the raw sample genuinely disagrees with the retained answer.
    expect(pickActiveKeyByLine(entries, 78)).toBe(entries[1].key);
    // clause 3 — the tail heading really is below the clamped anchor and on screen.
    expect(entries[2].lineNumber).toBeGreaterThan(78);
    expect(entries[2].lineNumber).toBeLessThanOrEqual(100);

    // SPY-WI-4 fixture change, not an expectation change: this case has always *meant*
    // "the user clicked the tail heading and the scroller is at the bottom". That
    // condition was unstated only because the pure layer could not read it. Left at the
    // default `MID_SCROLL` the case would now assert the directional-freeze defect.
    const spy = makeSpyView(doc, 78, 100, AT_LIMIT_SCROLL);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    // What `useTOC.ts:154` does today when the user clicks the last outline entry.
    act(() => {
      useTOCStore.getState().setActiveEntry(entries[2].key);
    });
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();

    const recorder = recordWrites();
    scroll(spy.scrollDOM);
    flushFrame();
    recorder.stop();

    expect(activeKey()).toBe(entries[2].key);
    expect(recorder.observed, "no store write while the tail heading stays visible").toEqual([]);
    expect(recorder.entriesStable()).toBe(true);

    // clause 4 — NEGATIVE CONTROL. With the tail heading genuinely below the viewport
    // the highlight must move, which kills "never writes" and "pins once set".
    spy.setGeo(78, 79);
    scroll(spy.scrollDOM);
    flushFrame();
    expect(activeKey()).toBe(entries[1].key);
  });

  // -------------------------------------------------------------------------
  it("H-4: duplicate headings — crossing line 40 moves the highlight to the second one", () => {
    const doc = buildDoc(80, [
      { line: 3, level: 2, text: "Intro" },
      { line: 40, level: 2, text: "Intro" },
    ]);
    const entries = installEntries(doc, "doc-a");
    expectDistinctKeys(entries, "H-4");
    expectHeadingLines(entries, [3, 40]);
    // Wrong-reason guard: a text-keyed implementation would collapse these two.
    expect(entries[0].text).toBe(entries[1].text);
    expect(entries[0].level).toBe(entries[1].level);

    const spy = makeSpyView(doc, 3, 30);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    // The attach-time sample (AC 9, pinned by H-14) already wrote `entries[0].key`
    // above, at geometry (3, 30) — which is also the first geometry in the loop below.
    // Without this reset the loop's first sample is a no-op for the redundancy filter
    // and only one of the two transitions the case is about falls inside the counting
    // window. Clearing the highlight here makes the window start from "nothing active",
    // which is what the case means by "crossing line 40 moves the highlight"; it does
    // not weaken the assertion — `seen` and the write count are unchanged in intent.
    act(() => {
      useTOCStore.getState().setActiveEntry(null);
    });

    const recorder = recordWrites();
    const seen: Array<HeadingKey | null> = [];
    for (const [top, bottom] of [
      [3, 30],
      [39, 60],
      [40, 60],
      [41, 70],
    ]) {
      spy.setGeo(top, bottom);
      scroll(spy.scrollDOM);
      flushFrame();
      seen.push(activeKey());
    }
    recorder.stop();

    expect(seen).toEqual([entries[0].key, entries[0].key, entries[1].key, entries[1].key]);
    expect(recorder.observed).toHaveLength(2);
    expect(recorder.entriesStable()).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("H-5: throttle — N synchronous scrolls inside one frame produce exactly one write", () => {
    expectFrameClockLive("H-5");
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-5");
    const spy = makeSpyView(STD_DOC, 2, 10);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    expect(activeKey(), "attach-frame baseline (§0.10)").toBe(entries[0].key);

    // N = 5, with the geometry changed mid-burst: the sample must be read at frame
    // time, not captured at the first event.
    let recorder = recordWrites();
    spy.setGeo(14, 29);
    scroll(spy.scrollDOM);
    scroll(spy.scrollDOM);
    scroll(spy.scrollDOM);
    spy.setGeo(31, 60);
    scroll(spy.scrollDOM);
    scroll(spy.scrollDOM);
    flushFrame();
    recorder.stop();
    expect(recorder.observed).toHaveLength(1);
    expect(recorder.entriesStable()).toBe(true);
    expect(activeKey(), "the final geometry wins, not the first").toBe(entries[2].key);

    // N = 1
    recorder = recordWrites();
    spy.setGeo(2, 10);
    scroll(spy.scrollDOM);
    flushFrame();
    recorder.stop();
    expect(recorder.observed).toHaveLength(1);
    expect(activeKey()).toBe(entries[0].key);

    // N = 20
    recorder = recordWrites();
    spy.setGeo(14, 29);
    for (let i = 0; i < 20; i += 1) scroll(spy.scrollDOM);
    flushFrame();
    recorder.stop();
    expect(recorder.observed).toHaveLength(1);
    expect(activeKey()).toBe(entries[1].key);
  });

  // -------------------------------------------------------------------------
  it("H-6: LAW idempotence — three identical samples in three frames are one write", () => {
    expectFrameClockLive("H-6");
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-6");
    const spy = makeSpyView(STD_DOC, 2, 10);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    expect(activeKey()).toBe(entries[0].key);

    const recorder = recordWrites();
    spy.setGeo(14, 29);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey(), `cycle ${cycle}`).toBe(entries[1].key);
    }
    expect(recorder.observed, "the redundancy filter must suppress writes 2 and 3").toHaveLength(1);

    // Wrong-reason guard: the counter is live and the filter is not "never write".
    spy.setGeo(31, 60);
    scroll(spy.scrollDOM);
    flushFrame();
    recorder.stop();
    expect(recorder.observed).toHaveLength(2);
    expect(activeKey()).toBe(entries[2].key);
    expect(recorder.entriesStable()).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("H-7: every teardown detaches and cancels the pending frame", () => {
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-7");

    // --- row (a): post-teardown control -----------------------------------
    expectFrameClockLive("H-7(a)");
    {
      const spy = makeSpyView(STD_DOC, 2, 10);
      installView(spy);
      const hook = renderSpy({ entries, documentId: "doc-a", enabled: true });
      flushFrame();
      // Guard 1: a control scroll must have MOVED the highlight.
      spy.setGeo(14, 29);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey()).toBe(entries[1].key);

      hook.unmount();
      expect(spy.removes()).toBe(spy.adds());

      const recorder = recordWrites();
      spy.setGeo(31, 60);
      scroll(spy.scrollDOM);
      flushFrame();
      recorder.stop();
      expect(recorder.observed, "row (a): nothing may be written after unmount").toEqual([]);
      expect(activeKey()).toBe(entries[1].key);
    }

    // --- row (b): scroll, then unmount before the frame flushes ------------
    expectFrameClockLive("H-7(b)");
    {
      const spy = makeSpyView(STD_DOC, 2, 10);
      installView(spy);
      const hook = renderSpy({ entries, documentId: "doc-a", enabled: true });
      flushFrame();
      spy.setGeo(14, 29);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey()).toBe(entries[1].key);

      const recorder = recordWrites();
      spy.setGeo(31, 60);
      scroll(spy.scrollDOM); // frame pending
      hook.unmount();
      flushFrame();
      recorder.stop();
      expect(recorder.observed, "row (b): the pending frame must be cancelled").toEqual([]);
      expect(activeKey()).toBe(entries[1].key);
      expect(spy.removes()).toBe(spy.adds());
    }

    // --- rows (c)/(d): the leaked-frame keys -------------------------------
    // Three keys must be pairwise distinct or a leaked frame is swallowed by the
    // "write only if different" filter and the row passes green with the frame leaked.
    const keyA = entries[1].key; // control-scroll geometry (14, 29)
    const keyLeak = entries[2].key; // third geometry (31, 60)
    const keyB = entries[0].key; // view B's attach geometry (2, 10)
    expect(new Set([keyA, keyB, keyLeak]).size).toBe(3);

    // --- row (c): view swap with a frame pending ---------------------------
    expectFrameClockLive("H-7(c)");
    {
      const viewA = makeSpyView(STD_DOC, 2, 10);
      const viewB = makeSpyView(STD_DOC, 2, 10);
      installView(viewA);
      renderSpy({ entries, documentId: "doc-a", enabled: true });
      flushFrame();
      viewA.setGeo(14, 29);
      scroll(viewA.scrollDOM);
      flushFrame();
      expect(activeKey(), "row (c) control: the highlight moved before teardown").toBe(keyA);

      const recorder = recordWrites();
      viewA.setGeo(31, 60); // would produce keyLeak
      scroll(viewA.scrollDOM); // frame pending
      installView(viewB); // teardown trigger
      flushFrame();
      recorder.stop();

      expect(recorder.observed, "row (c): the leaked frame's key must never appear").not.toContain(
        keyLeak,
      );
      expect(recorder.observed).toEqual([keyB]);
      expect(viewA.removes()).toBe(viewA.adds());
      expect(viewB.adds()).toBe(1);
      expect(viewB.removes()).toBe(0);
    }
    // Row (c)'s `renderSpy` is inside an expression whose result the row does not bind,
    // so unlike rows (a)/(b) it has no `hook` handle to unmount. Left mounted it stays
    // *enabled*, and row (d) would then run with two live hooks on one scroller: the
    // `rerender({ enabled: false })` disables only row (d)'s, and row (c)'s pending
    // frame — correctly uncancelled, because nothing tore that hook down — writes
    // `keyLeak`. That is a fixture defect, not the leak row (d) is hunting.
    cleanup();

    // --- row (d): disable with a frame pending -----------------------------
    expectFrameClockLive("H-7(d)");
    {
      useTOCStore.getState().setActiveEntry(null);
      const spy = makeSpyView(STD_DOC, 2, 10);
      installView(spy);
      const hook = renderSpy({ entries, documentId: "doc-a", enabled: true });
      flushFrame();
      spy.setGeo(14, 29);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey(), "row (d) control: the highlight moved before teardown").toBe(keyA);

      const recorder = recordWrites();
      spy.setGeo(31, 60); // would produce keyLeak
      scroll(spy.scrollDOM); // frame pending
      act(() => {
        hook.rerender({ entries, documentId: "doc-a", enabled: false });
      });
      flushFrame();
      recorder.stop();

      expect(recorder.observed).not.toContain(keyLeak);
      expect(recorder.observed).toEqual([]);
      expect(activeKey()).toBe(keyA);
      expect(spy.removes()).toBe(spy.adds());
    }
  });

  // -------------------------------------------------------------------------
  it("H-8: view swap — the old scroller goes dead, the new one goes live", () => {
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-8");
    const viewA = makeSpyView(STD_DOC, 2, 10);
    const viewB = makeSpyView(STD_DOC, 31, 60);
    expectFixtureGeometry(viewA.fake);
    expectFixtureGeometry(viewB.fake);

    installView(viewA);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    viewA.setGeo(14, 29);
    scroll(viewA.scrollDOM);
    flushFrame();
    expect(activeKey(), "control: A's scroller is live before the swap").toBe(entries[1].key);

    installView(viewB);
    flushFrame();
    expect(activeKey(), "B's attach sample").toBe(entries[2].key);
    expect(viewA.removes(), "A's listener is removed exactly once at swap time").toBe(1);
    expect(viewA.adds()).toBe(1);

    const recorder = recordWrites();
    // Wrong-reason guard: A's geometry maps to a DIFFERENT heading than B's, so
    // "scrolling A changed nothing" cannot be satisfied by the two views agreeing.
    viewA.setGeo(2, 10);
    scroll(viewA.scrollDOM);
    flushFrame();
    expect(activeKey(), "the dead scroller must change nothing").toBe(entries[2].key);

    viewB.setGeo(2, 10);
    scroll(viewB.scrollDOM);
    flushFrame();
    recorder.stop();
    expect(activeKey(), "the live scroller moves the highlight").toBe(entries[0].key);
    expect(recorder.observed, "exactly one write, from B only").toEqual([entries[0].key]);
  });

  // -------------------------------------------------------------------------
  it("H-9: a re-parse re-samples but never re-attaches, and uses the newest entries", () => {
    // D-8 — the revisions must genuinely RETIRE the target heading's key. The
    // coordination contract preserves keys across renames, so each revision changes the
    // target heading's LEVEL, which defeats pass 1 (group key) and pass 2 (level test).
    const revision = (level: 1 | 2 | 3 | 4 | 5 | 6) =>
      buildDoc(100, [
        { line: 1, level: 1, text: "Alpha" },
        { line: 12, level, text: "Beta" },
        { line: 30, level: 2, text: "Gamma" },
      ]);

    const firstEntries = installEntries(revision(2), "doc-a");
    expectDistinctKeys(firstEntries, "H-9 rev1");
    expectHeadingLines(firstEntries, STD_LINES);

    const spy = makeSpyView(revision(2), 2, 10);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    const hook = renderSpy({ entries: firstEntries, documentId: "doc-a", enabled: true });
    flushFrame();

    const addsAfterAttach = spy.adds();
    const logsAfterAttach = logCount();
    expect(addsAfterAttach).toBe(1);

    let latest = firstEntries;
    for (const level of [3, 4, 5] as const) {
      latest = installEntries(revision(level), "doc-a");
      expectDistinctKeys(latest, `H-9 rev level ${level}`);
      act(() => {
        hook.rerender({ entries: latest, documentId: "doc-a", enabled: true });
      });
    }

    spy.setGeo(14, 29);
    scroll(spy.scrollDOM);
    flushFrame();

    // Level 6 supplements: re-sampling must not become re-attaching or re-logging.
    expect(spy.adds(), "R-5: the listener must not re-attach on a re-parse").toBe(addsAfterAttach);
    expect(spy.removes()).toBe(0);
    expect(logCount(), "R-5: no log event per re-parse").toBe(logsAfterAttach);

    // Level 4 with the load-bearing guard: the resolved key exists ONLY in the newest
    // array, so "uses the new entries" cannot be satisfied by a stale ref.
    expect(activeKey()).toBe(latest[1].key);
    expect(firstEntries.some((e) => e.key === activeKey())).toBe(false);
    expect(latest.some((e) => e.key === activeKey())).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("H-10: no per-scroll logging", () => {
    expectFrameClockLive("H-10");
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-10");
    const spy = makeSpyView(STD_DOC, 2, 10);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    const baseline = logCount();
    expect(baseline).toBeGreaterThan(0);

    const geometries: Array<[number, number]> = [
      [2, 10],
      [14, 29],
      [31, 60],
    ];
    const seen = new Set<HeadingKey | null>();
    for (let i = 0; i < 20; i += 1) {
      const [top, bottom] = geometries[i % geometries.length];
      spy.setGeo(top, bottom);
      scroll(spy.scrollDOM);
      flushFrame();
      seen.add(activeKey());
    }

    expect(logCount(), "zero log events per scroll").toBe(baseline);
    // Wrong-reason guard: "no logging" must not be satisfied by a hook that does nothing.
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(activeKey()).toBe(entries[1].key);
  });

  // -------------------------------------------------------------------------
  it("H-11: the attach log carries the documented event name and context", () => {
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-11");
    expect(entries).toHaveLength(3);
    const spy = makeSpyView(STD_DOC, 14, 29);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();

    // Level 4 — paired, never a lone log assertion.
    expect(activeKey()).toBe(entries[1].key);

    const calls = vi.mocked(loggingService.logEventSync).mock.calls;
    expect(calls).toHaveLength(1);
    const payload = calls[0][0];
    expect(payload.event).toBe("ui.toc.spy.attach");
    expect(payload.level).toBe("info");
    expect(payload.status).toBe("success");
    expect(payload.context).toMatchObject({
      documentId: "doc-a",
      entryCount: useTOCStore.getState().entries.length,
      mode: "source",
    });
  });

  // -------------------------------------------------------------------------
  it("H-12: enabled:false attaches nothing, logs nothing, changes nothing", () => {
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-12");

    // --- row (a): disabled from mount --------------------------------------
    {
      const spy = makeSpyView(STD_DOC, 14, 29);
      installView(spy);
      renderSpy({ entries, documentId: "doc-a", enabled: false });
      flushFrame();
      scroll(spy.scrollDOM);
      flushFrame();
      expect(spy.adds(), "row (a): no scroll listener may be attached").toBe(0);
      expect(logCount()).toBe(0);
      expect(activeKey()).toBeNull();
    }

    // --- row (b): enabled, then disabled by re-render -----------------------
    {
      const spy = makeSpyView(STD_DOC, 2, 10);
      installView(spy);
      const hook = renderSpy({ entries, documentId: "doc-a", enabled: true });
      flushFrame();
      spy.setGeo(14, 29);
      scroll(spy.scrollDOM);
      flushFrame();
      expect(activeKey(), "row (b) pre-assertion: the highlight moved while enabled").toBe(
        entries[1].key,
      );

      act(() => {
        hook.rerender({ entries, documentId: "doc-a", enabled: false });
      });
      spy.setGeo(31, 60);
      scroll(spy.scrollDOM);
      flushFrame();

      expect(activeKey(), "row (b): frozen at its pre-disable value").toBe(entries[1].key);
      expect(spy.removes()).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  it("H-13: a null editorView is a no-op, not a throw", () => {
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-13");

    // --- row (a): null at mount --------------------------------------------
    {
      useEditorStore.setState({ editorView: null });
      expect(() => {
        renderSpy({ entries, documentId: "doc-a", enabled: true });
        flushFrame();
      }).not.toThrow();
      expect(activeKey()).toBeNull();
    }
    // Row (a) renders inside `not.toThrow()`, so it has no `hook` handle to unmount.
    // Left mounted it would attach a *second* listener to row (b)'s scroller the moment
    // `installView(spy)` runs, and row (b)'s `spy.removes()).toBe(1)` would see 2.
    // Fixture defect, not an implementation one — each hook adds and removes exactly one.
    cleanup();

    // --- row (b): null arriving by re-render --------------------------------
    {
      const spy = makeSpyView(STD_DOC, 14, 29);
      installView(spy);
      renderSpy({ entries, documentId: "doc-a", enabled: true });
      flushFrame();
      expect(activeKey()).toBe(entries[1].key);

      expect(() => {
        installView(null);
        flushFrame();
      }).not.toThrow();
      expect(activeKey(), "row (b): the highlight is unchanged").toBe(entries[1].key);
      expect(spy.removes()).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  it("H-14: one sample runs at attach time, with no scroll event at all", () => {
    expectFrameClockLive("H-14");
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-14");
    act(() => {
      useTOCStore.getState().setActiveEntry(null);
    });
    expect(activeKey()).toBeNull();

    const spy = makeSpyView(STD_DOC, 14, 29);
    expectFixtureGeometry(spy.fake);
    installView(spy);

    const recorder = recordWrites();
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    recorder.stop();

    expect(activeKey(), "switching into Source mode highlights without a scroll").toBe(
      entries[1].key,
    );
    expect(recorder.observed.length).toBeLessThanOrEqual(1);
    expect(recorder.observed.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  it("H-15: LAW listener conservation over a 30-step lifecycle sequence", () => {
    expectFrameClockLive("H-15");
    const seed = DEFAULT_SEED;
    const where = `H-15 (seed 0x${seed.toString(16)})`;
    const next = createLcg(seed);

    const KINDS = [
      "toggle",
      "toggle",
      "swapA",
      "swapB",
      "swapNull",
      "entries",
      "scroll",
      "scroll",
    ] as const;
    const steps = Array.from({ length: 30 }, () => KINDS[next() % KINDS.length]);
    expect(steps.filter((s) => s === "toggle").length, `${where}: too few toggles`).toBeGreaterThan(
      3,
    );
    expect(
      steps.filter((s) => s === "swapA" || s === "swapB" || s === "swapNull").length,
      `${where}: too few swaps`,
    ).toBeGreaterThan(3);

    let entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, where);
    const viewA = makeSpyView(STD_DOC, 2, 10);
    const viewB = makeSpyView(STD_DOC, 31, 60);
    installView(viewA);

    let props: SpyProps = { entries, documentId: "doc-a", enabled: true };
    const hook = renderSpy(props);
    flushFrame();

    let enabled = true;
    let installed: "A" | "B" | null = "A";
    let sawOne = false;
    let sawZero = false;
    const geometries: Array<[number, number]> = [
      [2, 10],
      [14, 29],
      [31, 60],
    ];

    const rerender = (patch: Partial<SpyProps>) => {
      props = { ...props, ...patch };
      act(() => {
        hook.rerender(props);
      });
    };

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const label = `${where} step ${i} (${step})`;

      if (step === "toggle") {
        enabled = !enabled;
        rerender({ enabled });
      } else if (step === "swapA") {
        installed = "A";
        installView(viewA);
      } else if (step === "swapB") {
        installed = "B";
        installView(viewB);
      } else if (step === "swapNull") {
        installed = null;
        installView(null);
      } else if (step === "entries") {
        entries = installEntries(STD_DOC, "doc-a");
        expectDistinctKeys(entries, label);
        rerender({ entries });
      } else {
        const live = enabled && installed !== null;
        const spy = installed === "A" ? viewA : installed === "B" ? viewB : null;
        const before = activeKey();
        let expected = before;
        if (spy !== null) {
          const [top, bottom] = geometries[i % geometries.length];
          spy.setGeo(top, bottom);
          if (live) expected = composeExpected(spy, entries, before);
          scroll(spy.scrollDOM);
        }
        flushFrame();
        expect(activeKey(), `${label}: state must follow the invariant`).toBe(expected);
      }

      const live = enabled && installed !== null;
      const deltaA = viewA.adds() - viewA.removes();
      const deltaB = viewB.adds() - viewB.removes();
      expect(deltaA + deltaB, `${label}: listener conservation`).toBe(live ? 1 : 0);
      expect(deltaA, `${label}: A holds a listener iff A is installed and enabled`).toBe(
        live && installed === "A" ? 1 : 0,
      );
      expect(deltaB, `${label}: B holds a listener iff B is installed and enabled`).toBe(
        live && installed === "B" ? 1 : 0,
      );
      if (live) sawOne = true;
      else sawZero = true;
    }

    expect(sawOne, `${where}: the sequence must observe a live listener`).toBe(true);
    expect(sawZero, `${where}: the sequence must observe no live listener`).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("H-16: null geometry on a LIVE view preserves the highlight and keeps the listener", () => {
    expectFrameClockLive("H-16");
    const entries = installEntries(STD_DOC, "doc-a");
    expectDistinctKeys(entries, "H-16");
    const spy = makeSpyView(STD_DOC, 14, 29);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();

    // Guard 1 — the attach flush must have MOVED the highlight.
    const before = activeKey();
    expect(before).toBe(entries[1].key);

    // --- row (a): the geometry calls throw (destroyed-view shape) -----------
    {
      spy.fake.setThrowOnProbe("first");
      // Guard 2 — the row genuinely reaches the `null` branch.
      expect(readSpyLineRange(spy.fake.view)).toBeNull();
      const recorder = recordWrites();
      expect(() => {
        scroll(spy.scrollDOM);
        flushFrame();
      }).not.toThrow();
      recorder.stop();
      expect(recorder.observed, "row (a): zero store writes").toEqual([]);
      expect(activeKey()).toBe(before);
      expect(activeKey()).not.toBe(entries[0].key);
      expect(activeKey()).not.toBeNull();
      spy.fake.setThrowOnProbe(undefined);
    }

    // --- row (b): ZERO_RECT, the degenerate route into the same null --------
    {
      spy.fake.setRect(ZERO_RECT);
      // §0.9 carve-out precondition, harder to satisfy accidentally than the 600.
      expect(spy.fake.rect.height).toBe(0);
      expect(readSpyLineRange(spy.fake.view)).toBeNull();
      const recorder = recordWrites();
      expect(() => {
        scroll(spy.scrollDOM);
        flushFrame();
      }).not.toThrow();
      recorder.stop();
      expect(recorder.observed, "row (b): zero store writes").toEqual([]);
      expect(activeKey()).toBe(before);
      expect(activeKey()).not.toBe(entries[0].key);
      expect(activeKey()).not.toBeNull();
    }

    // --- row (c): RECOVERY — the listener was never detached ----------------
    {
      spy.fake.setRect(DEFAULT_FIXTURE_RECT);
      expectFixtureGeometry(spy.fake);
      spy.setGeo(31, 60);
      const expected = composeExpected(spy, entries, before);
      expect(expected).not.toBe(before);
      expect(expected).toBe(entries[2].key);

      const recorder = recordWrites();
      scroll(spy.scrollDOM);
      flushFrame();
      recorder.stop();

      expect(activeKey(), "row (c): the spy recovers on the next healthy frame").toBe(expected);
      expect(recorder.observed).toEqual([expected]);
      expect(
        spy.adds() - spy.removes(),
        "row (c): two null frames must not have detached the listener",
      ).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  it("H-17: an entries / documentId change re-samples without re-attaching", () => {
    expectFrameClockLive("H-17");

    const docA = buildDoc(100, [
      { line: 1, level: 1, text: "Alpha" },
      { line: 12, level: 2, text: "Beta" },
      { line: 30, level: 2, text: "Gamma" },
    ]);
    const entriesA = installEntries(docA, "doc-a");
    expectDistinctKeys(entriesA, "H-17 doc-a");
    expectHeadingLines(entriesA, STD_LINES);

    const spy = makeSpyView(docA, 14, 29);
    expectFixtureGeometry(spy.fake);
    installView(spy);
    const hook = renderSpy({ entries: entriesA, documentId: "doc-a", enabled: true });
    flushFrame();

    const keyA = activeKey();
    expect(keyA).toBe(entriesA[1].key);
    const addsAfterAttach = spy.adds();
    const logsAfterAttach = logCount();
    expect(addsAfterAttach).toBe(1);

    // --- row (a): document switch ------------------------------------------
    const docB = buildDoc(100, [
      { line: 1, level: 1, text: "Delta" },
      { line: 12, level: 2, text: "Epsilon" },
      { line: 30, level: 2, text: "Zeta" },
    ]);
    const entriesB = installEntries(docB, "doc-b");
    expectDistinctKeys(entriesB, "H-17 doc-b");
    expectHeadingLines(entriesB, STD_LINES);
    // Load-bearing guard: the store really did null the active key, so the case proves
    // the hook RESTORED it rather than that it was never cleared.
    expect(activeKey(), "tocStore.ts:199-200 nulls the carried key on a switch").toBeNull();

    const expectedB = composeExpected(spy, entriesB, null);
    expect(expectedB).toBe(entriesB[1].key);
    act(() => {
      hook.rerender({ entries: entriesB, documentId: "doc-b", enabled: true });
    });
    flushFrame();

    expect(activeKey(), "row (a): no scroll, and the outline is not blank").not.toBeNull();
    expect(activeKey()).toBe(expectedB);
    expect(spy.adds(), "row (a): re-sampling must not become re-attaching").toBe(addsAfterAttach);
    expect(logCount(), "row (a): re-sampling must not log").toBe(logsAfterAttach);

    // --- row (b): same-document re-parse that RETIRES the active key --------
    // D-8's recipe: change the active heading's LEVEL, since the coordination contract
    // preserves keys across renames.
    const docB2 = buildDoc(100, [
      { line: 1, level: 1, text: "Delta" },
      { line: 12, level: 4, text: "Epsilon" },
      { line: 30, level: 2, text: "Zeta" },
    ]);
    const entriesB2 = installEntries(docB2, "doc-b");
    expectDistinctKeys(entriesB2, "H-17 doc-b rev2");
    expectHeadingLines(entriesB2, STD_LINES);
    expect(entriesB2[1].key, "the active heading's key must genuinely be retired").not.toBe(
      entriesB[1].key,
    );
    expect(activeKey(), "the same-document re-parse nulls the active key too").toBeNull();

    const expectedB2 = composeExpected(spy, entriesB2, null);
    expect(expectedB2).toBe(entriesB2[1].key);
    act(() => {
      hook.rerender({ entries: entriesB2, documentId: "doc-b", enabled: true });
    });
    flushFrame();

    expect(activeKey(), "row (b): editing a heading must not blank the outline").not.toBeNull();
    expect(activeKey()).toBe(expectedB2);
    expect(spy.adds(), "row (b): still exactly one attach").toBe(addsAfterAttach);
    expect(logCount(), "row (b): still no extra log event").toBe(logsAfterAttach);
  });

  // -------------------------------------------------------------------------
  it("H-18: REGRESSION — scrolling upward moves the highlight while the previous heading is still on screen", () => {
    expectFrameClockLive("H-18");

    // The measured 2026-09-20 field reproduction: 111 lines, headings at these lines.
    // Declared inside the case rather than at module scope so no recorded line moves.
    const FIELD_LINES = [1, 8, 22, 34, 46, 60, 74, 86, 99];
    const doc = buildDoc(
      111,
      FIELD_LINES.map((line, i) => ({
        line,
        level: (i === 0 ? 1 : 2) as 1 | 2,
        text: `Section ${i}`,
      })),
    );
    const entries = installEntries(doc, "doc-a");
    expectDistinctKeys(entries, "H-18");
    expectHeadingLines(entries, FIELD_LINES);

    // `MID_SCROLL` by default, and that is the whole point: 1200px of scrolling remain,
    // so `atScrollLimit` is false on every sample below and the clamp must not engage.
    const spy = makeSpyView(doc, 43, 68);
    expectFixtureGeometry(spy.fake);
    expect(spy.fake.scroll, "H-18 is a mid-document case, not a tail-clamp one").toEqual(
      MID_SCROLL,
    );
    installView(spy);

    const recorder = recordWrites();
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();

    // Upward, one heading gap at a time. `setGeo` moves the pixel→line mapping only; the
    // scroll metrics are never touched, so nothing but the reader's position changes.
    spy.setGeo(32, 57);
    scroll(spy.scrollDOM);
    flushFrame();

    spy.setGeo(19, 44);
    scroll(spy.scrollDOM);
    flushFrame();
    recorder.stop();

    // The retention precondition was genuinely live on both upward steps — the
    // previously-active heading is still inside the visible range each time. That is
    // exactly the shape the unconditional clamp froze on, so the red is semantic.
    expect(entries[3].lineNumber, "heading@34 still visible at (32, 57)").toBeGreaterThanOrEqual(32);
    expect(entries[3].lineNumber).toBeLessThanOrEqual(57);
    expect(entries[2].lineNumber, "heading@22 still visible at (19, 44)").toBeGreaterThanOrEqual(19);
    expect(entries[2].lineNumber).toBeLessThanOrEqual(44);

    // The SEQUENCE, not the final value: the attach write plus the two upward moves. A
    // final-value assertion alone is satisfied by an implementation that jumps straight
    // from heading@34 to heading@8.
    expect(recorder.observed, "the highlight must move on each upward step").toEqual([
      entries[3].key,
      entries[2].key,
      entries[1].key,
    ]);
    expect(recorder.entriesStable(), "no re-parse can explain the moves").toBe(true);
  });

  // -------------------------------------------------------------------------
  it("H-19: the hook obeys the seam's boolean and does not recompute one", () => {
    expectFrameClockLive("H-19");

    const doc = buildDoc(100, [
      { line: 1, level: 1, text: "Alpha" },
      { line: 40, level: 2, text: "Beta" },
      { line: 90, level: 2, text: "Gamma" },
    ]);
    const entries = installEntries(doc, "doc-a");
    expectDistinctKeys(entries, "H-19");
    expectHeadingLines(entries, [1, 40, 90]);

    // ONE tuple feeds both mounts, so "the line geometry is identical" is executable
    // rather than a comment a later edit can falsify.
    const GEO: readonly [number, number] = [78, 100];
    // The raw pick genuinely disagrees with the preset highlight, so neither mount can
    // exit through the `picked === currentKey` short-circuit.
    expect(pickActiveKeyByLine(entries, GEO[0])).toBe(entries[1].key);
    expect(entries[2].lineNumber).toBeGreaterThanOrEqual(GEO[0]);
    expect(entries[2].lineNumber).toBeLessThanOrEqual(GEO[1]);
    // The two shapes differ in `scrollTop` alone.
    expect(AT_LIMIT_SCROLL.scrollHeight).toBe(MID_SCROLL.scrollHeight);
    expect(AT_LIMIT_SCROLL.clientHeight).toBe(MID_SCROLL.clientHeight);
    expect(AT_LIMIT_SCROLL.scrollTop).not.toBe(MID_SCROLL.scrollTop);

    // --- mount A: at the scroll limit → the narrowed clamp still holds ------
    const spyA = makeSpyView(doc, GEO[0], GEO[1], AT_LIMIT_SCROLL);
    expectFixtureGeometry(spyA.fake);
    installView(spyA);
    act(() => {
      useTOCStore.getState().setActiveEntry(entries[2].key);
    });
    const recorderA = recordWrites();
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    recorderA.stop();

    expect(activeKey(), "A: at the limit the clicked tail heading is retained").toBe(
      entries[2].key,
    );
    expect(recorderA.observed, "A: no store write").toEqual([]);

    cleanup();
    installView(null);

    // --- mount B: identical line geometry, mid-scroll → the picker wins -----
    const spyB = makeSpyView(doc, GEO[0], GEO[1], MID_SCROLL);
    expectFixtureGeometry(spyB.fake);
    // Same reported rect on both fixtures, so nothing but the scroll metrics differs.
    expect(spyB.fake.scrollDOM.getBoundingClientRect().bottom).toBe(
      spyA.fake.scrollDOM.getBoundingClientRect().bottom,
    );
    installView(spyB);
    act(() => {
      useTOCStore.getState().setActiveEntry(entries[2].key);
    });
    const recorderB = recordWrites();
    renderSpy({ entries, documentId: "doc-a", enabled: true });
    flushFrame();
    recorderB.stop();

    expect(activeKey(), "B: off the limit the highlight follows the anchor").toBe(
      entries[1].key,
    );
    expect(recorderB.observed, "B: exactly one store write").toEqual([entries[1].key]);
    expect(recorderB.entriesStable()).toBe(true);
  });
});
