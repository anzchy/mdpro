// @vitest-environment node
/**
 * D51 — `onFirstSuccess(fn)` is the latch that lets a multi-file open apply the
 * default view mode once, after the first file that actually opened.
 *
 * Law (S5, idempotence): however many times the latch is invoked, `fn` runs
 * exactly min(calls, 1) times, and it runs on the first invocation, not later.
 */
import { describe, expect, it } from "vitest";
import { onFirstSuccess } from "../src/utils/onFirstSuccess";

function counter() {
  const calls: number[] = [];
  return { calls, fn: () => calls.push(calls.length) };
}

describe("onFirstSuccess", () => {
  it("does not run fn when the latch is created", () => {
    const { calls, fn } = counter();
    onFirstSuccess(fn);
    expect(calls).toHaveLength(0);
  });

  it("runs fn on the first invocation", () => {
    const { calls, fn } = counter();
    const latch = onFirstSuccess(fn);
    latch();
    expect(calls).toHaveLength(1);
  });

  it("never runs fn again on later invocations", () => {
    const { calls, fn } = counter();
    const latch = onFirstSuccess(fn);
    latch();
    latch();
    latch();
    expect(calls).toHaveLength(1);
  });

  it("law: for 0..25 invocations fn runs exactly min(n, 1) times, at the first one", () => {
    for (let n = 0; n <= 25; n += 1) {
      const { calls, fn } = counter();
      const latch = onFirstSuccess(fn);
      const seenAfterEach: number[] = [];
      for (let i = 0; i < n; i += 1) {
        latch();
        seenAfterEach.push(calls.length);
      }
      expect(calls.length, `n=${n}`).toBe(Math.min(n, 1));
      // It fired on the first invocation, not a later one.
      expect(seenAfterEach, `n=${n}`).toEqual(Array.from({ length: n }, () => 1));
    }
  });

  it("separate latches are independent", () => {
    const a = counter();
    const b = counter();
    const latchA = onFirstSuccess(a.fn);
    const latchB = onFirstSuccess(b.fn);
    latchA();
    latchA();
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    latchB();
    expect(b.calls).toHaveLength(1);
    expect(a.calls).toHaveLength(1);
  });

  it("a latch whose fn throws has still fired: a retry does not re-run fn", () => {
    let runs = 0;
    const latch = onFirstSuccess(() => {
      runs += 1;
      throw new Error("boom");
    });
    expect(() => latch()).toThrow("boom");
    expect(() => latch()).not.toThrow();
    expect(runs).toBe(1);
  });
});
