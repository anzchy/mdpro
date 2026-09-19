/**
 * Purpose: WI-3.6.2 — `src/hooks/useTOC.ts` addresses the WYSIWYG DOM through
 * `resolveHeadingElements`, at both of its sites: `scrollToHeading` (site 1) and the
 * IntersectionObserver **observe loop** (site 3). Plus the D7 mismatch-log dedupe ref.
 *
 * Matrix sections §5 (navigation: R1, N-L1, N-2, N-8, N-3, N-4, N-5, N-6, N-7),
 * §6 (observe effect: R2, O-1, O-2, O-L1) and §9 (mismatch log: L-1, L-L1) of
 * `.claude/tdd-guardian/tests-20260919-114230.md` (revision 3).
 * Site 2 — the observer *callback* — is WI-3.6.3 and lives in
 * `tests/use-toc-scroll-spy-identity.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - **Real everything except two platform gaps** (§0.7): the Lezer parser, the TOC
 *   store, the key matcher and the DOM are the real thing. jsdom implements neither
 *   `Element.prototype.scrollIntoView` (absent, not a no-op — §0.9) nor
 *   `IntersectionObserver` (§0.8), so both come from `tests/helpers/`. Those two mocks
 *   create **unmet integration obligations** (§13 obligations 1 and 2): no lane in this
 *   repo can run a real scroll or a real observer. WI-3.6.6 manual QA is the mitigation.
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
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import {
  appendDialogTitle,
  DEFAULT_CONTAINER_ID,
  mountMilkdownDom,
  unmountMilkdownDom,
} from "./helpers/milkdownHeadingDom";
import type { MilkdownDomFixture, MilkdownHeadingSpec } from "./helpers/milkdownHeadingDom";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import type { IntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { captureScrollReceivers } from "./helpers/scrollReceiver";
import type { ScrollReceiver } from "./helpers/scrollReceiver";

const realSetEntries = useTOCStore.getState().setEntries;

interface Props {
  content: string;
  documentId: string | null;
}

interface RenderOptions {
  enableSpyScrolling?: boolean;
}

let mounted: MilkdownDomFixture[] = [];
let double: IntersectionObserverDouble;
let receivers: ScrollReceiver[];
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
  double = installIntersectionObserverDouble();
  receivers = captureScrollReceivers();
  logSpy = vi.spyOn(loggingService, "logEventSync");
  resetStore();
});

afterEach(() => {
  for (const fixture of mounted) unmountMilkdownDom(fixture);
  mounted = [];
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// §5 — scrollToHeading, WYSIWYG branch
// ---------------------------------------------------------------------------

/** The R1 fixture: `# Intro` twice, with the **measured** Milkdown ids. */
const INTRO_TWICE: MilkdownHeadingSpec[] = [
  { level: 1, text: "Intro", id: "intro" }, // measured
  { level: 1, text: "Intro", id: "intro-#2" }, // measured
];
const INTRO_TWICE_CONTENT = "# Intro\n\n# Intro";

describe("§5 useTOC#scrollToHeading — WYSIWYG", () => {
  it("R1: REGRESSION — the n-th duplicate navigates to the n-th element", () => {
    const fixture = mountDom(INTRO_TWICE);
    const { result } = renderTOC({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "R1");
    // Wrong-reason guard: a jsdom without CSS.escape would make HEAD *throw* rather
    // than mis-resolve, and the red would be recorded for the wrong reason.
    expect(typeof CSS?.escape).toBe("function");

    act(() => {
      result.current.navigateToEntry(list[1].key);
    });

    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[1]]);
    expect(receivers[0].options).toEqual({ behavior: "smooth", block: "start" });
    expect(state().activeEntryId).toBe(list[1].key);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[1], fixture.headings[0]]);
    expect(state().activeEntryId).toBe(list[0].key);
  });

  it("N-L1: LAW injectivity through the hook — 5 identical headings, 5 distinct targets", () => {
    // ids: `intro` measured; `intro-#2` measured; `-#3`…`-#5` DERIVED by extending the
    // measured dedupe scheme.
    const fixture = mountDom([
      { level: 1, text: "Intro", id: "intro" },
      { level: 1, text: "Intro", id: "intro-#2" },
      { level: 1, text: "Intro", id: "intro-#3" },
      { level: 1, text: "Intro", id: "intro-#4" },
      { level: 1, text: "Intro", id: "intro-#5" },
    ]);
    const { result } = renderTOC({
      content: "# Intro\n\n# Intro\n\n# Intro\n\n# Intro\n\n# Intro",
      documentId: "doc-a",
    });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(5);
    expectDistinctKeys(list, "N-L1");

    for (const entry of list) {
      act(() => {
        result.current.navigateToEntry(entry.key);
      });
    }

    const els = receivers.map((r) => r.el);
    expect(new Set(els).size).toBe(5);
    // Order, not merely distinctness: a permutation satisfies distinctness alone.
    expect(els).toEqual(fixture.headings);
  });

  it("N-2: punctuation document — every entry navigates to its own element", () => {
    // `hello,-world!`, `q&a`, `foo_bar` measured; `api-reference-(v2)` and `🎉` DERIVED.
    const fixture = mountDom([
      { level: 1, text: "Hello, World!", id: "hello,-world!" },
      { level: 1, text: "Q&A", id: "q&a" },
      { level: 1, text: "foo_bar", id: "foo_bar" },
      { level: 1, text: "API Reference (v2)", id: "api-reference-(v2)" },
      { level: 1, text: "🎉", id: "🎉" },
    ]);
    const { result } = renderTOC({
      content: "# Hello, World!\n\n# Q&A\n\n# foo_bar\n\n# API Reference (v2)\n\n# 🎉",
      documentId: "doc-a",
    });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(5);
    expectDistinctKeys(list, "N-2");

    // Wrong-reason guard: the case must not pass by the two namespaces agreeing.
    const divergences = list.filter(
      (entry, i) => (entry.anchorSlug as string) !== fixture.headings[i].id,
    );
    expect(divergences.length).toBeGreaterThanOrEqual(4);

    for (const entry of list) {
      act(() => {
        result.current.navigateToEntry(entry.key);
      });
    }

    expect(receivers.map((r) => r.el)).toEqual(fixture.headings);
  });

  it("N-8(a): a heading's Milkdown id collides with a DIFFERENT entry's anchorSlug — foo_bar", () => {
    // `foo_bar` measured; `foo-bar` DERIVED (whitespace→hyphen) — §0.5's two added rows.
    const fixture = mountDom([
      { level: 1, text: "foo_bar", id: "foo_bar" },
      { level: 1, text: "foo bar", id: "foo-bar" },
    ]);
    const { result } = renderTOC({ content: "# foo_bar\n\n# foo bar", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "N-8(a)");
    // LOAD-BEARING wrong-reason guard: if Milkdown's id generator ever changes, the
    // collision disappears and this case must fail loudly rather than pass vacuously.
    expect(list[0].anchorSlug as string).toBe(fixture.headings[1].id);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[0]]);
    expect(double.observeCalls).toEqual(fixture.headings);
  });

  it("N-8(b): the same collision by the empty-base route — 🎉 / Heading (DERIVED)", () => {
    const fixture = mountDom([
      { level: 1, text: "🎉", id: "🎉" },
      { level: 1, text: "Heading", id: "heading" },
    ]);
    const { result } = renderTOC({ content: "# 🎉\n\n# Heading", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "N-8(b)");
    expect(list[0].anchorSlug as string).toBe(fixture.headings[1].id);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[0]]);
    expect(double.observeCalls).toEqual(fixture.headings);
  });

  it("N-3: modal hazard with .ProseMirror ABSENT — nothing resolves, nothing navigates", () => {
    const fixture = mountDom([], { withProseMirror: false });
    const modalTitle = appendDialogTitle(fixture, "Insert Link");

    const { result } = renderTOC({ content: "### Insert Link", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(1);
    // Wrong-reason guards: the modal heading really is inside the container, and its
    // text really does match the entry, so "no scroll" is not trivially true.
    expect(fixture.container.contains(modalTitle)).toBe(true);
    expect(modalTitle.textContent).toBe(list[0].text);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    expect(receivers).toHaveLength(0);
    expect(state().activeEntryId).toBeNull();
    expect(mismatchLogs()).toHaveLength(1);
  });

  it("N-4: modal hazard with .ProseMirror PRESENT — the <h1> wins and nothing is logged", () => {
    const fixture = mountDom([{ level: 1, text: "Doc", id: "doc" }]);
    const modalTitle = appendDialogTitle(fixture, "Insert Link");

    const { result } = renderTOC({ content: "# Doc", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(1);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[0]]);
    expect(receivers.map((r) => r.el)).not.toContain(modalTitle);
    // Counting container-wide headings for the mismatch signature while resolving
    // inside .ProseMirror would log on every pass whenever a modal is open.
    expect(mismatchLogs()).toHaveLength(0);
  });

  it("N-5: tier 3 — no .ProseMirror at all is a no-op, and the log fires exactly once", () => {
    mountDom([], { withProseMirror: false });

    const { result, rerender } = renderTOC({ content: "# A\n\n# B", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "N-5");

    act(() => {
      result.current.navigateToEntry(list[0].key);
      result.current.navigateToEntry(list[1].key);
    });
    rerender({ content: "# A\n\n# B", documentId: "doc-a" });
    act(() => {
      result.current.navigateToEntry(list[0].key);
      result.current.navigateToEntry(list[1].key);
    });

    expect(receivers).toHaveLength(0);
    expect(state().activeEntryId).toBeNull();

    const logs = mismatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("warn");
    expect(logs[0].status).toBe("fail");
    expect(logs[0].context).toEqual({
      documentId: "doc-a",
      entryCount: 2,
      domCount: 0,
      resolvedCount: 0,
    });
  });

  it("N-6: LAW idempotence of navigation — three navigations, one element, no DOM write", () => {
    const fixture = mountDom(INTRO_TWICE);
    const before = fixture.proseMirror?.innerHTML;

    const { result } = renderTOC({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expectDistinctKeys(list, "N-6");

    for (let i = 0; i < 3; i++) {
      act(() => {
        result.current.navigateToEntry(list[1].key);
      });
      expect(state().activeEntryId).toBe(list[1].key);
    }

    expect(receivers).toHaveLength(3);
    expect(new Set(receivers.map((r) => r.el)).size).toBe(1);
    expect(receivers[0].el).toBe(fixture.headings[1]);
    // D2 — nothing is written to the DOM.
    expect(fixture.proseMirror?.innerHTML).toBe(before);
  });

  it("N-7: partially resolved document — the unresolved entry is a no-op, resolution is fresh", () => {
    const fixture = mountDom([
      { level: 1, text: "Intro", id: "intro" }, // measured
      { level: 1, text: "Tail", id: "tail" }, // derived
    ]);
    // `enableSpyScrolling: false` — the observe effect returns early, so
    // `headingElementsRef` is never populated and navigation cannot read it.
    const { result } = renderTOC(
      { content: "# Intro\n\n# Intro\n\n# Tail", documentId: "doc-a" },
      { enableSpyScrolling: false },
    );
    tick(300);

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "N-7");
    // Wrong-reason guard: entry 1's text IS present in the DOM, so "no call" is a real
    // refusal rather than a trivial absence.
    expect(fixture.headings[0].textContent).toBe("Intro");
    expect(list[1].text).toBe("Intro");

    // Part A
    act(() => {
      result.current.navigateToEntry(list[0].key);
    });
    const activeAfterFirst = state().activeEntryId;
    act(() => {
      result.current.navigateToEntry(list[1].key);
    });
    expect(state().activeEntryId).toBe(activeAfterFirst);
    act(() => {
      result.current.navigateToEntry(list[2].key);
    });

    expect(receivers.map((r) => r.el)).toEqual([fixture.headings[0], fixture.headings[1]]);

    // Part B — identical markup, new element identities, no re-render.
    const originalFirst = fixture.headings[0];
    const clones = fixture.headings.map((h) => h.cloneNode(true) as HTMLElement);
    fixture.proseMirror!.replaceChildren(...clones);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    expect(receivers).toHaveLength(3);
    const last = receivers[2];
    expect(last.el).toBe(clones[0]);
    expect(last.el).not.toBe(originalFirst);
    expect(document.contains(last.el)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — the observe effect
// ---------------------------------------------------------------------------

describe("§6 useTOC observe effect", () => {
  it("R2: REGRESSION — two identical headings produce two distinct observed elements", () => {
    const fixture = mountDom(INTRO_TWICE);
    renderTOC({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "R2");

    expect(double.observeCalls).toEqual([fixture.headings[0], fixture.headings[1]]);
    expect(new Set(double.observeCalls).size).toBe(double.observeCalls.length);

    act(() => {
      double.intersect(fixture.headings[1], true);
    });
    expect(state().activeEntryId).toBe(list[1].key);
  });

  it("O-1: tier 1 — N distinct elements observed, in document order, for N ∈ {1,2,5,12}", () => {
    for (const n of [1, 2, 5, 12]) {
      const specs = Array.from({ length: n }, (_, i) => ({
        level: 1,
        text: `Section ${i}`,
        id: `section-${i}`, // derived
      }));
      const fixture = mountDom(specs);
      const content = specs.map((s) => `# ${s.text}`).join("\n\n");
      const { unmount } = renderTOC({ content, documentId: `doc-${n}` });
      tick(300);

      const list = entries();
      expect(list, `N=${n}`).toHaveLength(n);
      expectDistinctKeys(list, `O-1 N=${n}`);
      expect(double.observeCalls, `N=${n}`).toEqual(fixture.headings);

      unmount();
      unmountMilkdownDom(fixture);
      // The store outlives the hook; leaving one N's entries in place would let the
      // next render's mount-time effect resolve stale entries against the new DOM.
      act(() => {
        resetStore();
      });
    }
  });

  it("O-2: tier 2 — an unmatched DOM heading is never observed, and the mismatch is logged", () => {
    const fixture = mountDom([
      { level: 1, text: "A", id: "a" },
      { level: 2, text: "Extra", id: "extra" }, // the raw-HTML-heading shape
      { level: 1, text: "B", id: "b" },
    ]);
    renderTOC({ content: "# A\n\n# B", documentId: "doc-a" });
    tick(300);

    expect(entries()).toHaveLength(2);
    expect(double.observeCalls).toEqual([fixture.headings[0], fixture.headings[2]]);
    expect(double.observeCalls).not.toContain(fixture.headings[1]);

    const logs = mismatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({
      documentId: "doc-a",
      entryCount: 2,
      domCount: 3,
      resolvedCount: 2,
    });
  });

  it("O-L1: LAW idempotence of the observe effect, and disconnect on unmount", () => {
    const fixture = mountDom(INTRO_TWICE);
    const { rerender, unmount } = renderTOC({
      content: INTRO_TWICE_CONTENT,
      documentId: "doc-a",
    });
    tick(300);

    const list = entries();
    expectDistinctKeys(list, "O-L1");

    const rng = createLcg(DEFAULT_SEED);
    const SCHEDULE = [0, 50, 150, 300];
    const expectedObserved = new Set([fixture.headings[0], fixture.headings[1]]);

    for (let step = 0; step < 40; step++) {
      rerender({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
      const ms = SCHEDULE[rng() % SCHEDULE.length];
      if (ms > 0) tick(ms);
      // Five visibility toggles interleaved — a store write that re-renders the hook
      // but must not touch the observer.
      if (step % 8 === 3) {
        act(() => {
          state().setVisibility(step % 16 === 3);
        });
      }
      expect(double.observed, `step ${step} (seed=0x${DEFAULT_SEED.toString(16)})`).toEqual(
        expectedObserved,
      );
      expect(state().activeEntryId, `step ${step}`).toBeNull();
    }

    unmount();
    expect(double.disconnectCount).toBe(double.constructCount);
    expect(double.observed.size).toBe(0);
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
