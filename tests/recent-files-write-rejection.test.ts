/**
 * WI-2-FIX (ADR-0031 step 5a, review finding 2) — a rejecting `set_preferences`
 * from `useRecentFiles` must not surface as an unhandled rejection.
 * `preferencesService.setPreferences` logs and toasts, then rethrows; the hook's
 * fire-and-forget call sites must swallow that rethrow.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { useLoggingStore } from "../src/stores/loggingStore";

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: unknown) => {
    if (cmd === "set_preferences") throw new Error("disk full");
    return null;
  });
  (globalThis as unknown as Record<string, unknown>).__TAURI__ = {};
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  delete (globalThis as unknown as Record<string, unknown>).__TAURI__;
});

describe("useRecentFiles — write rejection is handled (WI-2-FIX)", () => {
  it("RW-01 a rejecting write after hydration leaks no unhandled rejection; the list still updates", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => result.current.hydrateRecentFiles(["/s.md"]));
    act(() => result.current.updateRecentFiles("/a.md"));
    await flush();
    await flush();

    expect(result.current.recentFiles).toEqual(["/a.md", "/s.md"]);
    expect(unhandled).toEqual([]);
  });

  it("RW-02 a rejecting hydration write (non-empty buffer) leaks no unhandled rejection", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => result.current.updateRecentFiles("/a.md"));
    act(() => result.current.hydrateRecentFiles(["/s.md"]));
    await flush();
    await flush();

    expect(result.current.recentFiles).toEqual(["/a.md", "/s.md"]);
    expect(unhandled).toEqual([]);
  });
});
