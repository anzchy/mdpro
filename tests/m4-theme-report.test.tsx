/** Purpose: menu-driven theme changes report in order through the real hooks. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { pending, calls } = vi.hoisted(() => ({
  pending: [] as { theme: string; release: () => void }[],
  calls: [] as { cmd: string; args: unknown }[],
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({
    isTauri: true,
    invoke: (cmd: string, args?: unknown) => {
      calls.push({ cmd, args });
      if (cmd === "sync_recent_files_menu") {
        const theme = (args as { themeMode?: string }).themeMode ?? "none";
        return new Promise<string[]>((resolve) => {
          pending.push({ theme, release: () => resolve([]) });
        });
      }
      return Promise.resolve(undefined);
    },
  }),
);
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));

import { useTheme } from "../src/hooks/useTheme";
import { useRecentFilesMenuRefresh } from "../src/hooks/useRecentFilesMenuRefresh";
import { dispatchMenuAction } from "../src/hooks/menuActionTable";
import { useThemeStore } from "../src/stores/themeStore";

const tick = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  pending.length = 0;
  calls.length = 0;
  useThemeStore.setState({ mode: "system", resolvedTheme: "light", activeTheme: null });
});
afterEach(() => { pending.length = 0; calls.length = 0; });

describe("M4 theme menu reports", () => {
  it("serializes report completion so a late older choice cannot retick the menu", async () => {
    const hook = renderHook(() => {
      const theme = useTheme();
      useRecentFilesMenuRefresh("wysiwyg", theme.mode);
      return theme;
    });
    await tick();
    expect(pending.map((call) => call.theme)).toEqual(["system"]);
    await act(async () => { pending.shift()?.release(); });
    await tick();

    const choose = (action: string) => dispatchMenuAction(
      { action },
      { onThemeModeChange: (mode) => { void hook.result.current.setThemeMode(mode); } },
      () => `m4-${action}`,
    );
    act(() => { choose("theme.light"); });
    await tick();
    expect(pending.map((call) => call.theme)).toEqual(["light"]);
    act(() => { choose("theme.dark"); });
    await tick();
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(pending.map((call) => call.theme)).toEqual(["light"]);
    await act(async () => { pending.shift()?.release(); });
    await tick();
    expect(pending.map((call) => call.theme)).toEqual(["dark"]);
    await act(async () => { pending.shift()?.release(); });
    await tick();
    expect(pending).toEqual([]);
    hook.unmount();
  });
});
