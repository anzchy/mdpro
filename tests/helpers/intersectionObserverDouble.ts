/**
 * Purpose: a boundary double for `IntersectionObserver`, which jsdom does not implement.
 * Contract specified by `.claude/tdd-guardian/tests-20260919-114230.md` §0.8.
 *
 * ---------------------------------------------------------------------------
 * What it serves now (D17 WI-4, ADR-0026)
 * ---------------------------------------------------------------------------
 * **No production code constructs an `IntersectionObserver` any more.** It was written
 * for the WYSIWYG scroll spy, which is now geometric (`src/hooks/useWysiwygScrollSpy.ts`
 * reads rects; `src/utils/tocGeometrySpy.ts`). The remaining users are tests only:
 *
 *   - `tests/use-toc-source-scroll-spy.test.ts` — as a **construction counter**:
 *     `constructCount` must stay 0 in every spy mode.
 *   - `tests/wysiwyg-edit-persistence.test.tsx`, `tests/wysiwyg-flush-sites.test.tsx`,
 *     `tests/d15-reopen-in-place.test.tsx`, `tests/d15-review-followups.test.tsx` —
 *     installed by habit from when the spy needed one. Harmless now; removing those
 *     calls is deferred cleanup (plan-20260922-210708, Deferred).
 *
 * Record delivery (`intersect`, `intersectBatch`, `deliverUnchecked`) and the
 * `observed` / `observeCalls` logs have no caller left. They are kept, not deleted, so a
 * future IO user starts from a double whose fidelity rules are already written down.
 * The D17 suites use their own geometric double (`geometricIntersectionObserver.ts`).
 *
 * ---------------------------------------------------------------------------
 * The two collections are NOT interchangeable
 * ---------------------------------------------------------------------------
 *   | `observed`     | `Set<Element>` | the **live** set — `unobserve`/`disconnect` shrink it |
 *   | `observeCalls` | `Element[]`    | **append-only, ordered**; a double-`observe` appears twice |
 *
 * Order and multiplicity are asserted with `expect(d.observeCalls).toEqual([a, b])`;
 * live membership with `expect(d.observed).toEqual(new Set([a, b]))` — `toEqual([a, b])`
 * against the **Set** fails in Vitest whatever the contents.
 *
 * ---------------------------------------------------------------------------
 * Fidelity, and the one place it is deliberately broken
 * ---------------------------------------------------------------------------
 * `intersect` **silently does nothing** for an element that was never observed or has
 * been unobserved, faithful to the real API. `deliverUnchecked` bypasses that check and
 * is deliberately unfaithful — a disconnected observer does not fire in a browser.
 *
 * **§13 obligation 1 no longer applies to the spy.** It recorded that nothing automated
 * proved a real browser's IntersectionObserver delivers the records this double
 * delivers under the spy's `rootMargin: "0px 0px -66% 0px"`. That observer and that
 * margin are gone (ADR-0026). The spy's own unproven boundary is now real layout, which
 * jsdom lacks; it is discharged by D17 WI-7 real-device QA, not by this file.
 */
import { vi } from "vitest";

interface DoubleRecord {
  target: Element;
  isIntersecting: boolean;
}

export class FakeIntersectionObserver {
  /** The live set. Shrinks on `unobserve` / `disconnect`. */
  readonly observed = new Set<Element>();
  /** Append-only and ordered; never shrinks. */
  readonly observeCalls: Element[] = [];
  disconnected = false;

  constructor(
    readonly callback: (records: DoubleRecord[], observer: FakeIntersectionObserver) => void,
    readonly options?: IntersectionObserverInit,
  ) {
    registry.push(this);
  }

  observe(element: Element): void {
    this.observeCalls.push(element);
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
    disconnectCalls += 1;
  }

  takeRecords(): DoubleRecord[] {
    return [];
  }
}

let registry: FakeIntersectionObserver[] = [];
let disconnectCalls = 0;

export interface IntersectionObserverDouble {
  /** Every instance constructed since installation, in construction order. */
  readonly instances: readonly FakeIntersectionObserver[];
  readonly constructCount: number;
  /** Total `disconnect()` calls across all instances. */
  readonly disconnectCount: number;
  /** The **most recently constructed** instance's live observed set. */
  readonly observed: Set<Element>;
  /** The **most recently constructed** instance's ordered observe log. */
  readonly observeCalls: Element[];
  /** Deliver one record to the current observer. A no-op if it is not observing `el`. */
  intersect(element: Element, isIntersecting: boolean): void;
  /** Deliver several records in **one** callback invocation — arrival order preserved. */
  intersectBatch(records: ReadonlyArray<readonly [Element, boolean]>): void;
  /** C-3 only: deliver to `instances[observerIndex]` with no observed-set check. */
  deliverUnchecked(observerIndex: number, element: Element, isIntersecting: boolean): void;
}

const EMPTY_SET: Set<Element> = new Set();

/**
 * Install the double on `globalThis` via `vi.stubGlobal`, so `unstubGlobals: true`
 * (`vitest.config.ts`) removes it between tests, and reset the registry.
 */
export function installIntersectionObserverDouble(): IntersectionObserverDouble {
  registry = [];
  disconnectCalls = 0;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

  const current = (): FakeIntersectionObserver | null =>
    registry.length === 0 ? null : registry[registry.length - 1];

  return {
    get instances() {
      return registry;
    },
    get constructCount() {
      return registry.length;
    },
    get disconnectCount() {
      return disconnectCalls;
    },
    get observed() {
      return current()?.observed ?? EMPTY_SET;
    },
    get observeCalls() {
      return current()?.observeCalls ?? [];
    },
    intersect(element, isIntersecting) {
      this.intersectBatch([[element, isIntersecting]]);
    },
    intersectBatch(records) {
      const observer = current();
      if (!observer || observer.disconnected) return;
      const live = records.filter(([element]) => observer.observed.has(element));
      if (live.length === 0) return;
      observer.callback(
        live.map(([target, isIntersecting]) => ({ target, isIntersecting })),
        observer,
      );
    },
    deliverUnchecked(observerIndex, element, isIntersecting) {
      const observer = registry[observerIndex];
      if (!observer) {
        throw new Error(
          `deliverUnchecked: no observer at index ${observerIndex} (have ${registry.length})`,
        );
      }
      observer.callback([{ target: element, isIntersecting }], observer);
    },
  };
}
