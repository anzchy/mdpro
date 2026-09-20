/**
 * Purpose: the shared **Shape A** structural `EditorView` double for the geometry seam
 * (`src/utils/codemirrorViewportLine.ts`). Specified by
 * `.claude/tdd-guardian/tests-20260919-151931.md` §0.7 / §0.8 / §0.9.
 *
 * ---------------------------------------------------------------------------
 * Why a double at all — and why it is a *boundary* double, not a logic double
 * ---------------------------------------------------------------------------
 * **jsdom implements no layout.** A real `EditorView` in this environment reports every
 * height as 0, has no `getClientRects`, and answers line 1 for every height query.
 * CodeMirror geometry is therefore a *platform* boundary here in exactly the way the
 * filesystem or the network is, and doubling it is the anti-pattern rule's exception
 * rather than a violation of it: the logic under test (anchor arithmetic, `lineAt`
 * mapping, the clamp, the inversion rule) is **not** mocked — only the pixels are.
 *
 * What stays real, deliberately:
 *   - `state` is a real `EditorState.create({ doc })`. Every expected line number in the
 *     cases is computed from it (`doc.line(n)`, `doc.lineAt(pos).number`, `doc.lines`),
 *     never written as a literal, so a `lineAt` off-by-one in the implementation cannot
 *     be matched by an equally wrong literal in the test.
 *   - `scrollDOM` is a real jsdom `<div>`, so `isConnected`, `addEventListener` and
 *     `dispatchEvent` are the real platform methods.
 *
 * `posAtCoords(coords, false)` returns a `number` and **never `null`** — the imprecise
 * overload in `@codemirror/view` 6.39.11 is total, which is why the implementation chose
 * it. The double preserves that totality; a double that could answer `null` would be
 * modelling an API that does not exist.
 *
 * `blockAtHeight` and `visualLineAtHeight` **do not exist** in 6.39.11 (pre-6.0 names)
 * and appear nowhere here. Neither does `lineBlockAtHeight`: its argument is *document*
 * space while `documentTop` is *screen* space and `scrollDOM.scrollTop` is *scroller*
 * space, and a double with no layout cannot honestly model a three-space bridge.
 *
 * ---------------------------------------------------------------------------
 * The rect *and the scroll metrics* are parameters, and that is load-bearing (§0.8)
 * ---------------------------------------------------------------------------
 * jsdom returns an all-zero `DOMRect` for every element. Hardcoding a healthy 600px rect
 * would make every *healthy-geometry* case pass for the wrong reason the day the override
 * is dropped; hardcoding nothing would make the degenerate cases untestable. Three named
 * rects ship instead, and `expectFixtureGeometry` is the precondition that catches a lost
 * override.
 *
 * **`scrollTop` / `scrollHeight` / `clientHeight` get exactly the same treatment, for a
 * sharper version of the same reason.** jsdom implements no layout, so it answers `0` for
 * `scrollHeight` and `clientHeight` on *every* element — V-14 clause (i) pins that — and
 * both are getter-only accessors on the prototype, so a plain assignment cannot install a
 * value at all. `scrollTop` is a stored value in jsdom rather than a layout-derived one,
 * which makes it the more dangerous of the three: an assignment appears to work while
 * describing nothing. **All three are therefore installed with `Object.defineProperty` on
 * the real `<div>`** (`scrollTop` keeps a setter, because in a browser it is writable).
 * Without that, every case would silently exercise the unlaid-out `0/0/0` shape, the
 * scroll-limit predicate would read "at the limit" everywhere, and the whole suite would
 * go green for the wrong reason. Five named shapes ship — {@link MID_SCROLL} (the
 * default), {@link AT_LIMIT_SCROLL}, {@link SHORT_DOC_SCROLL}, {@link UNLAID_OUT_SCROLL},
 * {@link COLLAPSED_SCROLL} — and {@link expectScrollOverrideLive} is the precondition that
 * catches a lost override.
 *
 * **Unmet integration obligation**: that the line this double reports is the line a *user*
 * sees at the anchor is browser geometry, asserted nowhere automated in this repo.
 * Discharged by WI-7 QA-1 / QA-4 manual QA.
 */
import { expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** The numeric subset of `DOMRect` the seam reads. */
export interface FixtureRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/** The healthy scroller. Every case except V-12, V-13 and H-16(b) uses this. */
export const DEFAULT_FIXTURE_RECT: FixtureRect = {
  top: 0,
  left: 0,
  bottom: 600,
  right: 800,
  width: 800,
  height: 600,
  x: 0,
  y: 0,
};

/**
 * Exactly what jsdom really returns for a detached or unlaid-out element, and the
 * production shape of `scrollDOM` on the frame a mode toggle or a remount attaches on.
 */
export const ZERO_RECT: FixtureRect = {
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
};

/** A scroller shorter than `SPY_ANCHOR_OFFSET_PX`: the top probe lands below the bottom. */
export const SHORT_RECT: FixtureRect = {
  top: 0,
  left: 0,
  bottom: 30,
  right: 800,
  width: 800,
  height: 30,
  x: 0,
  y: 0,
};

/** The numeric subset of the scroller's scroll metrics the seam reads. */
export interface FixtureScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * **The default.** A healthy scroller a long way from either end: 1200px of scrolling
 * remains. Deliberately neither {@link AT_LIMIT_SCROLL} — which would re-enable the tail
 * clamp across every existing case and hide the defect — nor {@link UNLAID_OUT_SCROLL},
 * which would flip them all into the degenerate branch. `clientHeight` matches
 * `DEFAULT_FIXTURE_RECT.height`: a fixture whose rect says 600px tall while
 * `clientHeight` says something else is incoherent geometry.
 */
export const MID_SCROLL: FixtureScrollMetrics = {
  scrollTop: 1200,
  scrollHeight: 3000,
  clientHeight: 600,
};

/** Scrolled to the bottom (remaining 0) — the tail clamp's precondition. */
export const AT_LIMIT_SCROLL: FixtureScrollMetrics = {
  scrollTop: 2400,
  scrollHeight: 3000,
  clientHeight: 600,
};

/**
 * A laid-out document that fits its viewport: `scrollHeight === clientHeight > 0`, never
 * scrolled. Its maximum scroll offset is 0, exactly as {@link UNLAID_OUT_SCROLL}'s is —
 * the pair is what forces the `clientHeight > 0` distinction to exist.
 */
export const SHORT_DOC_SCROLL: FixtureScrollMetrics = {
  scrollTop: 0,
  scrollHeight: 600,
  clientHeight: 600,
};

/**
 * jsdom's own shape, and the production shape of `scrollDOM` on the frame a mode toggle
 * or a remount attaches on. The only shape **indistinguishable from an absent override**,
 * which is why it is the only one exempt from {@link expectScrollOverrideLive}.
 */
export const UNLAID_OUT_SCROLL: FixtureScrollMetrics = {
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
};

/**
 * A collapsed viewport over real content: `clientHeight` 0 while `scrollHeight` is 600.
 * The zero is **deliberate**, and jsdom cannot produce this pair on its own — so unlike
 * {@link UNLAID_OUT_SCROLL} its liveness *is* checkable, and must be checked. Its role is
 * to isolate `clientHeight` against {@link SHORT_DOC_SCROLL}, with which it shares
 * `scrollTop` and `scrollHeight`.
 */
export const COLLAPSED_SCROLL: FixtureScrollMetrics = {
  scrollTop: 0,
  scrollHeight: 600,
  clientHeight: 0,
};

/** One recorded `posAtCoords` call. `returnedPos` is what the double handed back. */
export interface ProbeRecord {
  x: number;
  y: number;
  precise: boolean;
  returnedPos: number;
}

export interface FakeViewOptions {
  /** Document text for the **real** `EditorState` behind the double. */
  doc: string;
  /** Per-case pixel→line mapping. The returned line is clamped into `[1, doc.lines]`. */
  lineAtY: (y: number) => number;
  /** Defaults to the healthy scroller. */
  rect?: FixtureRect;
  /** Per-case scroll metrics. Defaults to {@link MID_SCROLL}. */
  scroll?: FixtureScrollMetrics;
  /** Destroyed-view simulation: which `posAtCoords` call throws. */
  throwOnProbe?: "first" | "second";
  /** Append `scrollDOM` to `document.body`. `false` gives the detached shape. */
  attach?: boolean;
}

export interface FakeViewFixture {
  /** The double, typed as the real thing at the single documented cast. */
  view: EditorView;
  /** The real `EditorState` — the source of every computed expectation. */
  state: EditorState;
  scrollDOM: HTMLDivElement;
  /** The rect currently reported by `getBoundingClientRect`. Live, not a snapshot. */
  rect: FixtureRect;
  /** The scroll metrics currently reported by `scrollDOM`. Live, not a snapshot. */
  scroll: FixtureScrollMetrics;
  probeLog: ProbeRecord[];
  /**
   * Swap the reported rect **on a live view** (§5 H-16(b)). Constructor-only rects
   * cannot express "a healthy scroller becomes zero-height for one frame and then
   * recovers", which is the production shape of every mode toggle — the geometry has
   * to change while the same `EditorView` instance stays installed in the store.
   */
  setRect: (next: FixtureRect) => void;
  /**
   * Swap the reported scroll metrics **on a live view**, for the same reason as
   * {@link setRect}: "the user scrolls up off the bottom" is a transition that arrives
   * mid-session, on the `EditorView` instance already installed in the store, and a
   * constructor-only parameter cannot express it.
   */
  setScrollMetrics: (next: FixtureScrollMetrics) => void;
  /**
   * Start or stop throwing from `posAtCoords` **on a live view** (§5 H-16(a)), for the
   * same reason as {@link setRect}: the destroyed-geometry frame arrives mid-session,
   * not at construction.
   */
  setThrowOnProbe: (next: "first" | "second" | undefined) => void;
  destroy: () => void;
}

function clampLine(line: number, lineCount: number): number {
  if (!Number.isFinite(line)) return 1;
  return Math.min(Math.max(Math.trunc(line), 1), lineCount);
}

export function createFakeView(options: FakeViewOptions): FakeViewFixture {
  const {
    doc,
    lineAtY,
    rect = DEFAULT_FIXTURE_RECT,
    scroll = MID_SCROLL,
    throwOnProbe,
    attach = true,
  } = options;

  const state = EditorState.create({ doc });
  const scrollDOM = document.createElement("div");
  if (attach) document.body.appendChild(scrollDOM);

  // Mutable so `setRect` / `setThrowOnProbe` can change the geometry of a view that is
  // already installed in `useEditorStore`. Every read below goes through these, never
  // through the constructor arguments, so the two stay in step by construction.
  let currentRect = rect;
  let currentScroll = scroll;
  let currentThrow = throwOnProbe;

  scrollDOM.getBoundingClientRect = () =>
    ({ ...currentRect, toJSON: () => ({ ...currentRect }) }) as DOMRect;

  // `Object.defineProperty`, not assignment. `scrollHeight` and `clientHeight` are
  // getter-only accessors on the prototype, so `scrollDOM.scrollHeight = 3000` installs
  // nothing; `scrollTop` would accept the assignment and then describe nothing, because
  // jsdom stores it rather than deriving it from a layout that does not exist. All three
  // are own accessors over the same mutable cell, so `setScrollMetrics` and every read
  // stay in step by construction. `scrollTop` keeps a setter because in a real browser it
  // is writable — a production path that scrolls the element must not throw here.
  Object.defineProperty(scrollDOM, "scrollTop", {
    configurable: true,
    get: () => currentScroll.scrollTop,
    set: (next: number) => {
      currentScroll = { ...currentScroll, scrollTop: next };
    },
  });
  Object.defineProperty(scrollDOM, "scrollHeight", {
    configurable: true,
    get: () => currentScroll.scrollHeight,
  });
  Object.defineProperty(scrollDOM, "clientHeight", {
    configurable: true,
    get: () => currentScroll.clientHeight,
  });

  const probeLog: ProbeRecord[] = [];

  const view = {
    get state() {
      return state;
    },
    scrollDOM,
    posAtCoords(coords: { x: number; y: number }, precise?: boolean): number {
      // Which probe this is, identified by the coordinate rather than by a call
      // counter. A counter would make `throwOnProbe` mean "throw on the Nth call of the
      // fixture's whole life", so a case that invokes the function twice (once inside
      // `not.toThrow()`, once for the value) would silently stop throwing on the second
      // invocation. A destroyed view throws *every* time, and so does this.
      const isBottomProbe = coords.y === currentRect.bottom - 1;
      if (currentThrow === (isBottomProbe ? "second" : "first")) {
        throw new Error("destroyed view: no geometry available");
      }
      const returnedPos = state.doc.line(clampLine(lineAtY(coords.y), state.doc.lines)).from;
      probeLog.push({ x: coords.x, y: coords.y, precise: precise === true, returnedPos });
      return returnedPos;
    },
  } as unknown as EditorView;

  return {
    view,
    state,
    scrollDOM,
    // A getter, not a snapshot: `setRect` must be observable through `fixture.rect`, or
    // a case could assert its precondition against a rect the double no longer reports.
    get rect() {
      return currentRect;
    },
    // A getter for the same reason, and against the same mistake: a snapshot taken here
    // would let a case assert its precondition against metrics the element no longer
    // reports.
    get scroll() {
      return currentScroll;
    },
    probeLog,
    setRect: (next: FixtureRect) => {
      currentRect = next;
    },
    setScrollMetrics: (next: FixtureScrollMetrics) => {
      currentScroll = next;
    },
    setThrowOnProbe: (next: "first" | "second" | undefined) => {
      currentThrow = next;
    },
    destroy: () => {
      scrollDOM.remove();
    },
  };
}

/**
 * §0.9 — the scroll-metric half of the wrong-reason precondition, on its own.
 *
 * Deep-matches what the **real `<div>`** reports against `fixture.scroll`. Reading the
 * element is the whole point: comparing `fixture.scroll` with itself, or with three
 * literals copied from a constant, is a tautology that catches nothing. There is
 * deliberately **no `clientHeight > 0` requirement** here — see the carve-out rule below.
 *
 * **The carve-out keys on "indistinguishable from jsdom's own `0/0/0` default", not on
 * `clientHeight === 0`.** `COLLAPSED_SCROLL` has `clientHeight === 0` but
 * `scrollHeight === 600`, a pair jsdom cannot produce by itself, so its liveness *is*
 * checkable and must be checked — a dead `Object.defineProperty` install would otherwise
 * leave a `false`-expecting case permanently green. Only {@link UNLAID_OUT_SCROLL} is
 * genuinely exempt, and it is exempt from both helpers.
 */
export function expectScrollOverrideLive(fixture: FakeViewFixture): void {
  const { scrollTop, scrollHeight, clientHeight } = fixture.scrollDOM;
  expect(
    { scrollTop, scrollHeight, clientHeight },
    "§0.9: the scroll-metric override must be live on the real <div>",
  ).toEqual(fixture.scroll);
}

/**
 * §0.9 — the mandatory wrong-reason precondition for every *healthy-geometry* case. If
 * the `getBoundingClientRect` override is ever lost, or jsdom changes, the case fails
 * here instead of silently testing zero-height geometry. It now covers **both** kinds of
 * browser geometry the seam reads: the rect, and — via
 * {@link expectScrollOverrideLive} — the scroll metrics. The `clientHeight` conjunct is
 * the coherence check: a fixture whose rect says 600px tall while `clientHeight` says
 * 200 is geometry a later reader would reason from wrongly.
 *
 * Who calls what:
 *   - **this helper** — every case on `MID_SCROLL`, `AT_LIMIT_SCROLL`, `SHORT_DOC_SCROLL`
 *     (a laid-out rect and `clientHeight > 0`);
 *   - **`expectScrollOverrideLive` only** — `COLLAPSED_SCROLL`, whose `clientHeight` of 0
 *     cannot satisfy the rect-coherence conjunct;
 *   - **neither** — the degenerate cases (V-12, V-13, V-18 and V-21's degenerate rows),
 *     which carry their own, harder preconditions instead.
 *
 * **(c) V-17's single `it()` calls a *different* helper for each of its two rows, and
 * that asymmetry is deliberate, not an oversight.** Row (a) (`SHORT_DOC_SCROLL`) calls
 * `expectFixtureGeometry`; row (b) (`COLLAPSED_SCROLL`) calls `expectScrollOverrideLive`.
 * Normalising the two — calling `expectFixtureGeometry` on row (b) to make the test body
 * look consistent — reds row (b) on the `clientHeight` conjunct, for no defect.
 */
export function expectFixtureGeometry(fixture: FakeViewFixture): void {
  expect(
    fixture.scrollDOM.getBoundingClientRect().bottom,
    "§0.9: the healthy-scroller rect override must be live",
  ).toBe(600);
  expect(
    fixture.scrollDOM.clientHeight,
    "§0.9: clientHeight must agree with the rect this same double reports",
  ).toBe(DEFAULT_FIXTURE_RECT.height);
  expectScrollOverrideLive(fixture);
}
