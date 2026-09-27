/**
 * ADR-0031 step 5b follow-up — characterization of `useTheme`'s system-mode
 * startup when `get_system_theme` rejects: the resolved theme falls back to
 * `"light"` (src/hooks/useTheme.ts `applySystemTheme` catch).
 *
 * Characterization, not TDD: the fallback already existed. The store starts at
 * `resolvedTheme: "dark"` so the fallback is observable as a change, and a
 * control row resolving `"dark"` shows the IPC path is actually reached.
 *
 * **Mocked:** `@tauri-apps/api/core` (Tauri mode on; `invoke` routed per test)
 * and `@tauri-apps/api/event` (a no-op `listen`). Sibling files are over the
 * 300-line limit, hence a new file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { isTauri } from "@tauri-apps/api/core";
import { useTheme } from "../src/hooks/useTheme";
import { useThemeStore } from "../src/stores/themeStore";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

function systemThemeCalls() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "get_system_theme");
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  // A dark browser preference must not leak into the Tauri-mode fallback.
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  useThemeStore.setState({ mode: "system", resolvedTheme: "dark", activeTheme: null });
  invokeMock.mockReset();
});

describe("useTheme — system-theme read failure", () => {
  it("TF1 get_system_theme rejecting resolves the theme to light", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_system_theme") throw new Error("ipc down");
      return null;
    });
    const { unmount } = renderHook(() => useTheme());
    await settle();

    expect(systemThemeCalls()).toHaveLength(1);
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
    expect(useThemeStore.getState().mode).toBe("system");
    unmount();
  });

  it("TF2 a non-Error rejection falls back to light as well", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_system_theme") throw "unavailable";
      return null;
    });
    const { unmount } = renderHook(() => useTheme());
    await settle();

    expect(useThemeStore.getState().resolvedTheme).toBe("light");
    unmount();
  });

  it("TF3 control: a successful read applies the system theme", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "get_system_theme" ? "dark" : null,
    );
    useThemeStore.setState({ resolvedTheme: "light" });
    const { unmount } = renderHook(() => useTheme());
    await settle();

    expect(systemThemeCalls()).toHaveLength(1);
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    unmount();
  });
});
