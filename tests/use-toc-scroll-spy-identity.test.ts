/**
 * Purpose: WI-3.6.3 — the IntersectionObserver **callback** in `src/hooks/useTOC.ts`
 * (site 2). `visibleHeadings` becomes a `Set<HeadingKey>` fed by
 * `elementKeysRef.get(entry.target)`, and the inline "first visible" loop becomes
 * `pickActiveKey`. A target absent from the map is ignored — no throw, no state change.
 *
 * Matrix §7 of `.claude/tdd-guardian/tests-20260919-114230.md` (revision 3):
 * R3, R3b, C-2, C-3, C-4, C-5, C-L1. Sites 1 and 3 are WI-3.6.2 and live in
 * `tests/use-toc-navigation-identity.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * DECISION A — retention is the specification, not an accident
 * ---------------------------------------------------------------------------
 * HEAD deletes from the visible set on un-intersect and guards the active-entry write
 * with `if (visibleHeadings.size > 0)`, so **an emptied visible set RETAINS the last
 * `activeEntryId` rather than blanking it**. WI-3.6 changes *which* heading is
 * addressed, not blanking semantics: changing it would be a user-visible behaviour
 * change needing its own ledger row and changelog entry, and this work item has
 * neither. C-5 pins the retention and C-L1 clause (iii) re-checks it 240 times. If a
 * future work item wants blanking, it changes the acceptance criterion first and C-5
 * second — in that order, which is what makes it a spec change rather than a test edit.
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - **One mock: `IntersectionObserver`** (§0.8), because jsdom does not implement it.
 *   The element→key map, the visible-set bookkeeping and `pickActiveKey` are real, and
 *   `pickActiveKey` is additionally covered with no boundary at all in
 *   `tests/toc-element-resolution.test.ts`. **§13 obligation 1 is UNMET**: nothing
 *   automated proves a real browser delivers the records this double delivers, in
 *   particular under `rootMargin: "0px 0px -66% 0px"`. WI-3.6.6 manual QA mitigates it.
 * - `observed` is a `Set` and `observeCalls` an array; assertions match the type.
 * - No new dependency (§0.3); no `Object.hasOwn` (§0.4); no literal key string is ever
 *   asserted (§0.4); standing rule H2 on every generated/store-derived entry list.
 *
 * DOM ids in these fixtures are transcribed literals (§0.5) and are read by nothing —
 * see the header of `tests/helpers/milkdownHeadingDom.ts`.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTOC } from "../src/hooks/useTOC";
import { useTOCStore } from "../src/stores/tocStore";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import { CORPUS_ALPHABET, createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
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
}

let mounted: MilkdownDomFixture[] = [];
let double: IntersectionObserverDouble;

function mountDom(specs: ReadonlyArray<MilkdownHeadingSpec>): MilkdownDomFixture {
  const fixture = mountMilkdownDom(specs, { containerId: DEFAULT_CONTAINER_ID });
  mounted.push(fixture);
  return fixture;
}

function renderTOC(initialProps: Props) {
  return renderHook(
    (props: Props) =>
      useTOC({
        content: props.content,
        documentId: props.documentId,
        containerId: DEFAULT_CONTAINER_ID,
        viewMode: "wysiwyg",
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

beforeEach(() => {
  vi.useFakeTimers();
  mounted = [];
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
});

afterEach(() => {
  for (const fixture of mounted) unmountMilkdownDom(fixture);
  mounted = [];
  vi.useRealTimers();
});

const INTRO_TWICE: MilkdownHeadingSpec[] = [
  { level: 1, text: "Intro", id: "intro" }, // measured
  { level: 1, text: "Intro", id: "intro-#2" }, // measured
];
const INTRO_TWICE_CONTENT = "# Intro\n\n# Intro";

const THREE_DISTINCT: MilkdownHeadingSpec[] = [
  { level: 1, text: "Alpha", id: "alpha" }, // derived
  { level: 2, text: "Beta", id: "beta" }, // derived
  { level: 2, text: "Gamma", id: "gamma" }, // derived
];
const THREE_DISTINCT_CONTENT = "# Alpha\n\n## Beta\n\n## Gamma";

describe("§7 useTOC IntersectionObserver callback", () => {
  it("R3: REGRESSION — scroll-spy activates when the Milkdown id diverges from our slug", () => {
    // `hello,-world!` is MEASURED; our allocator produces `hello-world`.
    const fixture = mountDom([{ level: 1, text: "Hello, World!", id: "hello,-world!" }]);
    renderTOC({ content: "# Hello, World!", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(1);
    // Wrong-reason guard: the case must not pass by the two namespaces agreeing.
    expect(list[0].anchorSlug as string).not.toBe(fixture.headings[0].id);

    act(() => {
      double.intersect(fixture.headings[0], true);
    });

    expect(state().activeEntryId).toBe(list[0].key);
  });

  it("R3b: REGRESSION — intersecting only the second duplicate activates the second entry", () => {
    const fixture = mountDom(INTRO_TWICE);
    renderTOC({ content: INTRO_TWICE_CONTENT, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys(list, "R3b");

    act(() => {
      double.intersect(fixture.headings[1], true);
    });

    expect(state().activeEntryId).toBe(list[1].key);
    // "Activated something" is not "activated the right thing".
    expect(state().activeEntryId).not.toBe(list[0].key);
  });

  it("C-2: topmost wins, independent of the order records arrive in", () => {
    const fixture = mountDom([
      { level: 1, text: "One", id: "one" },
      { level: 2, text: "Two", id: "two" },
      { level: 2, text: "Three", id: "three" },
      { level: 3, text: "Four", id: "four" },
    ]);
    renderTOC({ content: "# One\n\n## Two\n\n## Three\n\n### Four", documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(4);
    expectDistinctKeys(list, "C-2");

    const orders: number[][] = [
      [2, 0],
      [0, 2],
      [2, 1, 0],
    ];
    for (const order of orders) {
      act(() => {
        double.intersectBatch(order.map((i) => [fixture.headings[i], true] as const));
      });
      expect(state().activeEntryId, `arrival order ${order.join(",")}`).toBe(list[0].key);
      expect(state().activeEntryId).not.toBe(list[2].key);
    }
  });

  it("C-3: GUARD — a target from a superseded pass changes nothing", () => {
    const first = mountDom(INTRO_TWICE);
    const { rerender } = renderTOC({
      content: INTRO_TWICE_CONTENT,
      documentId: "doc-a",
    });
    tick(300);

    act(() => {
      double.intersect(first.headings[1], true);
    });
    expect(state().activeEntryId).toBe(entries()[1].key);

    // Only a NEW `entries` array re-runs the effect (its deps contain no DOM), so the
    // content change is what makes this case real — replacing DOM children does not.
    const staleElement = first.headings[1];
    unmountMilkdownDom(first);
    mountDom([
      { level: 1, text: "Intro", id: "intro" },
      { level: 1, text: "Intro", id: "intro-#2" },
      { level: 1, text: "Third", id: "third" },
    ]);
    rerender({ content: "# Intro\n\n# Intro\n\n# Third", documentId: "doc-a" });
    tick(300);

    expect(entries()).toHaveLength(3);
    expect(document.contains(staleElement)).toBe(false);

    // Captured immediately before the delivery rather than assumed.
    const before = state().activeEntryId;
    const currentObserverIndex = double.instances.length - 1;
    expect(() => {
      act(() => {
        double.deliverUnchecked(currentObserverIndex, staleElement, true);
      });
    }).not.toThrow();

    expect(state().activeEntryId).toBe(before);
  });

  it("C-4: un-intersecting the topmost visible heading promotes the next one", () => {
    const fixture = mountDom(THREE_DISTINCT);
    renderTOC({ content: THREE_DISTINCT_CONTENT, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys(list, "C-4");

    act(() => {
      double.intersect(fixture.headings[0], true);
    });
    expect(state().activeEntryId).toBe(list[0].key);

    act(() => {
      double.intersect(fixture.headings[1], true);
    });
    expect(state().activeEntryId).toBe(list[0].key);

    act(() => {
      double.intersect(fixture.headings[0], false);
    });
    expect(state().activeEntryId).toBe(list[1].key);
  });

  it("C-5: an emptied visible set RETAINS the last active entry (DECISION A)", () => {
    const fixture = mountDom(THREE_DISTINCT);
    renderTOC({ content: THREE_DISTINCT_CONTENT, documentId: "doc-a" });
    tick(300);

    const list = entries();
    expectDistinctKeys(list, "C-5");

    act(() => {
      double.intersect(fixture.headings[0], true);
    });
    // Wrong-reason guard: "unchanged" must not be satisfied by "never set".
    expect(state().activeEntryId).toBe(list[0].key);

    act(() => {
      double.intersect(fixture.headings[0], false);
    });
    expect(state().activeEntryId).toBe(list[0].key);
  });

  it("C-L1: LAW conservation over a seeded 240-step intersect/unintersect sequence", () => {
    const SEED_LABEL = `seed=0x${DEFAULT_SEED.toString(16)}`;
    const rng = createLcg(DEFAULT_SEED);

    // Texts AND levels from the same stream. `generateCorpus` emits level-1 headings
    // only (§0.3 limit 1), so levels are drawn here rather than reusing its documents.
    let texts = Array.from(
      { length: 8 },
      () => CORPUS_ALPHABET[rng() % CORPUS_ALPHABET.length],
    );
    let levels = Array.from({ length: 8 }, () => (rng() % 6) + 1);

    const contentOf = (t: string[], l: number[]) =>
      t.map((text, i) => `${"#".repeat(l[i])} ${text}`).join("\n\n");
    const specsOf = (t: string[], l: number[]): MilkdownHeadingSpec[] =>
      // ids are deliberately arbitrary: nothing in the code under test reads one.
      t.map((text, i) => ({ level: l[i], text, id: `h-${i}` }));

    let fixture = mountDom(specsOf(texts, levels));
    const { rerender } = renderTOC({
      content: contentOf(texts, levels),
      documentId: "doc-a",
    });
    tick(300);

    let list = entries();
    expect(list, SEED_LABEL).toHaveLength(8);
    expectDistinctKeys(list, `C-L1 initial (${SEED_LABEL})`);
    let headings = fixture.headings;

    // Two elements that must never move the highlight.
    const detached = document.createElement("h1");
    detached.textContent = texts[0];
    const neverObserved = document.createElement("h1");
    neverObserved.textContent = texts[0];
    document.body.appendChild(neverObserved);

    /** The test's OWN visible set, by DOM index. Never read from the implementation. */
    let shadow = new Set<number>();
    let previousActive = state().activeEntryId;

    for (let step = 1; step <= 240; step++) {
      const label = `step ${step} (${SEED_LABEL})`;

      if (step === 80 || step === 160) {
        // A content change: one heading removed (the first), one added (at the end).
        texts = [...texts.slice(1), CORPUS_ALPHABET[rng() % CORPUS_ALPHABET.length]];
        levels = [...levels.slice(1), (rng() % 6) + 1];
        unmountMilkdownDom(fixture);
        fixture = mountDom(specsOf(texts, levels));
        rerender({ content: contentOf(texts, levels), documentId: "doc-a" });
        tick(300);

        list = entries();
        headings = fixture.headings;
        expect(list, label).toHaveLength(8);
        expectDistinctKeys(list, `C-L1 ${label}`);
        // The observe effect rebuilt over new elements and nothing re-delivered a
        // record, so nothing is intersecting and the element→entry mapping the shadow
        // set was using is stale. Clear it and re-anchor, exactly as C-3 does.
        shadow = new Set<number>();
        const active = state().activeEntryId;
        expect(
          active === null || list.some((e) => e.key === active),
          `${label}: clause (i) across the content change`,
        ).toBe(true);
        previousActive = active;
        continue;
      }

      const kind = rng() % 10;
      if (kind <= 4) {
        const i = rng() % headings.length;
        act(() => {
          double.intersect(headings[i], true);
        });
        shadow.add(i);
      } else if (kind <= 7) {
        const i = rng() % headings.length;
        act(() => {
          double.intersect(headings[i], false);
        });
        shadow.delete(i);
      } else if (kind === 8) {
        // The double is faithful here (§0.8): a record for an element the observer
        // never observed is not delivered at all, so these two step kinds assert that
        // the *absence* of a delivery leaves every clause standing. The path where a
        // record for an unmapped target does reach the callback is C-3's, and it needs
        // the `deliverUnchecked` escape hatch precisely because this one cannot.
        act(() => {
          double.intersect(detached, true);
        });
      } else {
        act(() => {
          double.intersect(neverObserved, true);
        });
      }

      const active = state().activeEntryId;
      // (i) conservation
      expect(
        active === null || list.some((e) => e.key === active),
        `${label}: clause (i) — activeEntryId must be a live key or null`,
      ).toBe(true);
      if (shadow.size > 0) {
        // (ii) order dominance, against the test's own set
        const first = Math.min(...shadow);
        expect(active, `${label}: clause (ii) — document-order-first visible`).toBe(
          list[first].key,
        );
      } else {
        // (iii) retention (DECISION A)
        expect(active, `${label}: clause (iii) — retention`).toBe(previousActive);
      }
      previousActive = active;
    }

    neverObserved.remove();
  });
});
