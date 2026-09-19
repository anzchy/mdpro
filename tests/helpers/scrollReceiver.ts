/**
 * Purpose: capture which `Element` the code under test called `scrollIntoView` on, and
 * with what options. Specified verbatim by
 * `.claude/tdd-guardian/tests-20260919-114230.md` §0.9.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a one-line `vi.spyOn`
 * ---------------------------------------------------------------------------
 * **jsdom does not implement `Element.prototype.scrollIntoView` at all** — the property
 * is absent, not a no-op: `typeof Element.prototype.scrollIntoView` is `"undefined"` and
 * `"scrollIntoView" in Element.prototype` is `false`. `vi.spyOn` *throws* on an absent
 * method, so the stub must be installed with `Object.defineProperty` **before** the spy.
 * `tests/setup.ts` (15 lines) polyfills neither this nor `IntersectionObserver`.
 *
 * Three consequences, written down rather than glossed (§0.9):
 *
 *   1. Callers compare `receivers.map(r => r.el)` against an element array, never
 *      `receivers` itself — the records are `{ el, options }` pairs.
 *   2. **`restoreMocks: true` does not fully undo this.** `vitest.config.ts` sets it and
 *      it does remove the spy, but it restores the property to the *helper-installed
 *      stub*, not to the absent state. `Element.prototype.scrollIntoView` therefore
 *      stays defined for the rest of the run. Harmless here (a no-op stub on a prototype
 *      jsdom leaves empty), but a future test asserting the method is **absent** would
 *      be silently wrong. Matrix "Deferred" item 12.
 *   3. The options argument is captured, so `{behavior:"smooth", block:"start"}` is
 *      assertable rather than merely described in prose.
 *
 * Assertions read from the returned array, never from `spy.mock.instances` (populated
 * only for `new`-invocations — the wrong field) or `spy.mock.contexts`.
 *
 * **This is a platform boundary, and the obligation it creates is unmet** (§13
 * obligation 2): that the viewport actually moves is asserted nowhere automated in this
 * repo and cannot be. Mitigated by WI-3.6.6 manual QA.
 */
import { vi } from "vitest";

export interface ScrollReceiver {
  el: Element;
  options: unknown;
}

export function captureScrollReceivers(): ScrollReceiver[] {
  const receivers: ScrollReceiver[] = [];
  // jsdom does not implement scrollIntoView at all — `vi.spyOn` throws on an absent
  // method, so the stub must be defined *before* the spy is installed.
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
    options?: unknown,
  ) {
    receivers.push({ el: this, options });
  });
  return receivers;
}
