/**
 * Purpose: a boundary double for `IntersectionObserver`, which jsdom does not implement.
 * Contract specified by `.claude/tdd-guardian/tests-20260919-114230.md` §0.8.
 *
 * ---------------------------------------------------------------------------
 * The two collections are NOT interchangeable
 * ---------------------------------------------------------------------------
 *   | `observed`     | `Set<Element>` | the **live** set — `unobserve`/`disconnect` shrink it |
 *   | `observeCalls` | `Element[]`    | **append-only, ordered**; a double-`observe` appears twice |
 *
 * Order and multiplicity are asserted with `expect(d.observeCalls).toEqual([a, b])`;
 * live membership with `expect(d.observed).toEqual(new Set([a, b]))`. Revision 2 of the
 * matrix asserted `toEqual([a, b])` against the **Set** in three cases, which fails in
 * Vitest whatever the contents — red against HEAD *and* against a correct
 * implementation, i.e. exactly the shape that gets "fixed" by editing the expectation.
 *
 * ---------------------------------------------------------------------------
 * Fidelity, and the one place it is deliberately broken
 * ---------------------------------------------------------------------------
 * `intersect` **silently does nothing** for an element that was never observed or has
 * been unobserved, faithful to the real API and load-bearing for case R3b: against HEAD
 * the second duplicate heading is never observed, so no record can be delivered for it.
 *
 * `deliverUnchecked` bypasses that check and is used by exactly one case (C-3). It is
 * deliberately unfaithful — a disconnected observer does not fire in a browser. The
 * production trigger for the guard C-3 covers is a genuine browser race between a
 * queued record and an effect re-run, which **no double can reproduce**; C-3 is
 * therefore labelled defence in depth, not a reproduction of an observed failure.
 *
 * The logic under test — the element→key map, the visible-set bookkeeping and
 * `pickActiveKey` — stays real. **§13 obligation 1 is UNMET**: nothing automated proves
 * a real browser's IntersectionObserver delivers the records this double delivers, in
 * particular under the `rootMargin: "0px 0px -66% 0px"` geometry. Mitigated by WI-3.6.6
 * manual QA.
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
