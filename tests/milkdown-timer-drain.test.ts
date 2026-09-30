/**
 * The Milkdown ctx-timer drain (tests/helpers/milkdownTimerDrain.ts).
 *
 * `@milkdown/ctx` Timer.start schedules a `setTimeout(…, type.timeout)` that is never
 * cleared, even after the timer resolves, and its callback calls the bare global
 * `removeEventListener`. When a test file creates an editor in its last ~3 s, those
 * timeouts fire after jsdom is torn down and vitest reports
 * "ReferenceError: removeEventListener is not defined". The drain tracks exactly those
 * timeouts and `tests/setup.ts` cancels them in `afterAll`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Clock, createTimer } from "@milkdown/kit/ctx";
import {
  cancelPendingMilkdownTimeouts,
  pendingMilkdownTimeouts,
} from "./helpers/milkdownTimerDrain";

const others: Array<ReturnType<typeof setTimeout>> = [];

afterEach(() => {
  cancelPendingMilkdownTimeouts();
  for (const id of others.splice(0)) clearTimeout(id);
});

describe("milkdownTimerDrain", () => {
  it("tracks the timeout a resolved Milkdown timer leaves behind", async () => {
    cancelPendingMilkdownTimeouts();
    const clock = new Clock();
    const timer = createTimer("drain-probe-resolved").create(clock.store);
    const started = timer.start();
    timer.done();
    await started;
    expect(timer.status).toBe("resolved");
    expect(pendingMilkdownTimeouts()).toBe(1);
  });

  it("cancels every tracked timeout and reports how many it cancelled", () => {
    cancelPendingMilkdownTimeouts();
    const clock = new Clock();
    void createTimer("drain-probe-a").create(clock.store).start().catch(() => {});
    void createTimer("drain-probe-b").create(clock.store).start().catch(() => {});
    expect(pendingMilkdownTimeouts()).toBe(2);
    expect(cancelPendingMilkdownTimeouts()).toBe(2);
    expect(pendingMilkdownTimeouts()).toBe(0);
  });

  it("does not track unrelated timeouts", () => {
    cancelPendingMilkdownTimeouts();
    others.push(setTimeout(() => {}, 3000));
    expect(pendingMilkdownTimeouts()).toBe(0);
  });

  it("a timeout that fires on its own stops being tracked", async () => {
    cancelPendingMilkdownTimeouts();
    const clock = new Clock();
    const rejected = createTimer("drain-probe-short", 5).create(clock.store).start();
    await expect(rejected).rejects.toThrow("drain-probe-short");
    expect(pendingMilkdownTimeouts()).toBe(0);
  });
});
