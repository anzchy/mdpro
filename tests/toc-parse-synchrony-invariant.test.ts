/**
 * Architectural invariant test for [ADR-0015](../docs/adr/0015-toc-staleness-is-closed-by-cancellation-not-a-revision-number.md).
 *
 * ---------------------------------------------------------------------------
 * Why this file exists, and why it passes today
 * ---------------------------------------------------------------------------
 * Plan M red line #3 requires that "异步结果必须携带文档 ID 与修订号". ADR-0015 discharges
 * it for the outline path by **cancellation** rather than by a revision number, on the
 * grounds that the hazard shape does not exist: parsing is synchronous, so no result can
 * ever be in flight across a change of inputs. That discharge is only honest for as long
 * as the premise holds.
 *
 * **This file is the thing that keeps the premise honest.** It is not a behaviour test —
 * nothing a user can do makes it fail. It asserts the two structural facts ADR-0015 leans
 * on, so that the commit which first breaks either of them turns this red and forces the
 * revision guard to be written in the same change.
 *
 * A deliberately-failing or `.skip`ped placeholder was considered and rejected (ADR-0015
 * § Decision): a red build gets disabled and a skipped test gets deleted, whereas a test
 * that has always been green is a test people believe. A grep/lint gate on `Worker` /
 * `await` / `invoke` was rejected too — any helper function evades it.
 *
 * ---------------------------------------------------------------------------
 * What this CANNOT see — stated so nobody mistakes green for full coverage
 * ---------------------------------------------------------------------------
 * ADR-0015's precondition has a second half: no deferral may be introduced between the
 * authoritative document and `useTOC`'s inputs (`useDeferredValue`, `startTransition`, a
 * second store read). **These assertions are blind to that.** Wrapping
 * `activeDocument?.content` in `useDeferredValue` at `App.tsx:137` breaks nothing here —
 * parsing stays synchronous and publication stays immediate — while producing exactly the
 * torn pair ADR-0015 names as its outliving failure condition. That half rests on the ADR
 * and on the comment at `useTOC.ts:110-114`, and this note is the only warning the test
 * suite gives about it.
 *
 * Mock boundary: timers only. The parser, the store and the hook are all real.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTOC } from "../src/hooks/useTOC";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { useTOCStore } from "../src/stores/tocStore";

const SAMPLE = "# Alpha\n\nbody text\n\n## Beta\n\nmore body\n\n### Gamma\n";

beforeEach(() => {
  vi.useFakeTimers();
  useTOCStore.setState({
    entries: [],
    documentId: null,
    activeEntryId: null,
    collapsedIds: new Set(),
    byDocument: new Map(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ADR-0015 premise 1 — the heading parser is synchronous", () => {
  it("returns a plain array, not a thenable", () => {
    const result = parseHeadingsFromContent(SAMPLE);

    // `Array.isArray` alone would not catch a Worker/IPC migration, because a
    // `Promise<Heading[]>` is not an array but nor is it obviously wrong at a glance.
    // The thenable check is the one that names the breaking change.
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toHaveProperty("then");
    expect(typeof (result as unknown as { then?: unknown }).then).toBe("undefined");

    // A parser that returned `[]` for everything would satisfy the shape checks above
    // while telling us nothing, so pin that it actually parsed.
    expect(result.map((h) => h.text)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("produces its result within a single synchronous call, with no timers pending", () => {
    // If parsing moved behind a `setTimeout`, a Worker `postMessage`, or an IPC `invoke`,
    // the call would return before the work finished and something would be scheduled.
    vi.clearAllTimers();
    const result = parseHeadingsFromContent(SAMPLE);

    expect(result).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ADR-0015 premise 2 — publication needs no microtask", () => {
  it("has written to the store by the time the debounce timer returns", () => {
    renderHook(() =>
      useTOC({ content: SAMPLE, documentId: "doc-sync", enableSpyScrolling: false }),
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Deliberately no `await`, no `flushPromises`, no `vi.runAllTicks()` between the
    // timer firing and this assertion. The moment anything in the publication path
    // yields — `await parse(...)`, `.then(setEntries)`, an IPC round-trip — the store
    // is still empty here and this fails, which is the whole point of the file.
    const state = useTOCStore.getState();
    expect(state.documentId).toBe("doc-sync");
    expect(state.entries.map((e) => e.text)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("leaves nothing scheduled after the parse lands, so no result can be in flight", () => {
    const { unmount } = renderHook(() =>
      useTOC({ content: SAMPLE, documentId: "doc-sync", enableSpyScrolling: false }),
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Cancellation can only be a complete answer to staleness if, once a parse has
    // landed, there is no second mechanism still holding a result. A pending timer or
    // queued continuation here would mean something can arrive after the inputs change
    // without the effect cleanup having had a chance to cancel it.
    expect(vi.getTimerCount()).toBe(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
