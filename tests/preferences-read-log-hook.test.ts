/**
 * D24 WI-4 — PRL-05: `useLastViewModePersistence` labels its preference read by
 * latch phase. Matrix `.claude/tdd-guardian/tests-20261007-171405.md` PRL-05
 * (relabelled S2 by F-7: three fixed scenarios).
 *
 * This is the "two reads" finding (plan Risks, O-2) made executable: a window
 * that settles with NO document reads once more for `view_mode_startup_settle`
 * on top of App's `app_hydrate`; a window with a document active at launch
 * makes no hook read; closing the last document reads for
 * `view_mode_restore_on_close`.
 *
 * jsdom (default environment, ADR-0049): the case renders the hook through
 * `renderHook` in `tests/support/lastViewModeHarness.ts`, which needs a DOM.
 *
 * Mocked: only `@tauri-apps/api/core#invoke`, routed to the harness's stateful
 * backend fake. Hook, latch, `preferencesService`, `loggingService` and stores
 * are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { makePreferences } from "./support/preferenceFixtures";
import {
  answer,
  backend,
  callsFor,
  flush,
  mountHarness,
  resetCase,
  resolveRead,
  teardownCase,
} from "./support/lastViewModeHarness";

/** The ordered `purpose` of every `preferences.read` log entry since the last reset. */
function readPurposes(): unknown[] {
  return backend.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: { event: string; context?: Record<string, unknown> } }).payload)
    .filter((p) => p.event === "preferences.read")
    .map((p) => p.context?.purpose);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
  resetCase(makePreferences({ lastViewMode: "source", defaultViewMode: "wysiwyg" }));
});

afterEach(() => {
  teardownCase();
});

describe("PRL-05: the hook's read purposes follow the latch phase", () => {
  it("(a) no document at startup: exactly one view_mode_startup_settle read", async () => {
    mountHarness({ loaded: true, launched: true, hasDoc: false });
    await flush();
    await resolveRead();

    expect(readPurposes()).toEqual(["view_mode_startup_settle"]);
    expect(callsFor("get_preferences").length).toBe(1);
  });

  it("(b) document active at launch: zero reads; (c) closing the last document: one view_mode_restore_on_close read", async () => {
    const h = mountHarness({ loaded: true, launched: true, hasDoc: true });
    await flush();

    expect(readPurposes()).toEqual([]);
    expect(callsFor("get_preferences").length).toBe(0);

    h.rerender({ loaded: true, launched: true, hasDoc: false });
    await flush();
    await resolveRead();

    expect(readPurposes()).toEqual(["view_mode_restore_on_close"]);
    expect(callsFor("get_preferences").length).toBe(1);
  });

  // (d) fixture M-6.1, the "one" case of `?open=`: the document arrives while
  // the startup read is still in flight, so no second read is made.
  it("(d) document arrives while the startup read is pending: still exactly one view_mode_startup_settle read", async () => {
    const h = mountHarness({ loaded: true, launched: true, hasDoc: false });
    await flush();

    h.rerender({ loaded: true, launched: true, hasDoc: true });
    await flush();
    await resolveRead();

    expect(readPurposes()).toEqual(["view_mode_startup_settle"]);
    expect(callsFor("get_preferences").length).toBe(1);
  });
});
