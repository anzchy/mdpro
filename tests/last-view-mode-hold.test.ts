/**
 * WI-2 (ADR-0031 step 5a, Amendment A1) — `lastViewMode` is held through
 * startup: read before any write can replace it.
 *
 * Cases LVH-01 … LVH-08 of `.claude/tdd-guardian/tests-20260926-221500.md`
 * (revision 3). LVH-09 lives in `last-view-mode-commit-order.test.ts`; both
 * share `tests/support/lastViewModeHarness.ts`.
 *
 * **Laws.**
 * - (Ordering, A1) Before the read path has settled, no `set_preferences` call
 *   carries `lastViewMode`, for every interleaving of `preferencesLoaded`,
 *   `launchPathsComplete` and a startup `setViewMode(defaultViewMode)`.
 * - (Idempotence) After settling, each distinct transition writes once, and
 *   re-applying the current mode writes nothing.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke` (a stateful backend fake).
 * The hook, the latch, `preferencesService`, `loggingService` and the stores
 * are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import type { ViewMode } from "../src/types/editor";
import type { UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";
import {
  answer,
  backend,
  callsFor,
  flush,
  lastViewModeWrites,
  mountHarness,
  resetCase,
  resolveRead,
  setMode,
  storeMode,
  teardownCase,
} from "./support/lastViewModeHarness";

const MODES: ViewMode[] = ["wysiwyg", "source"];
const SETTLED = { loaded: true, launched: true, hasDoc: false } as const;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
  resetCase(makePreferences({ lastViewMode: "source", defaultViewMode: "wysiwyg" }));
});

afterEach(() => {
  teardownCase();
});

/** Mount already loaded and launched with no document, then settle via the read. */
async function mountSettled() {
  const h = mountHarness({ ...SETTLED });
  await flush();
  await resolveRead();
  return h;
}

describe("useLastViewModePersistence — startup hold (WI-2)", () => {
  it("LVH-01: loaded → startup setViewMode → launched with the read pending writes no lastViewMode (REGRESSION RED)", async () => {
    const h = mountHarness({ loaded: false, launched: false, hasDoc: false });
    h.rerender({ loaded: true, launched: false, hasDoc: false });
    setMode("wysiwyg");
    h.rerender({ loaded: true, launched: true, hasDoc: false });
    await flush();

    expect(lastViewModeWrites()).toEqual([]);
    expect(backend.disk.lastViewMode).toBe("source");
    expect(callsFor("get_preferences").length).toBe(1);
  });

  it("LVH-02: the hold holds for every legal startup interleaving (12 runs)", async () => {
    for (const d of MODES) {
      for (const pos of [0, 1, 2]) {
        for (const stored of MODES) {
          const run = `d=${d} pos=${pos} stored=${stored}`;
          resetCase(makePreferences({ lastViewMode: stored, defaultViewMode: "wysiwyg" }));
          const h = mountHarness({ loaded: false, launched: false, hasDoc: false });
          if (pos === 0) setMode(d);
          h.rerender({ loaded: true, launched: false, hasDoc: false });
          if (pos === 1) setMode(d);
          h.rerender({ loaded: true, launched: true, hasDoc: false });
          if (pos === 2) setMode(d);
          await flush();
          await resolveRead();

          expect(lastViewModeWrites(), `${run}: writes`).toEqual([]);
          expect(storeMode(), `${run}: the read wins`).toBe(stored);
          expect(backend.disk.lastViewMode, `${run}: disk`).toBe(stored);
          h.unmount();
        }
      }
    }
  });

  it.each<[string, Record<string, unknown>, ViewMode, ViewMode]>([
    ["(a) stored value", { lastViewMode: "source", defaultViewMode: "wysiwyg" }, "wysiwyg", "source"],
    ["(b) stored value", { lastViewMode: "wysiwyg", defaultViewMode: "source" }, "source", "wysiwyg"],
    ["(c) ?? fallback", { lastViewMode: undefined, defaultViewMode: "source" }, "wysiwyg", "source"],
    ["(d) legacy migration", { lastViewMode: "editor-only" }, "wysiwyg", "source"],
  ])(
    "LVH-03 %s: the read applies the stored value without writing it back",
    async (_row, disk, start, expected) => {
      const prefs = makePreferences(disk as Partial<UserPreferences>);
      if (!("lastViewMode" in disk) || disk.lastViewMode === undefined) {
        delete (prefs as Partial<UserPreferences>).lastViewMode;
      }
      resetCase(prefs);
      setMode(start); // the store's start value for this row
      await mountSettled();

      expect(storeMode()).toBe(expected);
      expect(lastViewModeWrites()).toEqual([]);
    },
  );

  it("LVH-04: after settle, each distinct transition writes once and repeating the mode writes nothing", async () => {
    await mountSettled();
    expect(storeMode()).toBe("source");

    for (const m of ["wysiwyg", "wysiwyg", "source", "source", "wysiwyg"] as ViewMode[]) {
      setMode(m);
      await flush();
    }

    expect(lastViewModeWrites()).toEqual([
      { preferences: { lastViewMode: "wysiwyg" } },
      { preferences: { lastViewMode: "source" } },
      { preferences: { lastViewMode: "wysiwyg" } },
    ]);
    expect(backend.disk.lastViewMode).toBe("wysiwyg");
  });

  it("LVH-05: case (b): a document active at launch-complete means no read and no write; a later change writes once", async () => {
    mountHarness({ loaded: true, launched: true, hasDoc: true });
    await flush();
    setMode("wysiwyg");
    await flush();

    expect(callsFor("get_preferences").length).toBe(0);
    expect(lastViewModeWrites()).toEqual([]);

    setMode("source");
    await flush();

    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "source" } }]);
  });

  it("LVH-06: case (c): the read rejects, the store is unchanged and nothing is written; a later change writes once", async () => {
    backend.readError = new Error("ParseError");
    mountHarness({ ...SETTLED });
    await flush();

    expect(storeMode()).toBe("wysiwyg");
    expect(lastViewModeWrites()).toEqual([]);

    setMode("source");
    await flush();

    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "source" } }]);
  });

  it("LVH-07: unmount while holding, then a late read resolution, produces no write", async () => {
    const h = mountHarness({ ...SETTLED });
    setMode("source");
    h.unmount();
    await resolveRead();
    await flush();

    expect(lastViewModeWrites()).toEqual([]);
  });

  it("LVH-08: closing the last document after settle re-reads and re-applies the stored value without writing", async () => {
    const h = await mountSettled();
    expect(storeMode()).toBe("source");

    h.rerender({ ...SETTLED, hasDoc: true });
    await flush();
    backend.disk.lastViewMode = "wysiwyg"; // another window's write
    h.rerender({ ...SETTLED, hasDoc: false });
    await flush();
    await resolveRead(1);

    expect(callsFor("get_preferences").length).toBe(2);
    expect(storeMode()).toBe("wysiwyg");
    expect(lastViewModeWrites()).toEqual([]);
  });
});
