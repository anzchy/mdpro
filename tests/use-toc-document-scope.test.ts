/**
 * WI-3.5.4 — `src/hooks/useTOC.ts#useTOC`: the document id travels with the content
 * through the debounce, and the hook stops subscribing to the whole TOC store.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260918-214500.md` §"Unit: src/hooks/useTOC.ts",
 * cases U0-U7 (laws U-L1 pairing, U-L2 debounce quiescence).
 *
 * ---------------------------------------------------------------------------
 * What happened to U0 (the HEAD-shaped red receipt) — recorded, not dropped
 * ---------------------------------------------------------------------------
 * The matrix specifies U0 as a separate file (`tests/use-toc-reset-receipt.test.ts`)
 * keyed off `entry.id`, so the recorded red would read "the reset fired" rather than
 * "the type has no `key` field". **U0 is unwritable against this tree**, for exactly the
 * reason recorded for its sibling S0 in `tests/toc-store-coordination.test.ts`: WI-3.5.1
 * already deleted `TOCEntry.id` (pinned by case T2 in `tests/heading-identity-model.test.ts`),
 * so an `entry.id` receipt neither compiles under `pnpm typecheck:tests` nor observes
 * anything at runtime. The supersession table's U0 row is discharged by U1 below being
 * live: the successor exists, and the receipt it supersedes was never written.
 *
 * U1 is also **not** this work item's red. WI-3.5.3 landed the store fix and the
 * `documentId` pass-through, so U1 and U3 are green before WI-3.5.4 changes anything —
 * stated plainly rather than manufactured into a red. The genuine assertion-level red
 * for this work item is **U7**, which fails against the bare `useTOCStore()` destructure.
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - **Mock boundary: timers only** (§0.4). `parseHeadingsFromContent` is the real Lezer
 *   parser (it runs headlessly in jsdom — see `tests/toc-lezer-parser.test.ts`), the
 *   store and the matcher are real, and `enableSpyScrolling: false` is a real hook
 *   option, not a stub. Nothing owned by this feature is mocked.
 * - No new dependency (§0.3).
 * - **No literal key strings are ever asserted** (§0.5): the mint counter is store-owned
 *   and never reset, so every expectation is distinctness / membership / absence against
 *   keys the store itself produced.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTOC } from "../src/hooks/useTOC";
import { useTOCStore } from "../src/stores/tocStore";
import type { HeadingKey, ParsedTOCEntry } from "../src/types/toc";

/** The real action, captured once so the U5/U6 wrappers can delegate to it. */
const realSetEntries = useTOCStore.getState().setEntries;

interface Props {
  content: string;
  documentId: string | null;
}

/**
 * Render the hook under test. `enableSpyScrolling: false` keeps the IntersectionObserver
 * effect out of the way; it is a documented option on the hook, not a mock.
 */
function renderTOC(initialProps: Props) {
  return renderHook(
    (props: Props) =>
      useTOC({
        content: props.content,
        documentId: props.documentId,
        enableSpyScrolling: false,
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

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

describe("U1 — REGRESSION: collapse survives a keystroke in a paragraph", () => {
  it("keeps the collapsed key and the active entry across a non-heading edit", () => {
    const { rerender } = renderTOC({
      content: "# A\n\n## B\n\ntext",
      documentId: "doc-a",
    });
    tick(300);

    const entries = state().entries;
    expect(entries).toHaveLength(2);
    const kB = entries[1].key;
    // Wrong-reason guard: if the key were missing the collapse assertions below would
    // fail for a reason that has nothing to do with the reset.
    expect(typeof kB).toBe("string");
    expect((kB as string).length).toBeGreaterThan(0);

    act(() => {
      state().toggleCollapsed(kB);
      state().setActiveEntry(kB);
    });

    rerender({ content: "# A\n\n## B\n\ntextX", documentId: "doc-a" });
    tick(300);

    expect(state().collapsedIds.has(kB)).toBe(true);
    expect(state().activeEntryId).toBe(kB);
    expect(state().entries[1].key).toBe(kB);
    expect(state().entries[1].lineNumber).toBe(3);
  });
});

describe("U2 — LAW U-L1: a document switch cancels the in-flight parse", () => {
  it("never lets doc-b's pending parse land, and leaves doc-a intact", () => {
    const { rerender } = renderTOC({ content: "# A\n\n## B", documentId: "doc-a" });
    tick(300);

    const kB = state().entries[1].key;
    act(() => {
      state().toggleCollapsed(kB);
    });

    rerender({ content: "# X\n\n## Y", documentId: "doc-b" });
    tick(150);

    rerender({ content: "# A\n\n## B", documentId: "doc-a" });
    tick(300);

    expect(state().documentId).toBe("doc-a");
    expect(state().collapsedIds.has(kB)).toBe(true);
    expect(state().entries.map((e) => e.text)).toEqual(["A", "B"]);
    // The negative archive assertion is the only one that distinguishes "b landed and
    // then a landed again" from "b never landed at all".
    expect(state().byDocument.has("doc-b")).toBe(false);
  });
});

describe("U3 — LAW U-L1: identical content, different document", () => {
  it("re-runs the effect for byte-identical content under a new document id", () => {
    const { rerender } = renderTOC({ content: "# Intro", documentId: "doc-a" });
    tick(300);

    const kA = state().entries[0].key;
    act(() => {
      state().toggleCollapsed(kA);
    });

    rerender({ content: "# Intro", documentId: "doc-b" });
    tick(300);

    expect(state().documentId).toBe("doc-b");
    expect(state().collapsedIds.size).toBe(0);
    expect(state().entries).toHaveLength(1);
    expect(state().entries[0].key).not.toBe(kA);
    expect(state().byDocument.has("doc-a")).toBe(true);
  });

  it("handles the common case of two empty buffers without crashing", () => {
    const { rerender } = renderTOC({ content: "", documentId: "doc-a" });
    tick(300);
    expect(state().documentId).toBe("doc-a");

    rerender({ content: "", documentId: "doc-b" });
    tick(300);

    expect(state().documentId).toBe("doc-b");
    expect(state().entries).toHaveLength(0);
  });
});

describe("U4 — rename through the real parser", () => {
  it("moves the anchor slug and keeps the key and the collapse", () => {
    const { rerender } = renderTOC({ content: "## Intro", documentId: "doc-a" });
    tick(300);

    const k = state().entries[0].key;
    expect(state().entries[0].anchorSlug as string).toBe("intro");
    act(() => {
      state().toggleCollapsed(k);
    });

    rerender({ content: "## Introduction", documentId: "doc-a" });
    tick(300);

    expect(state().entries[0].key).toBe(k);
    expect(state().entries[0].text).toBe("Introduction");
    expect(state().entries[0].anchorSlug as string).toBe("introduction");
    expect(state().collapsedIds.has(k)).toBe(true);
  });
});

describe("U5 — LAW U-L2: one setEntries per quiescent window", () => {
  it("fires exactly once per burst, with the final content, for n in 1..8", () => {
    for (let n = 1; n <= 8; n += 1) {
      let calls = 0;
      useTOCStore.setState({
        entries: [],
        documentId: null,
        activeEntryId: null,
        collapsedIds: new Set<HeadingKey>(),
        byDocument: new Map(),
        setEntries: (entries, documentId) => {
          calls += 1;
          realSetEntries(entries, documentId);
        },
      });

      const suffix = (i: number) => "x".repeat(i);
      const { rerender, unmount } = renderTOC({
        content: `# A\n\n## B${suffix(0)}`,
        documentId: "doc-burst",
      });

      for (let i = 1; i < n; i += 1) {
        tick(50);
        rerender({ content: `# A\n\n## B${suffix(i)}`, documentId: "doc-burst" });
      }
      tick(300);

      // Primary, implementation-independent: only the final content is in the store.
      expect(state().entries.map((e) => e.text)).toEqual([
        "A",
        `B${suffix(n - 1)}`,
      ]);
      // Supplement: the debounce collapsed the burst into a single write.
      expect(calls).toBe(1);

      unmount();
    }
  });
});

describe("U6 — the hook supplies no key", () => {
  it("passes entries with neither a key nor children, and the store mints the key", () => {
    const captured: ParsedTOCEntry[][] = [];
    useTOCStore.setState({
      setEntries: (entries, documentId) => {
        captured.push(entries);
        realSetEntries(entries, documentId);
      },
    });

    renderTOC({ content: "# A\n\n## B", documentId: "doc-a" });
    tick(300);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toHaveLength(2);
    for (const entry of captured[0]) {
      // `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn` as the matrix wrote
      // it: `tsconfig.json` sets `lib: ES2020` and `Object.hasOwn` is ES2022, so the
      // matrix's spelling fails `pnpm typecheck:tests`. Same predicate, same expected
      // value — the entries come from an object literal, so the prototypes match.
      expect(Object.prototype.hasOwnProperty.call(entry, "key")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(entry, "children")).toBe(false);
    }
    for (const entry of state().entries) {
      expect(typeof entry.key).toBe("string");
      expect((entry.key as string).length).toBeGreaterThan(0);
    }
  });
});

describe("U7 — per-field subscription: a bookkeeping write does not re-render", () => {
  it("ignores a byDocument write and still re-renders for isVisible", () => {
    let renders = 0;
    renderHook(
      (props: Props) => {
        renders += 1;
        return useTOC({
          content: props.content,
          documentId: props.documentId,
          enableSpyScrolling: false,
        });
      },
      { initialProps: { content: "# A\n\n## B", documentId: "doc-a" } },
    );
    tick(300);

    const baseline = renders;

    act(() => {
      useTOCStore.setState({
        byDocument: new Map([
          ["zzz", { headings: [], collapsed: new Set<HeadingKey>(), active: null }],
        ]),
      });
    });
    expect(renders).toBe(baseline);

    // Control arm: a hook that never re-renders at all would pass the assertion above.
    act(() => {
      state().setVisibility(true);
    });
    expect(renders).toBeGreaterThan(baseline);
  });
});
