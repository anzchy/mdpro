/**
 * Purpose: WI-2 — `src/utils/codemirrorViewportLine.ts`, the **sole geometry seam** for
 * the source-mode scroll spy. Matrix §3 of
 * `.claude/tdd-guardian/tests-20260919-151931.md`, cases **V-1 … V-13** (V-8b lives in
 * its own file — see below). §0 is binding throughout.
 *
 * ---------------------------------------------------------------------------
 * The three laws, and which one is not verifiable here
 * ---------------------------------------------------------------------------
 *   1. **Range containment, with `null` as a first-class answer** (V-6, S5) — the result
 *      is `null`, or integers with `1 <= topLine <= bottomLine <= doc.lines`. `null` is
 *      the contract for *every* degenerate geometry, and there is exactly **one** rule in
 *      the implementation (`if (topLine > bottomLine) return null`) that V-10, V-12 and
 *      V-13 all land on from three different directions.
 *   2. **Clamp monotonicity** (V-7, S4) — as the probed position increases, `topLine`
 *      never decreases.
 *   3. **Not verifiable in this repo, recorded rather than faked** — that the returned
 *      line is the line a *user* sees at the anchor. That is browser geometry; jsdom has
 *      no layout. Obligation UNMET, discharged by WI-7 QA-1.
 *
 * ---------------------------------------------------------------------------
 * Why V-8b is not in this file
 * ---------------------------------------------------------------------------
 * V-8 asserts the navigate path's `yMargin` **equals the real** `SPY_ANCHOR_OFFSET_PX`;
 * V-8b asserts it *tracks* the constant by mocking the module to `137`. `vi.mock` is
 * file-scoped, so one file cannot hold both without poisoning V-8. V-8b is therefore in
 * `tests/codemirror-viewport-line-constant-import.test.ts`, as §3 V-8b requires.
 *
 * ---------------------------------------------------------------------------
 * Mock boundary and the obligation it creates
 * ---------------------------------------------------------------------------
 * Every V-1…V-13 case except V-8 uses the Shape A double from
 * `tests/helpers/fakeCodemirrorView.ts` (§0.7/§0.8). CodeMirror geometry is a platform
 * boundary in jsdom, not a collaborator being stubbed out of the way. **There is no
 * integration lane in this repo**, so the obligation is recorded UNMET against WI-7 QA-1
 * (the anchor lands where the reader is) and QA-4 (mode toggles and remounts do not jump
 * the highlight to the last heading). V-8 uses a **real** headless `EditorView`
 * (Shape B) because what it asserts is what a real dispatch carries.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { StateEffect, StateEffectType, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  readSpyLineRange,
  SPY_ANCHOR_OFFSET_PX,
  SPY_SCROLL_LIMIT_TOLERANCE_PX,
} from "../src/utils/codemirrorViewportLine";
import {
  AT_LIMIT_SCROLL,
  COLLAPSED_SCROLL,
  createFakeView,
  expectFixtureGeometry,
  expectScrollOverrideLive,
  DEFAULT_FIXTURE_RECT,
  MID_SCROLL,
  SHORT_DOC_SCROLL,
  SHORT_RECT,
  UNLAID_OUT_SCROLL,
  ZERO_RECT,
} from "./helpers/fakeCodemirrorView";
import type { FakeViewFixture, FixtureScrollMetrics } from "./helpers/fakeCodemirrorView";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import { captureScrollReceivers } from "./helpers/scrollReceiver";
import type { ScrollReceiver } from "./helpers/scrollReceiver";
import { useTOC } from "../src/hooks/useTOC";
import { useTOCStore } from "../src/stores/tocStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { HeadingKey, TOCEntry } from "../src/types/toc";

// ---------------------------------------------------------------------------
// Fixtures shared by the geometry cases
// ---------------------------------------------------------------------------

/** A 12-line document. Line count is asserted, never assumed, wherever it matters. */
const TWELVE_LINE_DOC = [
  "# One",
  "",
  "body one",
  "",
  "## Two",
  "",
  "body two",
  "",
  "### Three",
  "",
  "body three",
  "# Four",
].join("\n");

/**
 * The y threshold that separates the two probes for the *healthy* rect. The top probe
 * fires at `rect.top + SPY_ANCHOR_OFFSET_PX` (40) and the bottom at `rect.bottom - 1`
 * (599); anything in between separates them. V-4 is what pins the arithmetic itself —
 * this constant only routes the double.
 */
const PROBE_SPLIT_Y = 300;

let fixtures: FakeViewFixture[] = [];

function makeView(options: Parameters<typeof createFakeView>[0]): FakeViewFixture {
  const fixture = createFakeView(options);
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures) fixture.destroy();
  fixtures = [];
});

// ---------------------------------------------------------------------------
// §3 — readSpyLineRange
// ---------------------------------------------------------------------------

describe("§3 readSpyLineRange — guards and failure handling", () => {
  it("V-1: an absent, undefined, or detached view returns null without throwing", () => {
    // (i) the literal null the call site produces before the editor mounts.
    expect(() => readSpyLineRange(null)).not.toThrow();
    expect(readSpyLineRange(null)).toBeNull();

    // (ii) `undefined` — asserted separately from (i) because `toBeFalsy` would not
    // distinguish them, and the guard must be `!view`, not `view === null`.
    expect(() => readSpyLineRange(undefined as unknown as EditorView)).not.toThrow();
    expect(readSpyLineRange(undefined as unknown as EditorView)).toBeNull();

    // (iii) the detached scroller: what `useEditorStore.editorView` holds for the frame
    // between a mode toggle and layout. Returnable as `null` only because degenerate
    // geometry answers `null` rather than max-clamping to `{doc.lines, doc.lines}`.
    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      rect: ZERO_RECT,
      attach: false,
      lineAtY: (y) => (y < 0 ? 1 : 12),
    });
    expect(
      fixture.scrollDOM.isConnected,
      "V-1(iii) must be the detached shape, not a second copy of row (i)",
    ).toBe(false);
    expect(() => readSpyLineRange(fixture.view)).not.toThrow();
    expect(readSpyLineRange(fixture.view)).toBeNull();
  });

  it("V-2: a throwing posAtCoords (destroyed view) returns null from either probe", () => {
    for (const throwOnProbe of ["first", "second"] as const) {
      const fixture = makeView({
        doc: TWELVE_LINE_DOC,
        throwOnProbe,
        lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 2 : 9),
      });
      expectFixtureGeometry(fixture);
      expect(
        () => readSpyLineRange(fixture.view),
        `V-2 (${throwOnProbe}): the throw must not escape`,
      ).not.toThrow();
      expect(readSpyLineRange(fixture.view), `V-2 (${throwOnProbe})`).toBeNull();
    }
  });
});

describe("§3 readSpyLineRange — the probed line", () => {
  it("V-3/V-4: returns the line containing each probed position, probed at the documented coordinates", () => {
    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      lineAtY: (y) => (y <= 100 ? 4 : 11),
    });
    expectFixtureGeometry(fixture);
    expect(fixture.state.doc.lines, "V-3 fixture must really be 12 lines").toBe(12);

    const result = readSpyLineRange(fixture.view);

    // Level 1 — the readability anchor. The third field is WI-2 shape churn, declared in
    // advance: `SpyLineRange` gained `atScrollLimit`, and a `toEqual` on the whole object
    // is a shape assertion by construction. No line number moved, and `false` is what the
    // fixture's default `MID_SCROLL` means.
    expect(result).toEqual({ topLine: 4, bottomLine: 11, atScrollLimit: false });

    // Level 2 — computed by the real `Text` API from the position the double actually
    // returned, so a `lineAt` off-by-one cannot be matched by a wrong literal above.
    expect(fixture.probeLog, "V-3: exactly two probes").toHaveLength(2);
    expect(result?.topLine).toBe(
      fixture.state.doc.lineAt(fixture.probeLog[0].returnedPos).number,
    );
    expect(result?.bottomLine).toBe(
      fixture.state.doc.lineAt(fixture.probeLog[1].returnedPos).number,
    );

    // V-4 — Level 6 structural supplement, deliberately inside the same `it()` as the
    // Level 1/2 assertions above and never standalone. `precise: false` is asserted
    // because the whole "never null" argument rests on the imprecise overload.
    expect(fixture.probeLog[0]).toEqual({
      x: DEFAULT_FIXTURE_RECT.left + 1,
      y: DEFAULT_FIXTURE_RECT.top + SPY_ANCHOR_OFFSET_PX,
      precise: false,
      returnedPos: fixture.probeLog[0].returnedPos,
    });
    expect(fixture.probeLog[1].y).toBe(DEFAULT_FIXTURE_RECT.bottom - 1);
    expect(fixture.probeLog[1].x).toBe(DEFAULT_FIXTURE_RECT.left + 1);
    expect(fixture.probeLog[1].precise).toBe(false);
  });

  it("V-5: bottomLine derives from rect.bottom and topLine <= bottomLine across a geometry table", () => {
    const flat = (): number => 1;
    const spread = (lines: number) => (y: number) => (y <= PROBE_SPLIT_Y ? 1 : lines);

    const table = [
      { label: "1 line / flat", doc: "# Only", lineAtY: flat },
      { label: "2 lines / flat", doc: "# One\n# Two", lineAtY: flat },
      { label: "2 lines / spread", doc: "# One\n# Two", lineAtY: spread(2) },
      { label: "12 lines / flat", doc: TWELVE_LINE_DOC, lineAtY: flat },
      { label: "12 lines / spread", doc: TWELVE_LINE_DOC, lineAtY: spread(12) },
      {
        label: "400 lines / spread",
        doc: Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join("\n"),
        lineAtY: spread(400),
      },
    ];

    const rows: { topLine: number; bottomLine: number }[] = [];
    for (const row of table) {
      const fixture = makeView({ doc: row.doc, lineAtY: row.lineAtY });
      expectFixtureGeometry(fixture);
      const result = readSpyLineRange(fixture.view);
      expect(result, `V-5 ${row.label}: must not be null on healthy geometry`).not.toBeNull();
      if (result === null) continue;

      expect(fixture.probeLog, `V-5 ${row.label}: two probes`).toHaveLength(2);
      expect(result.bottomLine, `V-5 ${row.label}: bottomLine from rect.bottom`).toBe(
        fixture.state.doc.lineAt(fixture.probeLog[1].returnedPos).number,
      );
      expect(result.topLine, `V-5 ${row.label}: ordering`).toBeLessThanOrEqual(
        result.bottomLine,
      );
      rows.push(result);
    }

    expect(rows, "V-5: every row must have produced a range").toHaveLength(table.length);
    // Wrong-reason guard: `topLine <= bottomLine` is satisfied for free by an
    // implementation that copies topLine into bottomLine.
    expect(
      rows.some((r) => r.topLine < r.bottomLine),
      "V-5: at least one row must be strictly ordered",
    ).toBe(true);
  });

  it("V-11: a one-line document (empty, and single heading) returns {1, 1}", () => {
    for (const doc of ["", "# Only"]) {
      const fixture = makeView({ doc, lineAtY: () => 1 });
      expectFixtureGeometry(fixture);
      // Wrong-reason guard: the case must not be silently testing a 2-line document.
      expect(fixture.state.doc.lines, `V-11 (${JSON.stringify(doc)})`).toBe(1);
      // WI-2 shape churn, declared in advance — see the note on V-3's `toEqual`.
      expect(readSpyLineRange(fixture.view), `V-11 (${JSON.stringify(doc)})`).toEqual({
        topLine: 1,
        bottomLine: 1,
        atScrollLimit: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The law cases. V-6's domain is shared with V-7 and V-9.
// ---------------------------------------------------------------------------

/** A row of the anchor domain: a target *position* and the double that reaches it. */
interface AnchorRow {
  label: string;
  /** The position the top probe aims at. May be outside `[0, doc.length]`. */
  position: number;
  lineAtY: (y: number) => number;
}

/**
 * Build the 24-row anchor domain from a table of target positions. The double clamps the
 * *line* it is handed into `[1, doc.lines]`, so an out-of-document position is expressed
 * as an out-of-range line and the clamp is what the row exercises. The bottom probe is
 * pinned to the last line in every row, so the top probe is the only variable and no row
 * is rejected by the inversion rule for an incidental reason.
 */
function buildAnchorDomain(doc: EditorState["doc"]): AnchorRow[] {
  const next = createLcg(DEFAULT_SEED);
  const positions: { label: string; position: number }[] = [
    { label: "far before doc start", position: -1000 },
    { label: "one before doc start", position: -1 },
    { label: "doc start", position: 0 },
    { label: "doc end", position: doc.length },
    { label: "one past doc end", position: doc.length + 1 },
    { label: "far past doc end", position: doc.length + 10_000 },
  ];
  for (let n = 1; n <= doc.lines; n++) {
    positions.push({ label: `line ${n} from`, position: doc.line(n).from });
  }
  for (let i = 0; i < 6; i++) {
    positions.push({
      label: `lcg[${i}] (seed ${DEFAULT_SEED})`,
      position: next() % (doc.length + 1),
    });
  }

  return positions.map(({ label, position }) => {
    const lineForPosition =
      position < 0
        ? Math.min(0, Math.ceil(position))
        : position > doc.length
          ? doc.lines + (position - doc.length)
          : doc.lineAt(position).number;
    return {
      label,
      position,
      lineAtY: (y: number) => (y <= PROBE_SPLIT_Y ? lineForPosition : doc.lines),
    };
  });
}

describe("§3 readSpyLineRange — laws", () => {
  it("V-6/V-9: LAW range containment — every result is null or an integer range inside [1, doc.lines]", () => {
    const reference = EditorState.create({ doc: TWELVE_LINE_DOC });
    const domain = buildAnchorDomain(reference.doc);
    expect(domain, "V-6: the 24-row anchor domain").toHaveLength(24);

    const results: ({ topLine: number; bottomLine: number } | null)[] = [];
    for (const row of domain) {
      const fixture = makeView({ doc: TWELVE_LINE_DOC, lineAtY: row.lineAtY });
      expectFixtureGeometry(fixture);
      const lineCount = fixture.state.doc.lines;
      const result = readSpyLineRange(fixture.view);
      results.push(result);

      if (result === null) continue;
      const where = `V-6 row "${row.label}" (position ${row.position})`;
      // V-9 is folded into this conjunction: fractional lines are a distinct failure
      // mode (deriving a line by dividing pixels by a line height) and a distinct claim.
      expect(Number.isInteger(result.topLine), `${where}: topLine integer`).toBe(true);
      expect(Number.isInteger(result.bottomLine), `${where}: bottomLine integer`).toBe(true);
      expect(result.topLine, `${where}: topLine >= 1`).toBeGreaterThanOrEqual(1);
      expect(result.topLine, `${where}: ordering`).toBeLessThanOrEqual(result.bottomLine);
      expect(result.bottomLine, `${where}: bottomLine <= doc.lines`).toBeLessThanOrEqual(
        lineCount,
      );
    }

    // Wrong-reason guards: containment is vacuous if everything returns `null`, and it
    // is nearly vacuous if the output is constant.
    expect(
      results.filter((r) => r !== null).length,
      "V-6 guard (a): containment is vacuous when everything is null",
    ).toBeGreaterThan(18);
    expect(
      new Set(results.map((r) => r?.topLine)).size,
      "V-6 guard (b): the output must vary across the domain",
    ).toBeGreaterThanOrEqual(4);
  });

  it("V-7: LAW clamp monotonicity — topLine never decreases as the probed position rises", () => {
    const reference = EditorState.create({ doc: TWELVE_LINE_DOC });
    const domain = buildAnchorDomain(reference.doc).sort((a, b) => a.position - b.position);

    // Wrong-reason guard (a): the domain must straddle both clamps, or monotonicity is
    // only being asserted over the easy middle.
    expect(
      domain.some((r) => r.position < 0),
      "V-7 guard (a): domain must reach below doc start",
    ).toBe(true);
    expect(
      domain.some((r) => r.position > reference.doc.length),
      "V-7 guard (a): domain must reach past doc end",
    ).toBe(true);

    const observed: { label: string; topLine: number }[] = [];
    for (const row of domain) {
      const fixture = makeView({ doc: TWELVE_LINE_DOC, lineAtY: row.lineAtY });
      const result = readSpyLineRange(fixture.view);
      if (result !== null) observed.push({ label: row.label, topLine: result.topLine });
    }

    for (let i = 1; i < observed.length; i++) {
      expect(
        observed[i].topLine,
        `V-7: topLine decreased from "${observed[i - 1].label}" to "${observed[i].label}" (seed ${DEFAULT_SEED})`,
      ).toBeGreaterThanOrEqual(observed[i - 1].topLine);
    }

    // Wrong-reason guard (b): a constant implementation satisfies monotonicity for free.
    expect(
      new Set(observed.map((o) => o.topLine)).size,
      "V-7 guard (b): a constant topLine satisfies monotonicity vacuously",
    ).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// The degenerate geometries. All three land on the same single rule.
// ---------------------------------------------------------------------------

describe("§3 readSpyLineRange — degenerate geometry returns null, never a clamped range", () => {
  it("V-10: inverted probes on a healthy scroller return null", () => {
    // The rect is held healthy so the inversion can only come from the probe mapping.
    // No pre-probe anchor-vs-bottom check can pass this case; it is what forces the
    // *post*-probe ordering check to exist at all.
    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      rect: DEFAULT_FIXTURE_RECT,
      lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 9 : 2),
    });
    expectFixtureGeometry(fixture);

    const result = readSpyLineRange(fixture.view);
    expect(result, "V-10: not {topLine: 9, bottomLine: 9} — the max-clamp is rejected").toBeNull();
    // The law kept in its `null`-tolerant form on purpose: it is the clause that survives
    // if a future implementer decides some inverted geometry is recoverable.
    expect(result === null || result.topLine <= result.bottomLine).toBe(true);
  });

  it("V-12: a zero-height / detached scroller returns null", () => {
    // The honest mapping: on a zero-height element the top probe fires at y = 40, below
    // the content, where imprecise `posAtCoords` returns the last position; the bottom
    // probe fires at y = -1, above it, where it returns 0.
    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      rect: ZERO_RECT,
      lineAtY: (y) => (y < 0 ? 1 : 12),
    });

    // Guard (a) — proof the rect really is the degenerate one, not the healthy default.
    expect(
      fixture.scrollDOM.getBoundingClientRect().height,
      "V-12 guard (a): this case exists to test the zero rect",
    ).toBe(0);

    const result = readSpyLineRange(fixture.view);
    // The max-clamp alternative would yield {doc.lines, doc.lines}, `pickActiveKeyByLine`
    // would select the *last* heading, and the outline would jump to the bottom of the
    // document on every mode toggle. That is the reachability argument for this case.
    expect(result).toBeNull();

    // Guard (b) — never a half-probe. The function may decline to probe at all, or probe
    // both ends and reject the pair; it must never probe the top, get an answer, and
    // return it with no bottom probe to compare against.
    expect(
      fixture.probeLog.length === 0 || fixture.probeLog.length === 2,
      `V-12 guard (b): half-probe (${fixture.probeLog.length} probes)`,
    ).toBe(true);
  });

  it("V-13: a scroller shorter than the anchor offset returns null", () => {
    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      rect: SHORT_RECT,
      lineAtY: (y) => (y >= 30 ? 12 : 1),
    });

    // Guard (a) — stated against the *imported* constant, so this case is a statement
    // about the anchor rather than about the number 30. This is also what distinguishes
    // V-13 from V-12.
    expect(
      SHORT_RECT.bottom,
      "V-13 guard (a): the fixture scroller must be shorter than the anchor offset",
    ).toBeLessThan(SPY_ANCHOR_OFFSET_PX);

    expect(readSpyLineRange(fixture.view)).toBeNull();

    expect(
      fixture.probeLog.length === 0 || fixture.probeLog.length === 2,
      `V-13 guard (b): half-probe (${fixture.probeLog.length} probes)`,
    ).toBe(true);
    // Nothing indexes probeLog unconditionally: the correct pre-probe bail produces an
    // empty log, and an unguarded index would throw on a correct implementation.
    if (fixture.probeLog.length === 2) {
      expect(
        fixture.probeLog[0].y,
        "V-13 guard (b): when dispatched, the probes really did invert",
      ).toBeGreaterThan(fixture.probeLog[1].y);
    }
  });
});

// ---------------------------------------------------------------------------
// V-8 — constant agreement with the navigate path. Real EditorView (Shape B).
// ---------------------------------------------------------------------------

/**
 * The shape `EditorView.scrollIntoView` puts in the effect. CodeMirror declares
 * `ScrollTarget` but does not export it, so it is described structurally — the same
 * treatment as `tests/use-toc-source-mode-navigation.test.ts:101-105`.
 */
interface ScrollTargetLike {
  range: { from: number; to: number };
  y: string;
  yMargin: number;
}

const SCROLL_EFFECT_TYPE = (
  EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<ScrollTargetLike> }
).type;

/** Without this, a CodeMirror change turns V-8 into a silent false negative. */
function expectEffectProbeWired(): void {
  expect(EditorView.scrollIntoView(0).is(SCROLL_EFFECT_TYPE)).toBe(true);
}

const SOURCE_CONTAINER_ID = "source-container";
const realSetEntries = useTOCStore.getState().setEntries;

describe("§3 V-8: the navigate path's yMargin is SPY_ANCHOR_OFFSET_PX", () => {
  let captured: Transaction[] = [];
  let views: EditorView[] = [];
  let receivers: ScrollReceiver[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    captured = [];
    views = [];
    receivers = captureScrollReceivers();
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
    for (const view of views) view.destroy();
    views = [];
    document.getElementById(SOURCE_CONTAINER_ID)?.remove();
    useEditorStore.setState({ editorView: null });
    vi.useRealTimers();
  });

  it("V-8: the sole dispatched scroll effect carries yMargin === SPY_ANCHOR_OFFSET_PX and y === 'start'", () => {
    const container = document.createElement("div");
    container.id = SOURCE_CONTAINER_ID;
    document.body.appendChild(container);

    const content = "# One\n\nbody\n\n## Two\n\nmore body\n\n# Three";
    const view = new EditorView({
      state: EditorState.create({ doc: content }),
      dispatch: (tr, self) => {
        captured.push(tr);
        self.update([tr]);
      },
    });
    views.push(view);
    useEditorStore.setState({ editorView: view });

    const { result } = renderHook(() =>
      useTOC({
        content,
        documentId: "doc-v8",
        containerId: SOURCE_CONTAINER_ID,
        viewMode: "source",
        enableSpyScrolling: false,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const list: TOCEntry[] = useTOCStore.getState().entries;
    expect(list).toHaveLength(3);
    // H2 — pairwise distinct keys, per §0.5.
    expect(new Set(list.map((e) => e.key)).size, "V-8: H2").toBe(list.length);
    expectEffectProbeWired();

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    const targets = captured.flatMap((tr) =>
      tr.effects
        .filter((e: StateEffect<unknown>): e is StateEffect<ScrollTargetLike> =>
          e.is(SCROLL_EFFECT_TYPE),
        )
        .map((e) => e.value),
    );
    expect(targets, "V-8: exactly one scroll effect").toHaveLength(1);
    expect(targets[0].yMargin).toBe(SPY_ANCHOR_OFFSET_PX);
    expect(targets[0].y).toBe("start");
    // Negative invariant: source mode scrolls no Element.
    expect(receivers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// WI-1 — V-14 / V-14b. The subject of these two cases is the **double itself**
// (`tests/helpers/fakeCodemirrorView.ts`), not `readSpyLineRange`. They are appended
// here rather than given a new file because §0.2 keeps every case in the four existing
// suites, and the V- numbering lives in this one.
//
// Law under test: **read-back fidelity.** For every scroll shape `s`, installing `s` on
// the double and reading `scrollDOM.scrollTop / scrollHeight / clientHeight` returns
// exactly `s` — at construction (V-14) and after a live mutation (V-14b). Everything
// WI-2 specifies is unreachable if this fails: jsdom answers 0/0/0 for every element,
// so without a live override the whole suite would silently exercise the unlaid-out
// shape and go green for the wrong reason.
// ---------------------------------------------------------------------------

describe("§0.8 the EditorView double's scroll metrics", () => {
  it("V-14: the double reports the scroll metrics it was given, on all five named shapes", () => {
    // ---- Clause (i): the wrong-reason guard, asserted FIRST -----------------
    // An unpatched jsdom `<div>` reports 0/0/0. This is the premise every other
    // geometry case rests on: if jsdom ever grows layout, or the `Object.defineProperty`
    // install is dropped, this clause reds instead of the downstream cases going green
    // for the wrong reason.
    const bare = document.createElement("div");
    document.body.appendChild(bare);
    try {
      expect(bare.isConnected, "V-14(i): the bare div must be attached, like the double's").toBe(
        true,
      );
      expect(bare.scrollTop, "V-14(i): jsdom's own scrollTop").toBe(0);
      expect(bare.scrollHeight, "V-14(i): jsdom's own scrollHeight").toBe(0);
      expect(bare.clientHeight, "V-14(i): jsdom's own clientHeight").toBe(0);
    } finally {
      bare.remove();
    }

    // ---- Clause (ii): each named shape is read back off the real element ----
    const shapes: { label: string; scroll: FixtureScrollMetrics }[] = [
      { label: "MID_SCROLL", scroll: MID_SCROLL },
      { label: "AT_LIMIT_SCROLL", scroll: AT_LIMIT_SCROLL },
      { label: "SHORT_DOC_SCROLL", scroll: SHORT_DOC_SCROLL },
      { label: "UNLAID_OUT_SCROLL", scroll: UNLAID_OUT_SCROLL },
      { label: "COLLAPSED_SCROLL", scroll: COLLAPSED_SCROLL },
    ];

    for (const { label, scroll } of shapes) {
      const fixture = makeView({
        doc: TWELVE_LINE_DOC,
        lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 4 : 11),
        scroll,
      });

      // Read off the **real** `<div>`, never off the constant — a double that returned a
      // canned object without touching the DOM fails here.
      expect(fixture.scrollDOM.scrollTop, `V-14 ${label}: scrollTop`).toBe(scroll.scrollTop);
      expect(fixture.scrollDOM.scrollHeight, `V-14 ${label}: scrollHeight`).toBe(
        scroll.scrollHeight,
      );
      expect(fixture.scrollDOM.clientHeight, `V-14 ${label}: clientHeight`).toBe(
        scroll.clientHeight,
      );
      expect(fixture.scroll, `V-14 ${label}: fixture.scroll`).toEqual(scroll);

      // The existing behaviour the extension must not disturb.
      expect(fixture.state.doc.lines, `V-14 ${label}: the real EditorState survives`).toBe(12);
      expect(
        fixture.scrollDOM.getBoundingClientRect().bottom,
        `V-14 ${label}: the rect override survives`,
      ).toBe(DEFAULT_FIXTURE_RECT.bottom);

      // The precondition each shape is entitled to, per the matrix's Correction 3. The
      // asymmetry is deliberate: `UNLAID_OUT_SCROLL` is the one shape indistinguishable
      // from jsdom's own default, so a liveness check on it would be vacuous.
      if (scroll === UNLAID_OUT_SCROLL) {
        expect(scroll, "V-14: UNLAID_OUT_SCROLL is jsdom's own shape").toEqual({
          scrollTop: 0,
          scrollHeight: 0,
          clientHeight: 0,
        });
      } else if (scroll === COLLAPSED_SCROLL) {
        expectScrollOverrideLive(fixture);
      } else {
        expectFixtureGeometry(fixture);
      }
    }

    // `COLLAPSED_SCROLL`'s zero is a *deliberate* zero, and the case proves it is not an
    // absent override: jsdom cannot produce `scrollHeight === 600` with
    // `clientHeight === 0` on its own. This is the row `expectScrollOverrideLive`
    // generalises — the two must not drift apart.
    expect(COLLAPSED_SCROLL.clientHeight, "V-14: COLLAPSED_SCROLL's deliberate zero").toBe(0);
    expect(
      COLLAPSED_SCROLL.scrollHeight,
      "V-14: …distinguishable from an absent override",
    ).toBeGreaterThan(0);

    // ---- The default shape ------------------------------------------------
    // `MID_SCROLL`, not at-limit and not all-zero: at-limit would re-enable retention
    // across every existing case and hide the defect; all-zero would flip them into the
    // degenerate branch.
    const defaulted = makeView({ doc: TWELVE_LINE_DOC, lineAtY: () => 1 });
    expect(defaulted.scroll, "V-14: the default is MID_SCROLL").toEqual(MID_SCROLL);
    expect(defaulted.scrollDOM.scrollHeight, "V-14: the default is installed, not implied").toBe(
      MID_SCROLL.scrollHeight,
    );
    expect(MID_SCROLL, "V-14: the default is not the at-limit shape").not.toEqual(AT_LIMIT_SCROLL);
    expect(MID_SCROLL, "V-14: the default is not the unlaid-out shape").not.toEqual(
      UNLAID_OUT_SCROLL,
    );

    // ---- Coherence with the rect (matrix Correction 1) ---------------------
    // H-3 and T-3 declare `AT_LIMIT_SCROLL` *and* call `expectFixtureGeometry`, so all
    // three laid-out shapes — not just `MID_SCROLL`, as the plan says — must agree with
    // the rect the same double reports.
    for (const [label, shape] of [
      ["MID_SCROLL", MID_SCROLL],
      ["AT_LIMIT_SCROLL", AT_LIMIT_SCROLL],
      ["SHORT_DOC_SCROLL", SHORT_DOC_SCROLL],
    ] as const) {
      expect(shape.clientHeight, `V-14: ${label} must agree with the fixture rect`).toBe(
        DEFAULT_FIXTURE_RECT.height,
      );
    }
  });

  it("V-14b: setScrollMetrics changes what a live view reports", () => {
    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 4 : 11),
      scroll: MID_SCROLL,
    });
    const viewAtConstruction = fixture.view;

    const readDom = (): FixtureScrollMetrics => ({
      scrollTop: fixture.scrollDOM.scrollTop,
      scrollHeight: fixture.scrollDOM.scrollHeight,
      clientHeight: fixture.scrollDOM.clientHeight,
    });

    expect(readDom(), "V-14b read 1: DOM").toEqual(MID_SCROLL);
    expect(fixture.scroll, "V-14b read 1: fixture.scroll").toEqual(MID_SCROLL);
    const beforeMutation = fixture.scroll;

    fixture.setScrollMetrics(AT_LIMIT_SCROLL);
    expect(readDom(), "V-14b read 2: DOM").toEqual(AT_LIMIT_SCROLL);
    expect(fixture.scroll, "V-14b read 2: fixture.scroll").toEqual(AT_LIMIT_SCROLL);
    expect(
      fixture.scroll,
      "V-14b: fixture.scroll must not still be the value read before the mutation",
    ).not.toEqual(beforeMutation);

    // The round trip is what kills a one-way latch.
    fixture.setScrollMetrics(MID_SCROLL);
    expect(readDom(), "V-14b read 3: DOM").toEqual(MID_SCROLL);
    expect(fixture.scroll, "V-14b read 3: fixture.scroll").toEqual(MID_SCROLL);

    // The transition arrives mid-session, so it must happen on the *same* installed
    // `EditorView` — exactly the reason recorded for `setRect`.
    expect(fixture.view, "V-14b: the same EditorView instance throughout").toBe(
      viewAtConstruction,
    );

    // Level 6 structural supplement: `fixture.scroll` is a getter over the live value,
    // not a snapshot taken at construction (mirrors the recorded reason for `rect`).
    const descriptor = Object.getOwnPropertyDescriptor(fixture, "scroll");
    expect(typeof descriptor?.get, "V-14b: fixture.scroll must be a getter").toBe("function");
    expect(descriptor?.value, "V-14b: …and not a snapshot property").toBeUndefined();
    const rectDescriptor = Object.getOwnPropertyDescriptor(fixture, "rect");
    expect(typeof rectDescriptor?.get, "V-14b: the rect getter is unchanged").toBe("function");
  });
});

// ---------------------------------------------------------------------------
// WI-2 — V-15 … V-22: `atScrollLimit`, the third field of `SpyLineRange`.
//
// Two laws are added to this file's list, both new:
//
//   3. **Orthogonality of the `null` decision to the scroll shape** (V-21, S4) — whether
//      the function answers `null` is a function of the rect and the probes alone. No
//      scroll shape may turn a `null` into a range or a range into a `null`, and no
//      scroll shape may move `topLine` or `bottomLine`.
//   4. **Monotonicity of `atScrollLimit` in `scrollTop`** (V-22, S4) — with the other two
//      metrics held fixed and `clientHeight > 0`, the answer never goes `true → false` as
//      the scroller moves down, including past the maximum.
//
// Not verifiable in this repo, recorded rather than faked: that the scroller **really is**
// at its limit when the browser says it is. Browser geometry; jsdom has none. Obligation
// UNMET → WI-6 QA-B / QA-C / QA-D / QA-E.
// ---------------------------------------------------------------------------

/** The healthy 12-line probe mapping the metric cases share, so only metrics differ. */
const SPLIT_4_11 = (y: number): number => (y <= PROBE_SPLIT_Y ? 4 : 11);

describe("§3 readSpyLineRange — atScrollLimit", () => {
  it("V-15/V-16: the at-limit shape answers true and the mid-scroll shape answers false, on otherwise-identical geometry", () => {
    // A/B precondition, executable rather than asserted in prose: the two named shapes
    // agree on everything but `scrollTop`, so nothing else can explain the two answers.
    expect(AT_LIMIT_SCROLL.scrollHeight, "V-16: same scrollHeight").toBe(MID_SCROLL.scrollHeight);
    expect(AT_LIMIT_SCROLL.clientHeight, "V-16: same clientHeight").toBe(MID_SCROLL.clientHeight);
    expect(AT_LIMIT_SCROLL.scrollTop, "V-16: only scrollTop differs").not.toBe(
      MID_SCROLL.scrollTop,
    );

    const atLimit = makeView({
      doc: TWELVE_LINE_DOC,
      lineAtY: SPLIT_4_11,
      scroll: AT_LIMIT_SCROLL,
    });
    expectFixtureGeometry(atLimit);
    const mid = makeView({ doc: TWELVE_LINE_DOC, lineAtY: SPLIT_4_11, scroll: MID_SCROLL });
    expectFixtureGeometry(mid);

    const resultAtLimit = readSpyLineRange(atLimit.view);
    const resultMid = readSpyLineRange(mid.view);

    // V-16's Level 6 supplement, asserted **first** because it is this case's
    // wrong-reason guard: these clauses hold before the fix as well as after it, so a red
    // here means the new field perturbed the old ones rather than that it is missing.
    expect(resultAtLimit?.topLine, "V-16: the new field must not perturb topLine").toBe(
      resultMid?.topLine,
    );
    expect(resultAtLimit?.bottomLine, "V-16: …nor bottomLine").toBe(resultMid?.bottomLine);
    // `bottomLine` is 11 while the document has 12 lines, so the **rejected**
    // `bottomLine === doc.lines` predicate answers `false` here where V-15 requires
    // `true`. V-15 is therefore the false-negative half of that predicate's kill
    // (retention lost at the bottom → the clamped click targets break); V-20 is the
    // false-positive half (retention wrongly re-enabled mid-document → the freeze returns).
    expect(atLimit.state.doc.lines, "V-15: bottomLine is short of doc.lines at the limit").toBe(
      12,
    );
    expect(resultAtLimit?.bottomLine, "V-15: …asserted, not assumed").toBe(11);

    // V-15 — Level 1 on the whole object, so a change to `atScrollLimit` cannot be bought
    // by moving a line number.
    expect(resultAtLimit, "V-15: the at-limit shape").toEqual({
      topLine: 4,
      bottomLine: 11,
      atScrollLimit: true,
    });
    // V-16 — the same line fields, the opposite answer. Kills every implementation that
    // ignores `scrollTop`, including `clientHeight > 0` alone and `scrollHeight <= clientHeight`.
    expect(resultMid, "V-16: the mid-scroll shape").toEqual({
      topLine: 4,
      bottomLine: 11,
      atScrollLimit: false,
    });
  });

  it("V-17: the zero-maximum class — laid out answers true, a collapsed viewport answers false", () => {
    // The isolation relations, as executable assertions and not prose: these two shapes
    // differ in `clientHeight` **alone**, and they have different answers.
    expect(COLLAPSED_SCROLL.scrollTop, "V-17: same scrollTop").toBe(SHORT_DOC_SCROLL.scrollTop);
    expect(COLLAPSED_SCROLL.scrollHeight, "V-17: same scrollHeight").toBe(
      SHORT_DOC_SCROLL.scrollHeight,
    );
    expect(COLLAPSED_SCROLL.clientHeight, "V-17: only clientHeight differs").not.toBe(
      SHORT_DOC_SCROLL.clientHeight,
    );

    // ---- row (a): laid out, content exactly fills the viewport -------------
    expect(
      SHORT_DOC_SCROLL.scrollHeight - SHORT_DOC_SCROLL.clientHeight,
      "V-17(a): the maximum scroll offset really is 0",
    ).toBe(0);
    expect(SHORT_DOC_SCROLL.clientHeight, "V-17(a): …and it is laid out").toBeGreaterThan(0);
    const laidOut = makeView({
      doc: TWELVE_LINE_DOC,
      lineAtY: SPLIT_4_11,
      scroll: SHORT_DOC_SCROLL,
    });
    expectFixtureGeometry(laidOut);
    const resultLaidOut = readSpyLineRange(laidOut.view);
    expect(resultLaidOut, "V-17(a)").not.toBeNull();
    // Kills `scrollHeight > clientHeight` ("is it scrollable at all"), the natural-looking
    // simplification that breaks every short document: clicking a heading in a document
    // that fits the viewport would snap the highlight back to the anchor.
    expect(resultLaidOut?.atScrollLimit, "V-17(a): a short document is at its limit").toBe(true);

    // ---- row (b): a collapsed viewport over real content -------------------
    const collapsed = makeView({
      doc: TWELVE_LINE_DOC,
      lineAtY: SPLIT_4_11,
      scroll: COLLAPSED_SCROLL,
    });
    // **A different helper from row (a), deliberately.** `COLLAPSED_SCROLL.clientHeight`
    // is 0 and cannot satisfy `expectFixtureGeometry`'s rect-coherence conjunct;
    // normalising the two to make this body look consistent reds this row for no defect.
    expectScrollOverrideLive(collapsed);
    // Why that precondition is load-bearing and not ceremony: the three isolation
    // assertions above compare the two *constants* and never touch this element. Row (b)
    // expects `false`, which is also what a dead `Object.defineProperty` install would
    // produce out of jsdom's own 0/0/0 — permanently green, proving nothing. The
    // `scrollHeight === 600` read is what separates a **deliberate** zero from an
    // **absent** override, and that separation is the entire reason COLLAPSED_SCROLL exists.
    expect(
      collapsed.scrollDOM.scrollHeight,
      "V-17(b): a deliberate zero, not an absent override",
    ).toBe(600);
    expect(collapsed.scrollDOM.clientHeight, "V-17(b): …collapsed on purpose").toBe(0);
    const resultCollapsed = readSpyLineRange(collapsed.view);
    expect(resultCollapsed, "V-17(b)").not.toBeNull();
    // Honest limit, recorded: this row does **not** kill an implementation that omits the
    // `clientHeight > 0` conjunct — without it, `0 >= 600 - 0 - 1` is `false` anyway.
    // V-18 is the only case that kills the missing conjunct.
    expect(resultCollapsed?.atScrollLimit, "V-17(b): a collapsed viewport is not at a limit").toBe(
      false,
    );
  });

  it("V-18: an unlaid-out all-zero scroller answers false, although its maximum scroll offset is also 0", () => {
    // Neither `expectFixtureGeometry` nor `expectScrollOverrideLive` is called here: 0/0/0
    // is the one shape indistinguishable from jsdom's own default, so a liveness check
    // would be vacuous. The harder precondition below stands in its place.
    //
    // What this pair records, and no more: UNLAID_OUT and SHORT_DOC differ in
    // `scrollHeight` too (0 vs 600), so this is **not** an isolation of `clientHeight` —
    // that claim lives in V-17 row (b). What it does prove is the weaker and still
    // load-bearing statement: **the answer is not a function of
    // `(scrollHeight − clientHeight, scrollTop)` alone.**
    expect(
      UNLAID_OUT_SCROLL.scrollHeight - UNLAID_OUT_SCROLL.clientHeight,
      "V-18: the two shapes have the same maximum scroll offset",
    ).toBe(SHORT_DOC_SCROLL.scrollHeight - SHORT_DOC_SCROLL.clientHeight);
    expect(UNLAID_OUT_SCROLL.scrollTop, "V-18: …and the same scrollTop").toBe(
      SHORT_DOC_SCROLL.scrollTop,
    );
    expect(UNLAID_OUT_SCROLL.clientHeight, "V-18: …and differ in clientHeight").not.toBe(
      SHORT_DOC_SCROLL.clientHeight,
    );

    const fixture = makeView({
      doc: TWELVE_LINE_DOC,
      // Healthy, so the *rect* cannot be what produces the answer.
      rect: DEFAULT_FIXTURE_RECT,
      lineAtY: SPLIT_4_11,
      scroll: UNLAID_OUT_SCROLL,
    });
    const result = readSpyLineRange(fixture.view);
    expect(result, "V-18: the rect is healthy, so the range itself is real").not.toBeNull();

    // **THE KILL, and the reason this shape may not be deleted as "redundant with V-17".**
    // This is the only shape in the matrix where the `clientHeight > 0` conjunct changes
    // the answer: without it, `scrollTop 0 >= (0 - 0) - 1 = -1` is `true`, retention is
    // re-enabled permanently on every unlaid-out frame — every mode toggle, every remount —
    // and the original upward-scroll freeze returns with every other case still green.
    expect(result?.atScrollLimit, "V-18: untrustworthy geometry must fail false").toBe(false);
  });

  it("V-19: the tolerance boundary table", () => {
    interface ToleranceRow {
      label: string;
      scroll: FixtureScrollMetrics;
      remaining: number;
      expected: boolean;
    }
    const rows: ToleranceRow[] = [
      {
        label: "a: remaining 0",
        scroll: { scrollTop: 2400, scrollHeight: 3000, clientHeight: 600 },
        remaining: 0,
        expected: true,
      },
      {
        label: "b: remaining 0.5 (a fractional landing)",
        scroll: { scrollTop: 2399.5, scrollHeight: 3000, clientHeight: 600 },
        remaining: 0.5,
        expected: true,
      },
      {
        // The inequality-direction pin: `>=`, not `>`. Do not soften this row.
        label: "c: remaining exactly the tolerance — pins >= and not >",
        scroll: { scrollTop: 2399, scrollHeight: 3000, clientHeight: 600 },
        remaining: 1,
        expected: true,
      },
      {
        label: "d: remaining 2",
        scroll: { scrollTop: 2398, scrollHeight: 3000, clientHeight: 600 },
        remaining: 2,
        expected: false,
      },
      {
        // Row (e) kills the `Math.abs(scrollTop − max) <= TOL` variant **outright**:
        // `abs(2410 − 2400) = 10 > 1` answers `false` where this row requires `true`. It
        // is therefore not "just another overscroll point" and must not be deleted as one.
        label: "e: downward overscroll (macOS rubber-band)",
        scroll: { scrollTop: 2410, scrollHeight: 3000, clientHeight: 600 },
        remaining: -10,
        expected: true,
      },
      {
        // Row (f) kills `max = Math.max(0, scrollHeight − clientHeight)`. A clientHeight
        // one pixel larger than scrollHeight is a real rounding outcome, not a fiction.
        label: "f: negative maximum (clientHeight > scrollHeight)",
        scroll: { scrollTop: 0, scrollHeight: 600, clientHeight: 601 },
        remaining: -1,
        expected: true,
      },
    ];

    for (const row of rows) {
      const { scrollTop, scrollHeight, clientHeight } = row.scroll;
      expect(
        scrollHeight - clientHeight - scrollTop,
        `V-19 ${row.label}: the row's own remaining distance`,
      ).toBe(row.remaining);

      // Stated against the **imported constant**, so rows a–d are a statement about
      // `SPY_SCROLL_LIMIT_TOLERANCE_PX` and not about the number 1. Changing the constant
      // must change this table with it.
      if (row.remaining >= 0) {
        expect(
          row.remaining <= SPY_SCROLL_LIMIT_TOLERANCE_PX,
          `V-19 ${row.label}: remaining ${row.remaining} vs the tolerance`,
        ).toBe(row.expected);
      }

      const fixture = makeView({
        doc: TWELVE_LINE_DOC,
        lineAtY: SPLIT_4_11,
        scroll: row.scroll,
      });
      if (clientHeight === DEFAULT_FIXTURE_RECT.height) {
        expectFixtureGeometry(fixture);
      } else {
        // Row (f) only: `clientHeight` 601 cannot satisfy the rect-coherence conjunct.
        expectScrollOverrideLive(fixture);
        // …and its own precondition, so it cannot silently degrade into row (a).
        expect(clientHeight, `V-19 ${row.label}: the maximum really is negative`).toBeGreaterThan(
          scrollHeight,
        );
      }

      const result = readSpyLineRange(fixture.view);
      expect(result, `V-19 ${row.label}`).not.toBeNull();
      expect(
        result?.atScrollLimit,
        `V-19 ${row.label} (remaining ${row.remaining}, tolerance ${SPY_SCROLL_LIMIT_TOLERANCE_PX})`,
      ).toBe(row.expected);
    }
  });

  it("V-20: a wrapped final line — bottomLine === doc.lines while thousands of pixels of scrolling remain → false", () => {
    const FORTY_LINE_DOC = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
    const WRAPPED_SCROLL: FixtureScrollMetrics = {
      scrollTop: 0,
      scrollHeight: 8000,
      clientHeight: 600,
    };
    const fixture = makeView({
      doc: FORTY_LINE_DOC,
      // The bottom probe (`rect.bottom - 1` = 599) lands inside the **final logical line**
      // while the anchor is still up at line 12. That is exactly what a long wrapped final
      // paragraph produces in a real browser, and line wrapping is a live user preference
      // (`wordWrapCompartment`), re-applied on every editor create.
      lineAtY: (y) => (y >= DEFAULT_FIXTURE_RECT.bottom - 1 ? 40 : 12),
      scroll: WRAPPED_SCROLL,
    });
    expectFixtureGeometry(fixture);
    expect(fixture.state.doc.lines, "V-20: a 40-line document").toBe(40);

    const result = readSpyLineRange(fixture.view);
    expect(result, "V-20").not.toBeNull();

    // **Both conjuncts in one `it()`** — the kill only counts if the co-occurrence is
    // recorded in one place. Split across two cases it proves nothing. This is the case
    // that rejects the `bottomLine === doc.lines` predicate in its false-positive
    // direction, the direction that re-enables the freeze mid-document.
    expect(
      result?.bottomLine,
      "V-20: the bottom probe is inside the last logical line",
    ).toBe(fixture.state.doc.lines);
    expect(result?.atScrollLimit, "V-20: …and the scroller is nowhere near its limit").toBe(false);

    // Level 6 supplement, stated in terms of the constant rather than as a bare number.
    const remaining =
      WRAPPED_SCROLL.scrollHeight - WRAPPED_SCROLL.clientHeight - WRAPPED_SCROLL.scrollTop;
    expect(remaining, "V-20: thousands of pixels of scrolling remain").toBeGreaterThan(
      SPY_SCROLL_LIMIT_TOLERANCE_PX * 1000,
    );
  });

  it("V-21: LAW — the null contract and the line fields are orthogonal to the scroll shape", () => {
    // `COLLAPSED_SCROLL` is deliberately **excluded**: it is V-17's discriminator shape,
    // not a representative of a distinct `atScrollLimit` class (it answers `false`, as
    // MID and UNLAID_OUT already do). Including it would inflate the row counts without
    // adding an equivalence class. The omission is a decision, not an oversight.
    const SCROLL_SHAPES = [
      ["MID_SCROLL", MID_SCROLL],
      ["AT_LIMIT_SCROLL", AT_LIMIT_SCROLL],
      ["SHORT_DOC_SCROLL", SHORT_DOC_SCROLL],
      ["UNLAID_OUT_SCROLL", UNLAID_OUT_SCROLL],
    ] as const;

    // ---- the rows that answer `null` today ---------------------------------
    const nullRows: string[] = [];

    // The two view-less rows carry no fixture and therefore no scroll shape. They are run
    // **once each** rather than as four identical copies; the row count below says so
    // rather than faking four rows.
    expect(readSpyLineRange(null), "V-21: null view").toBeNull();
    nullRows.push("null view");
    expect(
      readSpyLineRange(undefined as unknown as EditorView),
      "V-21: undefined view",
    ).toBeNull();
    nullRows.push("undefined view");

    const degenerate: { label: string; options: Parameters<typeof createFakeView>[0] }[] = [
      {
        label: "detached + ZERO_RECT",
        options: {
          doc: TWELVE_LINE_DOC,
          rect: ZERO_RECT,
          attach: false,
          lineAtY: (y) => (y < 0 ? 1 : 12),
        },
      },
      {
        label: "ZERO_RECT attached",
        options: { doc: TWELVE_LINE_DOC, rect: ZERO_RECT, lineAtY: (y) => (y < 0 ? 1 : 12) },
      },
      {
        label: "SHORT_RECT",
        options: { doc: TWELVE_LINE_DOC, rect: SHORT_RECT, lineAtY: (y) => (y >= 30 ? 12 : 1) },
      },
      {
        label: "throwOnProbe first",
        options: { doc: TWELVE_LINE_DOC, throwOnProbe: "first", lineAtY: SPLIT_4_11 },
      },
      {
        label: "throwOnProbe second",
        options: { doc: TWELVE_LINE_DOC, throwOnProbe: "second", lineAtY: SPLIT_4_11 },
      },
      {
        label: "inverted probes on a healthy rect",
        options: {
          doc: TWELVE_LINE_DOC,
          rect: DEFAULT_FIXTURE_RECT,
          lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 9 : 2),
        },
      },
    ];

    for (const shape of degenerate) {
      for (const [scrollLabel, scroll] of SCROLL_SHAPES) {
        // **Deliberate incoherence, declared.** A 30px-tall or zero rect paired with a
        // 600px `clientHeight` is physically impossible in a browser. That is the point:
        // the claim is that the degenerate bail happens *before* the metrics can matter.
        // These rows therefore call neither geometry precondition — do not "fix" the
        // incoherence, because fixing it silently deletes the claim.
        const fixture = makeView({ ...shape.options, scroll });
        const where = `V-21 null row "${shape.label}" × ${scrollLabel}`;
        expect(readSpyLineRange(fixture.view), where).toBeNull();
        nullRows.push(where);
      }
    }

    // Guard (c) — the domain really was traversed. 8 degenerate shapes × 4 = 32 nominal,
    // less the 6 copies the two view-less rows do not need.
    expect(nullRows.length, "V-21 guard (c): the null domain").toBe(32 - 6);

    // ---- the rows accepted today -------------------------------------------
    // **Deviation from the matrix, recorded.** The matrix names "the 6-row V-5 geometry
    // table" as the accepted set, but every row of V-5's table maps the anchor probe to
    // line 1, so `topLine` is constant at 1 across all six — which makes the matrix's own
    // guard (a) ("≥ 4 distinct topLine values") unsatisfiable. The six rows below keep
    // V-5's document-size spread (1, 2, 12, 12, 12, 400 lines) and vary the anchor
    // instead, so guard (a) is a real measurement rather than a threshold nobody can meet.
    interface AcceptedRow {
      label: string;
      doc: string;
      lineAtY: (y: number) => number;
    }
    const FOUR_HUNDRED_LINE_DOC = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join("\n");
    const accepted: AcceptedRow[] = [
      { label: "1 line / flat", doc: "# Only", lineAtY: () => 1 },
      {
        label: "2 lines / spread",
        doc: "# One\n# Two",
        lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 1 : 2),
      },
      {
        label: "12 lines / anchor 3",
        doc: TWELVE_LINE_DOC,
        lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 3 : 12),
      },
      {
        label: "12 lines / anchor 7",
        doc: TWELVE_LINE_DOC,
        lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 7 : 12),
      },
      { label: "12 lines / flat at the last line", doc: TWELVE_LINE_DOC, lineAtY: () => 12 },
      {
        label: "400 lines / anchor 200",
        doc: FOUR_HUNDRED_LINE_DOC,
        lineAtY: (y) => (y <= PROBE_SPLIT_Y ? 200 : 400),
      },
    ];

    const seen: {
      label: string;
      scrollLabel: string;
      topLine: number;
      bottomLine: number;
      atScrollLimit: boolean;
    }[] = [];
    for (const row of accepted) {
      for (const [scrollLabel, scroll] of SCROLL_SHAPES) {
        const fixture = makeView({ doc: row.doc, lineAtY: row.lineAtY, scroll });
        // `UNLAID_OUT_SCROLL` is exempt: it is indistinguishable from jsdom's default.
        if (scroll !== UNLAID_OUT_SCROLL) expectFixtureGeometry(fixture);
        const where = `V-21 accepted row "${row.label}" × ${scrollLabel}`;
        const result = readSpyLineRange(fixture.view);
        expect(result, `${where}: healthy geometry must not answer null`).not.toBeNull();
        if (result === null) continue;
        expect(result.topLine, `${where}: topLine >= 1`).toBeGreaterThanOrEqual(1);
        expect(result.topLine, `${where}: ordering`).toBeLessThanOrEqual(result.bottomLine);
        expect(result.bottomLine, `${where}: bottomLine <= doc.lines`).toBeLessThanOrEqual(
          fixture.state.doc.lines,
        );
        seen.push({ label: row.label, scrollLabel, ...result });
      }
    }
    expect(seen.length, "V-21 guard (c): 6 accepted shapes × 4 scroll shapes").toBe(24);

    // The orthogonality clause — the part that is a law rather than a table. No scroll
    // shape may move a line field. Kills any implementation that folds the metrics into
    // the probe arithmetic, or that returns a partial object from the degenerate path.
    for (const row of accepted) {
      const forRow = seen.filter((s) => s.label === row.label);
      expect(forRow, `V-21 orthogonality "${row.label}": four shapes`).toHaveLength(4);
      expect(
        new Set(forRow.map((s) => s.topLine)).size,
        `V-21 orthogonality "${row.label}": topLine must not depend on the scroll shape`,
      ).toBe(1);
      expect(
        new Set(forRow.map((s) => s.bottomLine)).size,
        `V-21 orthogonality "${row.label}": bottomLine must not depend on the scroll shape`,
      ).toBe(1);
    }

    // Guard (a) — containment is nearly vacuous over a constant output.
    expect(
      new Set(seen.map((s) => s.topLine)).size,
      "V-21 guard (a): the accepted output must vary",
    ).toBeGreaterThanOrEqual(4);
    // Guard (b) — otherwise "the new field does not disturb the old ones" is being proven
    // over a constant field, and an implementation hardcoding either constant passes.
    expect(
      seen.some((s) => s.atScrollLimit === true),
      "V-21 guard (b): at least one accepted row must be at the limit",
    ).toBe(true);
    expect(
      seen.some((s) => s.atScrollLimit === false),
      "V-21 guard (b): …and at least one must not be",
    ).toBe(true);
  });

  it("V-22: LAW — atScrollLimit is monotone non-decreasing in scrollTop", () => {
    const SWEEP_SCROLL_HEIGHT = 3000;
    const SWEEP_CLIENT_HEIGHT = 600;
    const SWEEP_MAX = SWEEP_SCROLL_HEIGHT - SWEEP_CLIENT_HEIGHT; // 2400

    const named = [0, 1, 1200, 2397, 2398, 2398.5, 2399, 2399.5, 2400, 2400.5, 2401, 2410, 5000];
    const next = createLcg(DEFAULT_SEED);
    const drawn: number[] = [];
    for (let i = 0; i < 11; i++) drawn.push(next() % (SWEEP_SCROLL_HEIGHT + 1));
    const domain = [...named, ...drawn].sort((a, b) => a - b);
    expect(domain, `V-22: a 24-point swept domain (seed ${DEFAULT_SEED})`).toHaveLength(24);

    // Guard (b), asserted **before** the sweep: the domain must straddle the maximum in
    // both directions, or monotonicity is only being claimed over one side of it.
    expect(
      domain.some((t) => t < SWEEP_MAX),
      `V-22 guard (b): the domain must reach below the maximum (seed ${DEFAULT_SEED})`,
    ).toBe(true);
    expect(
      domain.some((t) => t > SWEEP_MAX),
      `V-22 guard (b): …and above it (seed ${DEFAULT_SEED})`,
    ).toBe(true);

    const observed: { scrollTop: number; atScrollLimit: boolean }[] = [];
    for (const scrollTop of domain) {
      const fixture = makeView({
        doc: TWELVE_LINE_DOC,
        lineAtY: SPLIT_4_11,
        scroll: {
          scrollTop,
          scrollHeight: SWEEP_SCROLL_HEIGHT,
          clientHeight: SWEEP_CLIENT_HEIGHT,
        },
      });
      expectFixtureGeometry(fixture);
      const result = readSpyLineRange(fixture.view);
      expect(result, `V-22 scrollTop ${scrollTop}: the line geometry is held healthy`).not.toBeNull();
      if (result === null) continue;
      // Line geometry held constant across the whole sweep, so `scrollTop` is provably
      // the only thing varying.
      expect(result.topLine, `V-22 scrollTop ${scrollTop}: line geometry held constant`).toBe(4);
      expect(result.bottomLine, `V-22 scrollTop ${scrollTop}: line geometry held constant`).toBe(
        11,
      );
      observed.push({ scrollTop, atScrollLimit: result.atScrollLimit });
    }
    expect(observed, "V-22: every sweep point produced a sample").toHaveLength(domain.length);

    for (let i = 1; i < observed.length; i++) {
      const prev = observed[i - 1];
      const cur = observed[i];
      expect(
        prev.atScrollLimit && !cur.atScrollLimit,
        `V-22: atScrollLimit went true → false between scrollTop ${prev.scrollTop} and ${cur.scrollTop} (seed ${DEFAULT_SEED})`,
      ).toBe(false);
    }

    // Guard (a) — monotonicity is free for a constant. This is also what makes the
    // `Math.abs(scrollTop − max) <= TOL` variant die on the 2410 → 5000 step rather than
    // slipping through a vacuously monotone all-false sequence.
    expect(
      observed.some((o) => o.atScrollLimit === false),
      `V-22 guard (a): the sweep must contain a false (seed ${DEFAULT_SEED})`,
    ).toBe(true);
    expect(
      observed.some((o) => o.atScrollLimit === true),
      `V-22 guard (a): …and a true (seed ${DEFAULT_SEED})`,
    ).toBe(true);
  });
});
