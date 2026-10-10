/**
 * D43 WI-1 RED — a window whose preferences failed to load still shows the
 * session's Recent Files list.
 *
 * Case D43-01 of `.claude/tdd-guardian/tests-20261007-143049.md`. This file is
 * frozen between its recorded red and WI-4's green.
 *
 * Root cause pinned here: a window's list only ever holds that window's own
 * opens; it never learns the session list Rust owns. Target contract (design b):
 * the hook sends a `record` op to `sync_recent_files_menu` and displays the list
 * Rust returns.
 *
 * **Mocked:** only `@tauri-apps/api/core` — `invoke` (a recording `vi.fn`) and
 * the `isTauri` spy, set true. The hook, services, logging store and pure utils
 * are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook, type RenderHookResult } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { useLoggingStore } from "../src/stores/loggingStore";

type HookResult = RenderHookResult<ReturnType<typeof useRecentFiles>, unknown>["result"];

const SYNC_COMMAND = "sync_recent_files_menu";
/** What Rust's session list looks like after the second window records `/a.md`. */
const SESSION_LIST = ["/a.md", "/d.md", "/c.md", "/b.md"];

/** The one line that binds the placeholder API names to the hook. */
function api(result: HookResult) {
  const r = result.current;
  return {
    recentFiles: r.recentFiles,
    update: r.updateRecentFiles,
    fail: r.failRecentFilesHydration,
  };
}

function syncCalls() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === SYNC_COMMAND)
    .map(([, args]) => args as { op: Record<string, unknown>; viewMode: unknown });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: unknown) =>
    cmd === SYNC_COMMAND ? [...SESSION_LIST] : null,
  );
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

describe("useRecentFiles — session menu list (D43)", () => {
  it("D43-01 failed hydration then one update shows the list Rust returned", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).fail());
    act(() => api(result).update("/a.md"));
    await flush();

    // Level 5: the hook displays the session list Rust returned, not its own
    // one-item list.
    expect(api(result).recentFiles).toEqual(SESSION_LIST);

    // Level 6 supplement: the boundary received a delta, never a whole list.
    const calls = syncCalls();
    const lastOp = calls[calls.length - 1]?.op;
    expect(lastOp).toEqual({ kind: "record", path: "/a.md" });
    expect(Object.values(lastOp ?? {}).some((v) => Array.isArray(v))).toBe(false);
  });
});
