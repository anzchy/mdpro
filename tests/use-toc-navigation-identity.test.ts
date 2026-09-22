/**
 * Purpose: WI-3.6.2 — `src/hooks/useTOC.ts` addresses the WYSIWYG DOM through
 * `resolveHeadingElements`, at both of its sites: `scrollToHeading` (site 1) and the
 * scroll spy's **per-frame resolved list** (site 3; before D17 WI-4 this was the
 * IntersectionObserver observe loop). Plus the D7 mismatch-log dedupe ref.
 *
 * Matrix sections §6 (R2, O-1, O-2, O-L1) and §9 (mismatch log: L-1, L-L1) of
 * `.claude/tdd-guardian/tests-20260919-114230.md` (revision 3). §6 was migrated in D17
 * WI-4 (`.claude/tdd-guardian/tests-20260922-210708.md`): D17 disproved the IO-record
 * specification; DECISION A is superseded by ADR-0026, so §6 asserts the active key over
 * a `scriptedScrollGeometry` surface. §5 (site 1, navigation) moved in D17 WI-5 to
 * `tests/use-toc-navigation-identity-landing.test.ts` and
 * `tests/use-toc-navigation-identity-landing-guards.test.ts`, asserting landing
 * `scrollTop`. Which entry the spy activates is `tests/use-toc-scroll-spy-identity.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - **Real everything except the layout gap** (§0.7): the Lezer parser, the TOC store,
 *   the key matcher and the DOM are the real thing. jsdom has no layout, so §6 scripts
 *   layout, scroll writes and rAF (`scriptedScrollGeometry`); the WYSIWYG spy constructs
 *   no IntersectionObserver. No lane in this repo can run a real scroll (§13 obligation
 *   2); WI-3.6.6 manual QA is the mitigation.
 * - **No new dependency** (§0.3, gate G0). Generated domains come from the in-tree LCG.
 * - **No `Object.hasOwn`** (§0.4) — `lib: ["ES2020"]` rejects it (TS2550).
 * - **No literal key string is ever asserted** (§0.4): keys are minted by the store and
 *   every expectation is distinctness, membership, absence, or element identity.
 * - **Standing rule H2** (§0.4): every case whose entries come from the live store opens
 *   by asserting the keys are pairwise distinct. A duplicate key would make the
 *   injectivity claims pass vacuously — the maps would simply be smaller.
 *
 * ---------------------------------------------------------------------------
 * Reading of D7 this file pins, stated because the matrix admits two (§9)
 * ---------------------------------------------------------------------------
 * §9's law is arithmetic over the signature sequence: the emitted count equals the
 * number of indices `i` where `si` is a mismatch **and** `si ≠ s(i-1)`, with
 * `s0` = "nothing logged yet". The `si` sequence includes **matching** passes, whose
 * signature is `(n, n)` — otherwise the clause "`si` is a mismatch" would be redundant.
 * So the ref holds the signature of the **last pass**, not of the last *logged* pass,
 * and `match, A, match, A` emits twice rather than once. L-L1 computes its expectation
 * from that formula rather than from a literal. The document-switch step is driven as a
 * **remount**, because the property it exists to catch is that suppression is
 * per-hook-instance rather than module-scope; within one instance D7's signature is
 * `(entryCount, domCount)` and carries no document id.
 *
 * DOM-id provenance for every fixture below: matrix §0.5, and the header of
 * `tests/helpers/milkdownHeadingDom.ts`. Rows are labelled *measured* or *derived* at
 * their use site.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTOC } from "../src/hooks/useTOC";
import { useTOCStore } from "../src/stores/tocStore";
import { loggingService } from "../src/services/loggingService";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import { SPY_ANCHOR_OFFSET_PX } from "../src/utils/codemirrorViewportLine";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import {
  DEFAULT_CONTAINER_ID,
  mountMilkdownDom,
  unmountMilkdownDom,
} from "./helpers/milkdownHeadingDom";
import type { MilkdownDomFixture, MilkdownHeadingSpec } from "./helpers/milkdownHeadingDom";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import { contentOf, mountSurface, recordWrites, scrollHeadingTo } from "./helpers/wysiwygSpyHarness";

const realSetEntries = useTOCStore.getState().setEntries;

interface Props {
  content: string;
  documentId: string | null;
}

interface RenderOptions {
  enableSpyScrolling?: boolean;
}

let mounted: MilkdownDomFixture[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

function mountDom(
  specs: ReadonlyArray<MilkdownHeadingSpec>,
  options: { withProseMirror?: boolean } = {},
): MilkdownDomFixture {
  const fixture = mountMilkdownDom(specs, {
    containerId: DEFAULT_CONTAINER_ID,
    withProseMirror: options.withProseMirror ?? true,
  });
  mounted.push(fixture);
  return fixture;
}

function renderTOC(initialProps: Props, options: RenderOptions = {}) {
  return renderHook(
    (props: Props) =>
      useTOC({
        content: props.content,
        documentId: props.documentId,
        containerId: DEFAULT_CONTAINER_ID,
        viewMode: "wysiwyg",
        enableSpyScrolling: options.enableSpyScrolling ?? true,
      }),
    { initialProps },
  );
}

/** Advance fake timers inside `act` so React flushes the resulting store update. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function state() {
  return useTOCStore.getState();
}

function entries(): TOCEntry[] {
  return useTOCStore.getState().entries;
}

/** H2 — the key-distinctness guard (matrix §0.4). */
function expectDistinctKeys(list: readonly TOCEntry[], where: string): void {
  expect(
    new Set(list.map((e) => e.key)).size,
    `${where}: H2 — entry keys must be pairwise distinct`,
  ).toBe(list.length);
}

/** Every `ui.toc.resolve.mismatch` payload the hook emitted, in order. */
function mismatchLogs(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((payload) => payload.event === "ui.toc.resolve.mismatch");
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
  mounted = [];
  logSpy = vi.spyOn(loggingService, "logEventSync");
  resetStore();
});

afterEach(() => {
  for (const fixture of mounted) unmountMilkdownDom(fixture);
  mounted = [];
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// §5 — scrollToHeading, WYSIWYG branch: moved in D17 WI-5
// ---------------------------------------------------------------------------
// Migrated to landing-`scrollTop` assertions on `scriptedScrollGeometry` and moved to
// `tests/use-toc-navigation-identity-landing.test.ts` (R1, N-L1, N-2, N-8, N-4) and
// `tests/use-toc-navigation-identity-landing-guards.test.ts` (N-3, N-5, N-6, N-7).

const INTRO_TWICE_CONTENT = "# Intro\n\n# Intro";

// ---------------------------------------------------------------------------
// §6 — the spy's resolved list (migrated in D17 WI-4)
// ---------------------------------------------------------------------------
// D17 disproved the IO-record specification; DECISION A is superseded by ADR-0026. The
// frame's resolved list replaces the observe loop, so each case now scrolls a heading
// of a scripted surface to the anchor and asserts the active key.

describe("§6 useTOC WYSIWYG spy — the frame's resolved list", () => {
  const spyHeading = (level: 1 | 2, text: string): ScriptedHeading => ({
    level,
    text,
    height: 40,
    bodyHeight: 700,
  });
  const ANCHOR = SPY_ANCHOR_OFFSET_PX;

  function mountScripted(headings: ScriptedHeading[]) {
    const container = document.createElement("div");
    container.id = DEFAULT_CONTAINER_ID;
    document.body.appendChild(container);
    return { container, surface: mountSurface(container, { headings }) };
  }

  afterEach(() => {
    document.getElementById(DEFAULT_CONTAINER_ID)?.remove();
  });

  it("R2: REGRESSION — each of two identical headings is active at the anchor, two distinct keys", () => {
    const { surface } = mountScripted([spyHeading(1, "Intro"), spyHeading(1, "Intro")]);
    renderTOC({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
    tick(300);
    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "R2");

    scrollHeadingTo(surface, 1, ANCHOR);
    const second = state().activeEntryId;
    scrollHeadingTo(surface, 0, ANCHOR);
    const first = state().activeEntryId;
    expect([first, second]).toEqual([list[0].key, list[1].key]);
  });

  it("O-1: tier 1 — heading i at the anchor activates entries[i], for N ∈ {1,2,5,12}", () => {
    for (const n of [1, 2, 5, 12]) {
      const specs = Array.from({ length: n }, (_, i) => spyHeading(1, `Section ${i}`));
      const { container, surface } = mountScripted(specs);
      const { unmount } = renderTOC({ content: contentOf(specs), documentId: `doc-${n}` });
      tick(300);
      const list = entries();
      expect(list, `N=${n}`).toHaveLength(n);
      expectDistinctKeys(list, `O-1 N=${n}`);
      for (let i = n - 1; i >= 0; i--) {
        expect(surface.scrollTopForHeadingAt(i, ANCHOR), "fixture: reachable").toBeLessThanOrEqual(
          surface.maxScrollTop(),
        );
        scrollHeadingTo(surface, i, ANCHOR);
        expect(state().activeEntryId, `N=${n} i=${i}`).toBe(list[i].key);
      }
      unmount();
      container.remove();
      act(() => {
        resetStore();
      });
    }
  });

  it("O-2: tier 2 — an unmatched DOM heading at the anchor keeps heading A; the mismatch is logged", () => {
    const dom = [spyHeading(1, "A"), spyHeading(2, "Extra"), spyHeading(1, "B")];
    const { surface } = mountScripted(dom);
    renderTOC({ content: contentOf([dom[0], dom[2]]), documentId: "doc-a" });
    tick(300);
    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "O-2");

    scrollHeadingTo(surface, 2, ANCHOR);
    expect(state().activeEntryId, "positive guard").toBe(list[1].key);
    scrollHeadingTo(surface, 1, ANCHOR);
    expect(state().activeEntryId).toBe(list[0].key);

    const logs = mismatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({
      documentId: "doc-a",
      entryCount: 2,
      domCount: 3,
      resolvedCount: 2,
    });
  });

  it("O-L1: LAW 40 same-content rerenders keep the arm-time key (not null); unmount detaches", () => {
    const { container, surface } = mountScripted([spyHeading(1, "Intro"), spyHeading(1, "Intro")]);
    const add = vi.spyOn(container, "addEventListener");
    const remove = vi.spyOn(container, "removeEventListener");
    const { rerender, unmount } = renderTOC({
      content: INTRO_TWICE_CONTENT,
      documentId: "doc-a",
    });
    tick(300);
    const list = entries();
    expectDistinctKeys(list, "O-L1");

    const rng = createLcg(DEFAULT_SEED);
    const SCHEDULE = [0, 50, 150, 300];
    for (let step = 0; step < 40; step++) {
      rerender({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
      const ms = SCHEDULE[(rng() >>> 8) % SCHEDULE.length];
      if (ms > 0) tick(ms);
      if (step % 8 === 3) {
        act(() => {
          state().setVisibility(step % 16 === 3);
        });
      }
      expect(state().activeEntryId, `step ${step} (seed=0x${DEFAULT_SEED.toString(16)})`).toBe(
        list[0].key,
      );
    }

    unmount();
    const rec = recordWrites();
    scrollHeadingTo(surface, 1, ANCHOR);
    rec.stop();
    expect(rec.writes).toEqual([]);
    const scrollCalls = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === "scroll").length;
    expect(scrollCalls(add)).toBeGreaterThan(0);
    expect(scrollCalls(remove)).toBe(scrollCalls(add));
  });
});

// ---------------------------------------------------------------------------
// §9 — the D7 mismatch-log dedupe ref
// ---------------------------------------------------------------------------

interface LogStep {
  /** Heading texts in the source content — `entryCount` is its length. */
  headings: string[];
  /** DOM headings built inside `.ProseMirror` — `domCount` is its length. */
  dom: string[];
  /** A fresh hook instance (unmount + remount), with this document id. */
  remount?: string;
}

describe("§9 useTOC mismatch log (D7)", () => {
  it("L-1: payload shape", () => {
    mountDom([
      { level: 1, text: "A", id: "a" },
      { level: 2, text: "Extra", id: "extra" },
      { level: 1, text: "B", id: "b" },
    ]);
    renderTOC({ content: "# A\n\n# B", documentId: "doc-a" });
    tick(300);

    const logs = mismatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "warn",
      event: "ui.toc.resolve.mismatch",
      status: "fail",
    });
    expect(typeof logs[0].actionId).toBe("string");
    expect((logs[0].actionId as string).length).toBeGreaterThan(0);
    // Exact equality: an extra context field is a red.
    expect(logs[0].context).toEqual({
      documentId: "doc-a",
      entryCount: 2,
      domCount: 3,
      resolvedCount: 2,
    });
  });

  it("L-L1: LAW edge-triggered emission over a 16-step signature sequence", () => {
    // Signatures, in order: (1,1) match, A=(2,3)×3, B=(3,5), A, (2,2) match, A,
    // (2,2) match, A, C=(1,2)×2, D=(2,4)×2, then a REMOUNT with D again.
    const STEPS: LogStep[] = [
      { headings: ["S0"], dom: ["S0"] },
      { headings: ["S1", "S1b"], dom: ["S1", "S1b", "X"] },
      { headings: ["S2", "S2b"], dom: ["S2", "S2b", "X"] },
      { headings: ["S3", "S3b"], dom: ["S3", "S3b", "X"] },
      { headings: ["S4", "S4b", "S4c"], dom: ["S4", "S4b", "S4c", "X", "Y"] },
      { headings: ["S5", "S5b"], dom: ["S5", "S5b", "X"] },
      { headings: ["S6", "S6b"], dom: ["S6", "S6b"] },
      { headings: ["S7", "S7b"], dom: ["S7", "S7b", "X"] },
      { headings: ["S8", "S8b"], dom: ["S8", "S8b"] },
      { headings: ["S9", "S9b"], dom: ["S9", "S9b", "X"] },
      { headings: ["S10"], dom: ["S10", "X"] },
      { headings: ["S11"], dom: ["S11", "X"] },
      { headings: ["S12", "S12b"], dom: ["S12", "S12b", "X", "Y"] },
      { headings: ["S13", "S13b"], dom: ["S13", "S13b", "X", "Y"] },
      // A document switch between two IDENTICAL signatures, driven as a fresh hook
      // instance: the suppression ref must be per instance, never module-scope.
      { headings: ["S14", "S14b"], dom: ["S14", "S14b", "X", "Y"], remount: "doc-b" },
      { headings: ["S15", "S15b"], dom: ["S15", "S15b", "X", "Y"] },
    ];

    // The expectation is computed from the sequence, never written as a literal.
    const expected: Array<{ entryCount: number; domCount: number }> = [];
    let previous: string | null = null;
    for (const step of STEPS) {
      if (step.remount) previous = null;
      const entryCount = step.headings.length;
      const domCount = step.dom.length;
      const signature = `${entryCount}:${domCount}`;
      if (entryCount !== domCount && signature !== previous) {
        expected.push({ entryCount, domCount });
      }
      previous = signature;
    }
    expect(expected.length).toBeGreaterThan(1);

    let fixture = mountDom([]);
    let harness = renderTOC({ content: "", documentId: "doc-a" });
    let documentId = "doc-a";

    for (const [index, step] of STEPS.entries()) {
      // The container is removed BEFORE a remount on purpose: with no container the
      // new instance's mount-time effect returns early, so the step's pass is the
      // step's pass and not a mount artefact resolving the previous step's entries.
      unmountMilkdownDom(fixture);
      if (step.remount) {
        harness.unmount();
        documentId = step.remount;
        harness = renderTOC({ content: "", documentId });
      }
      fixture = mountDom(step.dom.map((text) => ({ level: 1, text })));
      harness.rerender({
        content: step.headings.map((text) => `# ${text}`).join("\n\n"),
        documentId,
      });
      tick(300);
      expect(entries(), `step ${index}`).toHaveLength(step.headings.length);
      expectDistinctKeys(entries(), `L-L1 step ${index}`);
    }

    const emitted = mismatchLogs().map((payload) => {
      const context = payload.context as { entryCount: number; domCount: number };
      return { entryCount: context.entryCount, domCount: context.domCount };
    });
    expect(emitted).toEqual(expected);
  });
});
