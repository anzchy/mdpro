/**
 * WI-2-FIX (ADR-0031 step 5a, review finding 1) — a stale `getPreferences`
 * result in the no-document branch must neither re-baseline the latch nor
 * call `setViewMode`.
 *
 * Stale means: the effect was cleaned up (deps changed or unmount) before the
 * read resolved, or the user chose a mode (a persisted change) while it was
 * pending.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke` (the stateful backend fake in
 * `tests/support/lastViewModeHarness.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { makePreferences } from "./support/preferenceFixtures";
import {
  answer,
  backend,
  commits,
  flush,
  lastViewModeWrites,
  mountHarness,
  resetCase,
  resolveRead,
  resolveReadWith,
  setMode,
  storeMode,
  teardownCase,
} from "./support/lastViewModeHarness";

const SETTLED = { loaded: true, launched: true, hasDoc: false } as const;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
});

afterEach(() => {
  teardownCase();
});

describe("useLastViewModePersistence — stale read is discarded (WI-2-FIX)", () => {
  it("SR-01 (i): a document becoming active while the read is pending keeps the document's mode, and the latch arms on it", async () => {
    resetCase(makePreferences({ lastViewMode: "wysiwyg", defaultViewMode: "wysiwyg" }));
    const h = mountHarness({ ...SETTLED });
    await flush();
    expect(backend.pending.length).toBe(1);

    // The document opens showing source; branch (b) settles on it.
    setMode("source");
    h.rerender({ ...SETTLED, hasDoc: true });
    await flush();
    const commitsBeforeResolve = commits.length;

    await resolveRead(0);

    expect(storeMode()).toBe("source");
    expect(commits.slice(commitsBeforeResolve).some(([m]) => m === "wysiwyg")).toBe(false);
    expect(lastViewModeWrites()).toEqual([]);

    // Armed on "source": a switch to wysiwyg is a real transition and writes.
    setMode("wysiwyg");
    await flush();
    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "wysiwyg" } }]);
  });

  it("SR-02 (ii): a user switch while the close-last-document re-read is pending wins over the older stored value", async () => {
    resetCase(makePreferences({ lastViewMode: "wysiwyg", defaultViewMode: "wysiwyg" }));
    const h = mountHarness({ ...SETTLED });
    await flush();
    await resolveRead();
    expect(storeMode()).toBe("wysiwyg");

    h.rerender({ ...SETTLED, hasDoc: true });
    await flush();
    const staleSnapshot = makePreferences({ lastViewMode: "wysiwyg", defaultViewMode: "wysiwyg" });
    h.rerender({ ...SETTLED, hasDoc: false });
    await flush();
    expect(backend.pending.length).toBe(2);

    setMode("source");
    await flush();
    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "source" } }]);

    await resolveReadWith(staleSnapshot);

    expect(storeMode()).toBe("source");
    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "source" } }]);
    expect(backend.disk.lastViewMode).toBe("source");
  });

  it("SR-03 (iii): unmount while the read is pending, then resolve: no setViewMode and no write", async () => {
    resetCase(makePreferences({ lastViewMode: "source", defaultViewMode: "wysiwyg" }));
    const h = mountHarness({ ...SETTLED });
    await flush();
    h.unmount();

    await resolveRead();

    expect(storeMode()).toBe("wysiwyg");
    expect(lastViewModeWrites()).toEqual([]);
  });

  it("SR-04 (iv) control: an unraced read still applies the stored mode without writing", async () => {
    resetCase(makePreferences({ lastViewMode: "source", defaultViewMode: "wysiwyg" }));
    mountHarness({ ...SETTLED });
    await flush();

    await resolveRead();

    expect(storeMode()).toBe("source");
    expect(lastViewModeWrites()).toEqual([]);
  });
});
