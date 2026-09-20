/**
 * Purpose: WI-3.6.4 / plan decision **D4** — `src/hooks/useTOC.ts#scrollToHeading`'s
 * **source (CodeMirror) branch**. Two jobs, and they are different in kind:
 *
 *   1. **Characterization.** WI-3.6.2/3 rewired the *WYSIWYG* branch onto
 *      `resolveHeadingElements`. Nothing in that work was supposed to touch line-number
 *      navigation, and S-1/S-2/S-3/S-5/S-L1 are the pins that say so out loud rather
 *      than leaving "we didn't mean to" as the only evidence. They are **green against
 *      the pre-WI-3.6.4 tree** and are labelled pins, not regressions.
 *   2. **One genuine guard (S-4 / receipt R4).** D4 narrows the branch condition from
 *      `viewMode === "source" && tocEntry?.lineNumber` to `viewMode === "source"` alone,
 *      closing the falsy-`lineNumber` fall-through into the WYSIWYG DOM path. That
 *      fall-through is the only route by which source mode can reach the resolver.
 *
 * Matrix section §8 of `.claude/tdd-guardian/tests-20260919-114230.md` (revision 3):
 * cases S-1, S-2, S-3, S-4, S-5, S-L1. §0 is binding throughout.
 *
 * ---------------------------------------------------------------------------
 * The R4 condition, stated rather than hidden (matrix §8 and §12)
 * ---------------------------------------------------------------------------
 * S-4's red needs **two** non-production conditions at once:
 *
 *   (a) `lineNumber: 0` — the Lezer parser is 1-indexed and cannot emit it, so the test
 *       writes it into the store deliberately; and
 *   (b) `containerId: "milkdown-container"` while `viewMode === "source"` — a pairing
 *       `src/App.tsx:139` never makes (`source` ⇒ `"source-container"`).
 *
 * Under the production pairing the fall-through finds no headings and S-4 is **green**,
 * which is exactly why (b) is written into the harness at the case instead of being
 * inherited from a file-wide default. Both conditions are legitimate for a guard test —
 * the guard exists so the fall-through is unreachable *whatever* the container holds —
 * but an unstated one would have made the red receipt a false one.
 *
 * ---------------------------------------------------------------------------
 * What is real here, and the two things that are not
 * ---------------------------------------------------------------------------
 * - **A real `EditorView` over a real `EditorState`** (§0.7; precedent
 *   `tests/table-write-guard.test.ts:135-143`). No editor mock: mocking the object whose
 *   API is under test would make the test assert its own mock. Transactions are captured
 *   through the documented `dispatch` **config hook**, which is a supported extension
 *   point of the real view, not a substitution — the view still applies every
 *   transaction via `view.update([tr])`.
 * - **`EditorView.scrollIntoView` is a dispatched *effect*, not the DOM method.** Every
 *   positive assertion below reads the captured transaction; the DOM spy is used only
 *   for the *negative* invariant (no `Element` anywhere is scrolled in source mode).
 * - `Element.prototype.scrollIntoView` is **absent** in jsdom — not a no-op — so it is
 *   stubbed then spied by `tests/helpers/scrollReceiver.ts` (§0.9). Unmet integration
 *   obligation §13-2; weak here, because "did not scroll" needs no browser to mean
 *   something.
 * - `resolveHeadingElements` is **spied calling through** (`vi.importActual` passthrough,
 *   the treatment §0.7 gives `loggingService`). It is observation only: the real function
 *   runs, and the spy exists so S-4 can assert the resolver was never *entered* rather
 *   than only that nothing moved. S-4(control) proves the spy fires under otherwise
 *   identical inputs, so the zero in S-4 is a refusal and not a dead wire. The
 *   container's own `querySelector` — the resolver's first act
 *   (`tocElementResolution.ts:122`) — is watched as a second, mock-free witness.
 *
 * `enableSpyScrolling: false` throughout. **This is no longer the production pairing, and
 * saying so is the point of this paragraph.** It used to mirror `App.tsx:140`, which passed
 * `viewMode !== "source"`; WI-5 deleted that argument, so production now leaves the flag
 * defaulted and lets `resolveSpyMode` route on `viewMode` alone — Source mode gets the
 * line-based spy (`useSourceScrollSpy`), not "no spy". The explicit `false` here therefore
 * selects spy mode `"off"`, which is a deliberate **isolation device for this file**, not a
 * characterization of what the app does: it is what keeps every spy mechanism dormant so any
 * `resolveHeadingElements` call counted below can only have come from `scrollToHeading`, and
 * so jsdom's missing `IntersectionObserver` never has to be doubled here. The Source-mode spy
 * that production actually runs is specified in `tests/use-toc-source-scroll-spy.test.ts`
 * (§6, cases T-1…T-10) — not in this file, whose subject is navigation.
 *
 * Standing rule **H2** (§0.4) — every case whose entries come from the live store opens by
 * asserting the keys are pairwise distinct. No assertion anywhere compares against a
 * literal key string.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { StateEffect, StateEffectType, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { useTOC } from "../src/hooks/useTOC";
import { useTOCStore } from "../src/stores/tocStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import type { ViewMode } from "../src/types/editor";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import {
  DEFAULT_CONTAINER_ID,
  mountMilkdownDom,
  unmountMilkdownDom,
} from "./helpers/milkdownHeadingDom";
import type { MilkdownDomFixture } from "./helpers/milkdownHeadingDom";
import { captureScrollReceivers } from "./helpers/scrollReceiver";
import type { ScrollReceiver } from "./helpers/scrollReceiver";
import { resolveHeadingElements } from "../src/utils/tocElementResolution";

vi.mock("../src/utils/tocElementResolution", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/tocElementResolution")>(
    "../src/utils/tocElementResolution",
  );
  return { ...actual, resolveHeadingElements: vi.fn(actual.resolveHeadingElements) };
});

/**
 * The shape `EditorView.scrollIntoView` puts in the effect. CodeMirror declares the class
 * (`ScrollTarget`, `@codemirror/view` d.ts:400) but does **not** export it, so it is
 * described structurally here rather than imported.
 */
interface ScrollTargetLike {
  range: { from: number; to: number };
  y: string;
  yMargin: number;
}

/**
 * The internal `StateEffectType` behind `EditorView.scrollIntoView`. It is not exported
 * either, so it is recovered from a probe effect. `SELF_CHECK` below asserts the recovery
 * still works — without it, a CodeMirror change could turn every "the effect is present"
 * assertion into a silent false negative.
 */
const SCROLL_EFFECT_TYPE = (
  EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<ScrollTargetLike> }
).type;

function expectEffectProbeWired(): void {
  expect(EditorView.scrollIntoView(0).is(SCROLL_EFFECT_TYPE)).toBe(true);
}

const SOURCE_CONTAINER_ID = "source-container";
const realSetEntries = useTOCStore.getState().setEntries;

let receivers: ScrollReceiver[];
let captured: Transaction[];
let views: EditorView[] = [];
let mounted: MilkdownDomFixture[] = [];

const resolveSpy = vi.mocked(resolveHeadingElements);

interface Props {
  content: string;
  documentId: string | null;
}

interface RenderOptions {
  containerId?: string;
  viewMode?: ViewMode;
}

/** A real headless `EditorView`, registered where the hook reads it. */
function installEditorView(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc }),
    dispatch: (tr, self) => {
      captured.push(tr);
      self.update([tr]);
    },
  });
  views.push(view);
  useEditorStore.setState({ editorView: view });
  return view;
}

function renderTOC(initialProps: Props, options: RenderOptions = {}) {
  return renderHook(
    (props: Props) =>
      useTOC({
        content: props.content,
        documentId: props.documentId,
        containerId: options.containerId ?? SOURCE_CONTAINER_ID,
        viewMode: options.viewMode ?? "source",
        // Matches App.tsx:140 for source mode; see the file header.
        enableSpyScrolling: false,
      }),
    { initialProps },
  );
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function entries(): TOCEntry[] {
  return useTOCStore.getState().entries;
}

function activeEntryId(): HeadingKey | null {
  return useTOCStore.getState().activeEntryId;
}

/** H2 — the key-distinctness guard (§0.4). */
function expectDistinctKeys(list: readonly TOCEntry[], where: string): void {
  expect(
    new Set(list.map((e) => e.key)).size,
    `${where}: H2 — entry keys must be pairwise distinct`,
  ).toBe(list.length);
}

/** The scroll targets carried by one captured transaction. */
function scrollTargets(tr: Transaction): ScrollTargetLike[] {
  return tr.effects
    .filter((e: StateEffect<unknown>): e is StateEffect<ScrollTargetLike> =>
      e.is(SCROLL_EFFECT_TYPE),
    )
    .map((e) => e.value);
}

/** Exactly one scroll effect across all captured transactions, and its target. */
function soleScrollTarget(): ScrollTargetLike {
  const targets = captured.flatMap(scrollTargets);
  expect(targets).toHaveLength(1);
  return targets[0];
}

/**
 * Overwrite the store's entries with new `lineNumber`s, keeping the **store-minted**
 * keys. The parser is 1-indexed and cannot produce `0` or an out-of-range line, so the
 * guard cases inject them deliberately — stated here once rather than at each use.
 */
function overrideLineNumbers(next: (entry: TOCEntry, index: number) => number): TOCEntry[] {
  const updated = entries().map((entry, index) => ({
    ...entry,
    lineNumber: next(entry, index),
  }));
  act(() => {
    useTOCStore.setState({ entries: updated });
  });
  return updated;
}

function mountEmptySourceContainer(): HTMLElement {
  const el = document.createElement("div");
  el.id = SOURCE_CONTAINER_ID;
  document.body.appendChild(el);
  return el;
}

function resetStore() {
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

beforeEach(() => {
  vi.useFakeTimers();
  captured = [];
  views = [];
  mounted = [];
  receivers = captureScrollReceivers();
  resetStore();
  useEditorStore.setState({ editorView: null });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  for (const fixture of mounted) unmountMilkdownDom(fixture);
  mounted = [];
  document.getElementById(SOURCE_CONTAINER_ID)?.remove();
  useEditorStore.setState({ editorView: null });
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// §8 — scrollToHeading, source branch
// ---------------------------------------------------------------------------

/**
 * Six headings, the last of them on the document's final line (no trailing newline —
 * that is what puts heading 6 on `doc.lines`). S-1's "including the last line" clause
 * rests on it, and the case asserts the shape rather than trusting this comment.
 */
const SIX_HEADINGS = [
  "# One",
  "",
  "intro text",
  "",
  "## Two",
  "",
  "### Three",
  "",
  "# Four",
  "",
  "more body text",
  "",
  "## Five",
  "",
  "# Six",
].join("\n");

describe("§8 useTOC#scrollToHeading — source branch (WI-3.6.4, D4)", () => {
  it("S-1: line navigation for entries 1..N, including the entry on the final line", () => {
    mountEmptySourceContainer();
    const view = installEditorView(SIX_HEADINGS);
    const { result } = renderTOC({ content: SIX_HEADINGS, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(6);
    expectDistinctKeys(list, "S-1");
    expectEffectProbeWired();
    // Wrong-reason guards: the last entry really is on the last line (otherwise the
    // "including the last line" clause is untested), and every entry's line really is a
    // heading line in the *editor's* copy of the document — which is what makes the
    // independently computed expectation below meaningful rather than circular.
    expect(list[5].lineNumber).toBe(view.state.doc.lines);
    for (const entry of list) {
      expect(view.state.doc.line(entry.lineNumber).text).toMatch(/^#{1,6} /);
    }

    for (const [index, entry] of list.entries()) {
      captured = [];
      act(() => {
        result.current.navigateToEntry(entry.key);
      });

      // Level 2 — computed from the doc, never a literal.
      const expected = view.state.doc.line(entry.lineNumber).from;
      const target = soleScrollTarget();
      expect(target.range.from, `entry ${index}`).toBe(expected);
      expect(target.y).toBe("start");
      expect(target.yMargin).toBe(40);
      // Level 4 — the source branch must still set the active entry.
      expect(activeEntryId(), `entry ${index}`).toBe(entry.key);
    }

    // Negative invariant: source mode scrolls no Element, and never asks the resolver.
    expect(receivers).toHaveLength(0);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("S-2: duplicate headings land on distinct lines (PIN — green before D4)", () => {
    mountEmptySourceContainer();
    const content = "# Intro\n\n# Intro";
    const view = installEditorView(content);
    const { result } = renderTOC({ content, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "S-2");
    // Wrong-reason guard: the two headings are textually identical, so a text-keyed
    // lookup would collapse them — which is the bug this pin exists to notice.
    expect(list[0].text).toBe(list[1].text);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });
    const first = soleScrollTarget();
    captured = [];
    act(() => {
      result.current.navigateToEntry(list[1].key);
    });
    const second = soleScrollTarget();

    expect(first.range.from).toBe(view.state.doc.line(1).from);
    expect(second.range.from).toBe(view.state.doc.line(3).from);
    expect(first.range.from).not.toBe(second.range.from);
    expect(activeEntryId()).toBe(list[1].key);
    expect(receivers).toHaveLength(0);
  });

  it("S-3: GUARD — a lineNumber beyond doc.lines is clamped to the last line, no throw", () => {
    mountEmptySourceContainer();
    const content = "# A\n\n# B\n\n# C";
    const view = installEditorView(content);
    const { result } = renderTOC({ content, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "S-3");

    const lineCount = view.state.doc.lines;
    const OVERSHOOTS = [lineCount + 1, lineCount + 1000, Number.MAX_SAFE_INTEGER];
    const injected = overrideLineNumbers((_entry, index) => OVERSHOOTS[index]);
    expect(injected.map((e) => e.lineNumber)).toEqual(OVERSHOOTS);

    const lastLineFrom = view.state.doc.line(lineCount).from;
    for (const [index, entry] of injected.entries()) {
      captured = [];
      expect(() => {
        act(() => {
          result.current.navigateToEntry(entry.key);
        });
      }, `overshoot ${OVERSHOOTS[index]}`).not.toThrow();

      // The position is what separates "clamped" from "silently swallowed by the
      // try/catch": a throw-only assertion cannot tell the two apart.
      expect(soleScrollTarget().range.from, `overshoot ${OVERSHOOTS[index]}`).toBe(
        lastLineFrom,
      );
      expect(activeEntryId(), `overshoot ${OVERSHOOTS[index]}`).toBe(entry.key);
    }

    expect(receivers).toHaveLength(0);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("S-4(control): the resolver spy DOES fire on identical inputs in wysiwyg mode", () => {
    // Establishes that S-4's zero is a refusal by the source branch and not a dead spy.
    // Identical to S-4 in every input except `viewMode`.
    const fixture = mountMilkdownDom([{ level: 1, text: "Intro", id: "intro" }], {
      containerId: DEFAULT_CONTAINER_ID,
    });
    mounted.push(fixture);
    const content = "# Intro";
    installEditorView(content);
    const { result } = renderTOC(
      { content, documentId: "doc-a" },
      { containerId: DEFAULT_CONTAINER_ID, viewMode: "wysiwyg" },
    );
    tick(300);

    const list = entries();
    expect(list).toHaveLength(1);
    const injected = overrideLineNumbers(() => 0);

    act(() => {
      result.current.navigateToEntry(injected[0].key);
    });

    expect(resolveSpy).toHaveBeenCalled();
    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[0]]);
    expect(activeEntryId()).toBe(injected[0].key);
  });

  it("S-4: REGRESSION R4 / D4 — lineNumber 0 in source mode never reaches the resolver", () => {
    // Two non-production conditions, both deliberate and both stated in the header:
    // the injected `lineNumber: 0`, and `containerId: "milkdown-container"` under
    // `viewMode: "source"` — a pairing App.tsx:139 never makes.
    const fixture = mountMilkdownDom([{ level: 1, text: "Intro", id: "intro" }], {
      containerId: DEFAULT_CONTAINER_ID,
    });
    mounted.push(fixture);
    const querySpy = vi.spyOn(fixture.container, "querySelector");

    const content = "# Intro";
    installEditorView(content);
    const { result } = renderTOC(
      { content, documentId: "doc-a" },
      { containerId: DEFAULT_CONTAINER_ID, viewMode: "source" },
    );
    tick(300);

    const list = entries();
    expect(list).toHaveLength(1);
    expectDistinctKeys(list, "S-4");
    // Wrong-reason guards: the fall-through target really is reachable DOM whose text
    // matches the entry, so "nothing happened" is a refusal and not a trivial absence.
    expect(document.getElementById(DEFAULT_CONTAINER_ID)).toBe(fixture.container);
    expect(fixture.headings[0].textContent).toBe(list[0].text);

    const injected = overrideLineNumbers(() => 0);
    expect(injected[0].lineNumber).toBe(0);
    querySpy.mockClear();
    resolveSpy.mockClear();

    act(() => {
      result.current.navigateToEntry(injected[0].key);
    });

    // The resolver was never entered — the direct statement of D4's claim.
    expect(resolveSpy).not.toHaveBeenCalled();
    // Second, mock-free witness: `collectHeadingElements` opens with
    // `root.querySelector(".ProseMirror")` (tocElementResolution.ts:122), and the
    // container was never asked.
    expect(querySpy).not.toHaveBeenCalled();
    // And nothing moved, by either mechanism.
    expect(receivers).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(activeEntryId()).toBeNull();
  });

  it("S-5: GUARD — a null editorView is a no-op, not a fall-through and not a throw", () => {
    mountEmptySourceContainer();
    const content = "# A\n\n# B";
    const { result } = renderTOC({ content, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "S-5");
    // Wrong-reason guard: the branch is genuinely reached with no view installed.
    expect(useEditorStore.getState().editorView).toBeNull();

    expect(() => {
      act(() => {
        result.current.navigateToEntry(list[0].key);
      });
    }).not.toThrow();

    expect(captured).toHaveLength(0);
    expect(receivers).toHaveLength(0);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(activeEntryId()).toBeNull();
  });

  it("S-L1: LAW clamp monotonicity over 204 generated line numbers", () => {
    mountEmptySourceContainer();
    // 30 lines, one heading on line 1.
    const content = ["# Doc", ...Array.from({ length: 29 }, (_, i) => `body ${i}`)].join("\n");
    const view = installEditorView(content);
    expect(view.state.doc.lines).toBe(30);

    const { result } = renderTOC({ content, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(1);
    expectDistinctKeys(list, "S-L1");

    const rng = createLcg(DEFAULT_SEED);
    const inputs = [
      ...Array.from({ length: 200 }, () => 1 + (rng() % 60)),
      1,
      30,
      31,
      10_000,
    ];
    // Wrong-reason guard: the domain must straddle the clamp in both directions, or
    // monotonicity is satisfied by a function that ignores the clamp entirely.
    expect(inputs.some((l) => l < 30)).toBe(true);
    expect(inputs.some((l) => l > 30)).toBe(true);

    const lineCount = view.state.doc.lines;
    const positions = new Map<number, number>();

    for (const lineNumber of inputs) {
      const injected = overrideLineNumbers(() => lineNumber);
      captured = [];
      act(() => {
        result.current.navigateToEntry(injected[0].key);
      });

      const expected = view.state.doc.line(Math.min(lineNumber, lineCount)).from;
      const actual = soleScrollTarget().range.from;
      expect(actual, `L=${lineNumber} (seed=0x${DEFAULT_SEED.toString(16)})`).toBe(expected);
      positions.set(lineNumber, actual);
    }

    // Monotonicity over the sorted domain — the assertion that kills a wrap-around
    // clamp, an off-by-one clamp, and an unrebased offset lookup at once, where no
    // single example would.
    const sorted = [...positions.keys()].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(20);
    for (let i = 1; i < sorted.length; i++) {
      expect(
        positions.get(sorted[i])!,
        `pos(${sorted[i - 1]}) <= pos(${sorted[i]})`,
      ).toBeGreaterThanOrEqual(positions.get(sorted[i - 1])!);
    }
    // Saturation: everything at or beyond the last line shares one position.
    expect(positions.get(10_000)).toBe(view.state.doc.line(lineCount).from);
    expect(positions.get(31)).toBe(positions.get(10_000));

    expect(receivers).toHaveLength(0);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
