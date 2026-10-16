/**
 * D238 — native pop-ups (the Settings select menus) and the Open panel stayed
 * light in dark mode, because mdpro never set the app's native appearance.
 *
 * Law: after the theme effect settles, the last `set_app_theme` sent is the
 * mode's appearance — `"dark"` / `"light"` for an explicit mode, `null`
 * (follow the system) for System — and in System mode `get_system_theme` is
 * only read after that `null` has been applied, so a forced appearance is
 * never read back as "the system theme". A failed `set_app_theme` never
 * blocks the CSS theme.
 *
 * **Mocked:** `@tauri-apps/api/core` (the IPC boundary; `setTheme` from
 * `@tauri-apps/api/app` reaches it as `plugin:app|set_app_theme`) and
 * `@tauri-apps/api/event` (a no-op `listen`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { loggingService } from "../src/services/loggingService";
import { useThemeStore } from "../src/stores/themeStore";

const SET = "plugin:app|set_app_theme";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

/** The command names in call order, appearance calls with their argument. */
function calls(): string[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === SET || cmd === "get_system_theme")
    .map(([cmd, args]) => (cmd === SET ? `set:${String((args as { theme: unknown }).theme)}` : "get"));
}

function routeDefault(systemTheme: "light" | "dark" = "dark") {
  invokeMock.mockImplementation(async (cmd: string) => (cmd === "get_system_theme" ? systemTheme : null));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  useThemeStore.setState({ mode: "light", resolvedTheme: "light", activeTheme: null });
  invokeMock.mockReset();
  routeDefault();
});

describe("D238: the native appearance follows the theme mode", () => {
  it("N1 Dark forces the native appearance dark", async () => {
    useThemeStore.setState({ mode: "dark" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    expect(calls()).toEqual(["set:dark"]);
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    unmount();
  });

  it("N2 Light forces the native appearance light", async () => {
    useThemeStore.setState({ mode: "light", resolvedTheme: "dark" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    expect(calls()).toEqual(["set:light"]);
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
    unmount();
  });

  it("N3 System releases the appearance (null) before reading the system theme", async () => {
    useThemeStore.setState({ mode: "system" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    expect(calls()).toEqual(["set:null", "get"]);
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    unmount();
  });

  it("N4 System does not read the system theme until the release has landed", async () => {
    let release: () => void = () => {};
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === SET) return new Promise<null>((resolve) => (release = () => resolve(null)));
      return Promise.resolve(cmd === "get_system_theme" ? "dark" : null);
    });
    useThemeStore.setState({ mode: "system" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    expect(calls()).toEqual(["set:null"]);
    await act(async () => release());
    await settle();
    expect(calls()).toEqual(["set:null", "get"]);
    unmount();
  });

  it("N5 a rejected set_app_theme still applies the CSS theme and logs a fail with an enum reason", async () => {
    const log = vi.spyOn(loggingService, "logEventSync");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === SET) throw new Error("not allowed");
      return cmd === "get_system_theme" ? "dark" : null;
    });
    useThemeStore.setState({ mode: "system", resolvedTheme: "light" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    const fails = log.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.event === "ui.theme.native_appearance" && entry.status === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0].context).toEqual({ mode: "system", reason: "set_failed" });
    unmount();
  });

  it("N6 switching Dark → System → Light sends dark, null, light in that order", async () => {
    useThemeStore.setState({ mode: "dark" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    await act(async () => useThemeStore.setState({ mode: "system" }));
    await settle();
    await act(async () => useThemeStore.setState({ mode: "light" }));
    await settle();
    expect(calls()).toEqual(["set:dark", "set:null", "get", "set:light"]);
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
    unmount();
  });

  it("N7 outside Tauri nothing is sent", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    useThemeStore.setState({ mode: "dark" });
    const { unmount } = renderHook(() => useTheme());
    await settle();
    expect(calls().filter((c) => c.startsWith("set:"))).toEqual([]);
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    unmount();
  });

  it("N8 the window capability grants set_app_theme and nothing broader for core:app", () => {
    const capability = JSON.parse(
      readFileSync(join(__dirname, "..", "src-tauri", "capabilities", "default.json"), "utf8"),
    ) as { permissions: string[] };
    const appPermissions = capability.permissions.filter((p) => p.startsWith("core:app:"));
    expect(appPermissions).toEqual(["core:app:allow-set-app-theme"]);
  });
});
