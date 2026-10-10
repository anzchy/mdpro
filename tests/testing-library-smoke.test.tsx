/**
 * WI-1.0 (plan P Stage 1, E7 / E28) — Testing Library smoke test.
 *
 * Proves the toolchain WI-0.0 installed works end to end for a `.tsx` file under `tests/`:
 * the JSX transform, `render`, ARIA queries, `userEvent.keyboard` and the jest-dom matchers.
 * It stays in the suite because the Stage 4 and 5 keyboard tests rely on this tooling.
 *
 * Timer pattern (E28) that later keyboard tests copy. The suite runs on real timers by
 * default; a timer-dependent keyboard test opts into fake timers for its own scope and:
 *   1. builds its user with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`
 *      — `delay: null` is not an acceptable workaround;
 *   2. awaits every interaction, and advances application debounce separately;
 *   3. unmounts before draining remaining timers, so a timer leaked past unmount fails
 *      the test instead of being hidden by teardown.
 *
 * Two measured facts (Vitest 3.2.4, user-event 14.6.7, RTL 16.3.3) shape this harness:
 *   - `vi.advanceTimersByTime` throws "Timers are not mocked" under real timers, and
 *     user-event calls `advanceTimers(0)` on every interaction, so `advanceTimers` is
 *     only usable inside a fake-timer scope.
 *   - Under fake timers every userEvent call deadlocks to the 5 s timeout: RTL's
 *     `asyncWrapper` schedules `setTimeout(resolve, 0)` and pumps it only when a `jest`
 *     global exists, which Vitest does not define. The `jest` stub below hands RTL a
 *     working pump (same shim as tests/settings-export-write-ordering.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("Testing Library smoke (WI-1.0)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("jest", {
      advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks a native checkbox when Space is pressed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(
      <label>
        <input type="checkbox" />
        Enable feature
      </label>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Enable feature" });
    expect(checkbox).not.toBeChecked();

    await user.tab();
    expect(checkbox).toHaveFocus();

    await user.keyboard(" ");
    expect(checkbox).toBeChecked();

    unmount();
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
});
