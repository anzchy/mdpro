/**
 * SHOULD-FIX — unify Tauri detection in preferencesService.
 *
 * Previously the service mixed a module-load `const isTauri = isTauriEnv()`
 * (used by getPreferences / getSystemTheme / saveWindowState) with a call-time
 * `isTauriEnv()` (used only by setPreferences). If `__TAURI__` bootstrapped
 * after module load, those three methods would be stuck in browser mode for the
 * whole session — an inconsistency between save and read.
 *
 * All four methods must now evaluate `isTauriEnv()` at call time: a method
 * called before `__TAURI__` exists uses browser mode; the same method called
 * after it appears uses the Tauri invoke path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { preferencesService } from "../src/services/preferencesService";

const setTauri = (on: boolean) => {
  if (on) (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
  else delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
};

describe("preferencesService — call-time Tauri detection (late bootstrap)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setTauri(false);
  });
  afterEach(() => setTauri(false));

  it("getPreferences uses browser defaults before bootstrap, invoke after", async () => {
    // Before __TAURI__ exists → browser mode, no invoke.
    const browser = await preferencesService.getPreferences();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(browser.themeMode).toBeDefined();

    // After late bootstrap → Tauri invoke path.
    setTauri(true);
    invokeMock.mockResolvedValueOnce({ themeMode: "dark" });
    const tauri = await preferencesService.getPreferences();
    expect(invokeMock).toHaveBeenCalledWith("get_preferences", {});
    expect(tauri).toEqual({ themeMode: "dark" });
  });

  it("saveWindowState is a no-op before bootstrap, invokes after", async () => {
    const ws = { width: 1, height: 1, x: 0, y: 0, isMaximized: false };
    await preferencesService.saveWindowState(ws);
    expect(invokeMock).not.toHaveBeenCalled();

    setTauri(true);
    invokeMock.mockResolvedValueOnce(undefined);
    await preferencesService.saveWindowState(ws);
    expect(invokeMock).toHaveBeenCalledWith("save_window_state", { windowState: ws });
  });

  it("getSystemTheme uses matchMedia before bootstrap, invoke after", async () => {
    // jsdom: matchMedia may be undefined — stub it for the browser branch.
    (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => ({ matches: false }));
    const browser = await preferencesService.getSystemTheme();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(["light", "dark"]).toContain(browser);

    setTauri(true);
    invokeMock.mockResolvedValueOnce("dark");
    const tauri = await preferencesService.getSystemTheme();
    expect(invokeMock).toHaveBeenCalledWith("get_system_theme", {});
    expect(tauri).toBe("dark");
  });

  it("setPreferences uses the same call-time detection as the readers", async () => {
    const browser = await preferencesService.setPreferences({ showSidebar: false });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(browser.showSidebar).toBe(false);

    setTauri(true);
    invokeMock.mockResolvedValueOnce({ showSidebar: false });
    await preferencesService.setPreferences({ showSidebar: false });
    expect(invokeMock).toHaveBeenCalledWith("set_preferences", { preferences: { showSidebar: false } });
  });
});
