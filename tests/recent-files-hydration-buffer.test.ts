/**
 * WI-5 (ADR-0031 step 5a, finding F1) — `useRecentFiles` buffers updates until
 * preference hydration.
 *
 * Cases RH-01 … RH-10 of `.claude/tdd-guardian/tests-20260926-221500.md`.
 * Amendment A2 governs the failure path: no write without a known stored
 * baseline.
 *
 * **Laws.**
 * - (Hydration conservation) At hydration, in-memory state and any write equal
 *   `mergePending(stored, buffer)`.
 * - (At-most-one) Hydration writes at most once, never when the buffer is empty.
 * - (Hydrate-once) A second hydrate writes nothing and drops nothing.
 * - (Stable API) hydrate / update / fail keep their identity across renders.
 * - (Latest-list conservation) Each post-hydration update composes from the
 *   latest list, re-rendered or not.
 * - (No-baseline-no-write, A2) Hydration failure writes nothing.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke` (a recording `vi.fn`).
 * `preferencesService`, `loggingService`, `useLoggingStore`, the hook and the
 * pure util are real. `__TAURI__` is stubbed so `setPreferences` reaches
 * `invoke`; `isTauriEnv` itself is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, type RenderHookResult } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { pushRecent } from "../src/utils/recentFiles";
import { useLoggingStore } from "../src/stores/loggingStore";
import { BASE_PREFERENCES } from "./support/preferenceFixtures";

type HookResult = RenderHookResult<ReturnType<typeof useRecentFiles>, unknown>["result"];

/** The one line that binds the placeholder API names to the hook. */
function api(result: HookResult) {
  const r = result.current;
  return {
    recentFiles: r.recentFiles,
    update: r.updateRecentFiles,
    hydrate: r.hydrateRecentFiles,
    fail: r.failRecentFilesHydration,
  };
}

function writes() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "set_preferences")
    .map(([, payload]) => payload);
}

function bufferLogs() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: Record<string, unknown> }).payload)
    .filter((p) => p.event === "preferences.recent_files.buffer");
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = BASE_PREFERENCES.recentFiles;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  (globalThis as unknown as Record<string, unknown>).__TAURI__ = {};
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI__;
});

describe("useRecentFiles — pre-hydration buffer (WI-5)", () => {
  it("RH-01 pre-hydration updates write nothing", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).update("/b.md"));
    act(() => api(result).update("/a.md"));
    await flush();
    expect(writes()).toEqual([]);
  });

  it("RH-02 hydration after buffered updates writes exactly one merged list, equal to state", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).update("/b.md"));
    act(() => api(result).hydrate(BASE));
    await flush();
    const merged = ["/b.md", "/a.md", "/base/one.md", "/base/two.md"];
    expect(writes()).toEqual([{ preferences: { recentFiles: merged } }]);
    expect(api(result).recentFiles).toEqual(merged);
  });

  it("RH-03 hydration with an empty buffer writes nothing and state equals stored", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(["/s1.md", "/s2.md"]));
    await flush();
    expect(writes()).toEqual([]);
    expect(api(result).recentFiles).toEqual(["/s1.md", "/s2.md"]);
  });

  it("RH-04 hydration failure keeps the buffer in memory, writes nothing, logs the count only", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).update("/b.md"));
    act(() => api(result).fail());
    await flush();
    expect(writes()).toEqual([]);
    expect(api(result).recentFiles).toEqual(["/b.md", "/a.md"]);
    const logs = bufferLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({
      outcome: "kept_in_memory",
      reason: "hydration_failed",
      count: 2,
    });
  });

  it("RH-05 failure signalled after a successful hydrate is a no-op", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).fail());
    await flush();
    expect(writes()).toEqual([{ preferences: { recentFiles: ["/a.md", "/s1.md"] } }]);
    expect(api(result).recentFiles).toEqual(["/a.md", "/s1.md"]);
    expect(bufferLogs()).toEqual([]);
  });

  it("RH-06 post-hydration updates behave exactly as today; the buffer is not replayed", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/c.md"));
    act(() => api(result).update("/a.md"));
    act(() => api(result).update(""));
    await flush();
    expect(writes()).toEqual([
      { preferences: { recentFiles: ["/a.md", "/s1.md"] } },
      { preferences: { recentFiles: ["/c.md", "/a.md", "/s1.md"] } },
      { preferences: { recentFiles: ["/a.md", "/c.md", "/s1.md"] } },
    ]);
  });

  it("RH-07 unmount before hydration writes nothing", async () => {
    const { result, unmount } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    unmount();
    await flush();
    expect(writes()).toEqual([]);
  });

  it("RH-08 witness: overlapping buffer and stored merge into one deduped write", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/base/two.md"));
    act(() => api(result).update("/a.md"));
    act(() => api(result).update("/base/two.md"));
    act(() => api(result).hydrate(BASE));
    await flush();
    const expected = ["/base/two.md", "/a.md", "/base/one.md"];
    expect(writes()).toEqual([{ preferences: { recentFiles: expected } }]);
    expect(api(result).recentFiles).toEqual(expected);
  });

  it("RH-08 generated: the hydration write equals replaying the updates after hydration", async () => {
    const seed = 0x5a5a0808;
    const rand = mulberry32(seed);
    const alphabet = ["/base/one.md", "/base/two.md", "/a.md", "/b.md"];
    const pick = () => alphabet[Math.floor(rand() * alphabet.length)];
    for (let i = 0; i < 200; i += 1) {
      const stored = Array.from({ length: Math.floor(rand() * 5) }, pick);
      const updates = Array.from({ length: 1 + Math.floor(rand() * 6) }, pick);
      const tag = `seed=${seed} case=${i} stored=${JSON.stringify(stored)} updates=${JSON.stringify(updates)}`;
      invokeMock.mockClear();
      const { result, unmount } = renderHook(() => useRecentFiles());
      for (const u of updates) act(() => api(result).update(u));
      act(() => api(result).hydrate(stored));
      await flush();
      const expected = updates.reduce(pushRecent, stored);
      expect(writes(), `writes ${tag}`).toEqual([{ preferences: { recentFiles: expected } }]);
      expect(api(result).recentFiles, `state ${tag}`).toEqual(expected);
      if (new Set(stored).size === stored.length) {
        expect(new Set(expected).size, `no duplicates ${tag}`).toBe(expected.length);
      }
      unmount();
    }
  });

  it("RH-09 callbacks keep a stable identity, and a second hydrate writes nothing", async () => {
    const { result, rerender } = renderHook(() => useRecentFiles());
    const first = api(result);
    const expectStable = (checkpoint: string) => {
      const now = api(result);
      expect(now.hydrate, `hydrate at ${checkpoint}`).toBe(first.hydrate);
      expect(now.update, `update at ${checkpoint}`).toBe(first.update);
      expect(now.fail, `fail at ${checkpoint}`).toBe(first.fail);
    };

    rerender();
    expectStable("A");
    act(() => api(result).update("/a.md"));
    await flush();
    expectStable("B");
    act(() => api(result).hydrate(BASE));
    await flush();
    expectStable("C");
    act(() => api(result).hydrate(BASE));
    await flush();
    expectStable("D");

    const merged = ["/a.md", "/base/one.md", "/base/two.md"];
    expect(writes()).toEqual([{ preferences: { recentFiles: merged } }]);
    expect(api(result).recentFiles).toEqual(merged);
    expect(bufferLogs()).toEqual([]);
  });

  it("RH-10 a hydrate and two updates with no re-render between them compose from the latest list", async () => {
    const { result } = renderHook(() => useRecentFiles());
    const { hydrate, update } = api(result);
    act(() => {
      hydrate(BASE);
      update("/c.md");
      update("/d.md");
    });
    await flush();
    const last = ["/d.md", "/c.md", "/base/one.md", "/base/two.md"];
    expect(writes()).toEqual([
      { preferences: { recentFiles: ["/c.md", "/base/one.md", "/base/two.md"] } },
      { preferences: { recentFiles: last } },
    ]);
    expect(api(result).recentFiles).toEqual(last);
  });
});
