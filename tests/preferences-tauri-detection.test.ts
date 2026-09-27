/**
 * ADR-0031 step 5b (WI-1) — preferencesService branch selection (D24).
 *
 * Law: for every call, the branch taken depends only on what `isTauri()` from
 * `@tauri-apps/api/core` returns AT THAT CALL. No cached decision, and no other
 * marker (`__TAURI__`, `__TAURI_INTERNALS__`) is consulted. Browser branch =
 * zero `invoke` calls; Tauri branch = exactly one `invoke` of the method's
 * command, whose result comes back unchanged.
 *
 * Matrix `.claude/tdd-guardian/tests-20260927-031000.md` D1–D4. D1–D3 drive the
 * `isTauri` spy from `tests/support/tauriCoreMock.ts`; D4 re-imports the service
 * against the package's REAL `isTauri` and enumerates the global markers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
import { preferencesService } from "../src/services/preferencesService";
import type { WindowState } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";

const GET_REPLY = makePreferences({ themeMode: "dark", autoSaveInterval: 4242 });
const SET_REPLY = makePreferences({ showSidebar: false, autoSaveInterval: 4343 });
const WS: WindowState = { width: 1, height: 2, x: 3, y: 4, isMaximized: true };

function routeInvoke(): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_preferences":
        return GET_REPLY;
      case "set_preferences":
        return SET_REPLY;
      case "get_system_theme":
        return "dark";
      case "save_window_state":
        return undefined;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches })));
}

/** Call all four methods in the order get, set, theme, save. */
async function callAll() {
  return {
    get: await preferencesService.getPreferences(),
    set: await preferencesService.setPreferences({ showSidebar: false }),
    theme: await preferencesService.getSystemTheme(),
    save: await preferencesService.saveWindowState(WS),
  };
}

const TAURI_CALLS = [
  ["get_preferences", {}],
  ["set_preferences", { preferences: { showSidebar: false } }],
  ["get_system_theme", {}],
  ["save_window_state", { windowState: WS }],
];

describe("preferencesService — branch selection by isTauri() at call time", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    routeInvoke();
  });

  it("D1: browser branch — all four methods return their browser value without IPC", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    const prefs = await preferencesService.getPreferences();
    expect(prefs.themeMode).toBe("system");
    expect(prefs.autoSaveInterval).toBe(30);

    const merged = await preferencesService.setPreferences({ showSidebar: false, autoSaveInterval: 777 });
    expect(merged.showSidebar).toBe(false);
    expect(merged.autoSaveInterval).toBe(777);
    expect(merged.themeMode).toBe("system");

    await expect(
      preferencesService.saveWindowState({ width: 1, height: 2, x: 3, y: 4, isMaximized: true }),
    ).resolves.toBeUndefined();

    stubMatchMedia(true);
    expect(await preferencesService.getSystemTheme()).toBe("dark");
    stubMatchMedia(false);
    expect(await preferencesService.getSystemTheme()).toBe("light");

    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("D2: Tauri branch — each method reaches its command and returns the backend's value", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    stubMatchMedia(false);

    expect(await preferencesService.getPreferences()).toEqual(GET_REPLY);
    expect(await preferencesService.setPreferences({ showSidebar: false })).toEqual(SET_REPLY);
    expect(await preferencesService.getSystemTheme()).toBe("dark");
    await expect(preferencesService.saveWindowState(WS)).resolves.toBeUndefined();

    expect(invokeMock.mock.calls).toEqual(TAURI_CALLS);
  });

  it("D3: detection is evaluated at every call (no cached decision)", async () => {
    stubMatchMedia(false);
    const sequence = [false, true, true, false, true, false];
    for (const tauri of sequence) {
      vi.mocked(isTauri).mockReturnValue(tauri);
      const r = await callAll();
      if (tauri) {
        expect(r.get).toEqual(GET_REPLY);
        expect(r.set).toEqual(SET_REPLY);
        expect(r.theme).toBe("dark");
      } else {
        expect(r.get.autoSaveInterval).toBe(30);
        expect(r.set.autoSaveInterval).toBe(30);
        expect(r.set.showSidebar).toBe(false);
        expect(r.theme).toBe("light");
      }
      expect(r.save).toBeUndefined();
    }

    expect(invokeMock).toHaveBeenCalledTimes(12);
    expect(invokeMock.mock.calls).toEqual([...TAURI_CALLS, ...TAURI_CALLS, ...TAURI_CALLS]);
  });
});

describe("preferencesService — contract with the real @tauri-apps/api isTauri()", () => {
  it("D4: only the `isTauri` global marker selects the Tauri branch", async () => {
    const rows: Array<{ name: string; globals: Record<string, unknown>; calls: number }> = [
      { name: "isTauri true", globals: { isTauri: true }, calls: 1 },
      { name: "isTauri false", globals: { isTauri: false }, calls: 0 },
      { name: "no marker", globals: {}, calls: 0 },
      { name: "__TAURI__ only", globals: { __TAURI__: {} }, calls: 0 },
      { name: "__TAURI_INTERNALS__ only", globals: { __TAURI_INTERNALS__: {} }, calls: 0 },
      { name: "__TAURI__ + __TAURI_INTERNALS__", globals: { __TAURI__: {}, __TAURI_INTERNALS__: {} }, calls: 0 },
    ];
    expect(rows).toHaveLength(6);

    vi.resetModules();
    vi.doMock("@tauri-apps/api/core", async () => ({
      ...(await vi.importActual<typeof import("@tauri-apps/api/core")>("@tauri-apps/api/core")),
      invoke: (...args: unknown[]) => invokeMock(...args),
    }));
    const { preferencesService: real } = await import("../src/services/preferencesService");

    const seen: Array<{ name: string; calls: number; autoSaveInterval: number }> = [];
    for (const row of rows) {
      invokeMock.mockReset();
      routeInvoke();
      for (const [key, value] of Object.entries(row.globals)) vi.stubGlobal(key, value);
      const prefs = await real.getPreferences();
      seen.push({ name: row.name, calls: invokeMock.mock.calls.length, autoSaveInterval: prefs.autoSaveInterval });
      vi.unstubAllGlobals();
    }
    vi.doUnmock("@tauri-apps/api/core");

    expect(seen).toEqual(
      rows.map((row) => ({
        name: row.name,
        calls: row.calls,
        autoSaveInterval: row.calls === 1 ? 4242 : 30,
      })),
    );
  });
});
