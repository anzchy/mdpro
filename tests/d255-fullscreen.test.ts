/** D255: the off-Mac command toggles the observed window state. */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { windowState, setFullscreen } = vi.hoisted(() => {
  const windowState = { fullscreen: false };
  const setFullscreen = vi.fn(async (value: boolean) => { windowState.fullscreen = value; });
  return { windowState, setFullscreen };
});

it("only an applied off-Mac F11 binding fires the keyboard command", async () => {
  const originalPlatform = window.navigator.platform;
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(event));
    return event.defaultPrevented;
  };
  try {
    for (const [platform, binding, version, shouldFire] of [
      ["Win32", "Cmd+Option+F", 2, false],
      ["Win32", "F11", 2, true],
      ["Win32", "F11", 1, false],
      ["MacIntel", "F11", 2, false],
    ] as const) {
      Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
      vi.resetModules();
      const { useKeyboardShortcuts } = await import("../src/hooks/useKeyboardShortcuts");
      const { DEFAULT_KEYBOARD_SHORTCUTS } = await import("../src/types/preferences");
      const onToggleFullscreen = vi.fn();
      const { unmount } = renderHook(() => useKeyboardShortcuts({
        onToggleFullscreen,
        shortcutsVersion: version,
        shortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, viewToggleFullscreen: binding },
      }));
      expect(press("F11")).toBe(shouldFire);
      expect(onToggleFullscreen).toHaveBeenCalledTimes(shouldFire ? 1 : 0);
      unmount();
    }
  } finally {
    Object.defineProperty(window.navigator, "platform", { value: originalPlatform, configurable: true });
  }
});

it("uses the off-Mac applied Ctrl+Tab for Switch Documents only in v2", async () => {
  const originalPlatform = window.navigator.platform;
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
  try {
    vi.resetModules();
    const { useKeyboardShortcuts } = await import("../src/hooks/useKeyboardShortcuts");
    const { DEFAULT_KEYBOARD_SHORTCUTS } = await import("../src/types/preferences");
    const press = () => {
      const event = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true });
      act(() => window.dispatchEvent(event));
      return event.defaultPrevented;
    };
    for (const [version, binding, fires] of [
      [1, "Cmd+Tab", false],
      [2, "<unassigned>", false],
      [2, "Cmd+Tab", true],
    ] as const) {
      const switched = vi.fn();
      const { unmount } = renderHook(() => useKeyboardShortcuts({
        onSwitchDocuments: switched,
        shortcutsVersion: version,
        shortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, viewSwitchDocuments: binding },
      }));
      expect(press()).toBe(fires);
      expect(switched).toHaveBeenCalledTimes(fires ? 1 : 0);
      unmount();
    }
  } finally {
    Object.defineProperty(window.navigator, "platform", { value: originalPlatform, configurable: true });
  }
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => windowState.fullscreen,
    setFullscreen,
  }),
}));

import { rowById } from "../src/commands/commandTable";
import { dispatchMenuAction } from "../src/hooks/menuActionTable";
import { windowService } from "../src/services/windowService";

const toggle = () => (windowService as typeof windowService & {
  toggleFullscreen?: (actionId?: string) => Promise<void>;
}).toggleFullscreen?.("d255-fullscreen");

beforeEach(() => {
  windowState.fullscreen = false;
  setFullscreen.mockClear();
});

describe("D255 off-Mac full screen", () => {
  it("surfaces an OS toggle rejection to the user without changing state", async () => {
    setFullscreen.mockRejectedValueOnce(new Error("permission denied"));
    const toasts: string[] = [];
    const withFeedback = windowService as typeof windowService & {
      toggleFullscreenWithFeedback?: (showToast: (message: string) => void, actionId?: string) => Promise<void>;
    };
    await withFeedback.toggleFullscreenWithFeedback?.((message) => toasts.push(message), "d255-error");
    expect(toasts).toEqual(["Failed to toggle full screen"]);
    expect(windowState.fullscreen).toBe(false);
  });

  it("reads live state on each click and toggles in both directions", async () => {
    await toggle();
    expect(setFullscreen).toHaveBeenCalledWith(true);
    expect(windowState.fullscreen).toBe(true);
    await toggle();
    expect(setFullscreen).toHaveBeenLastCalledWith(false);
    expect(windowState.fullscreen).toBe(false);
  });

  it("does not toggle from stale assumed state", async () => {
    windowState.fullscreen = true;
    await toggle();
    expect(windowState.fullscreen).toBe(false);
  });

  it("routes one menu select to the command handler", () => {
    const ids: string[] = [];
    const actions: string[] = [];
    dispatchMenuAction({ action: "view.toggle_fullscreen" }, {
      onToggleFullscreen: (actionId) => actions.push(actionId ?? ""),
    }, (id) => { ids.push(id); return "d255-menu"; });
    expect(ids).toEqual(["menu.view.toggle_fullscreen"]);
    expect(actions).toEqual(["d255-menu"]);
  });

  it("has off-Mac menu availability and only the needed window permission", () => {
    const row = rowById("view.toggleFullscreen")!;
    expect(row.menu.macos).toBe("none");
    expect(row.route.macos).toBe("unavailable");
    for (const platform of ["windows", "linux"] as const) {
      expect(row.menu[platform]).toEqual(["View", "Toggle Fullscreen"]);
      expect(row.availability[platform]).toEqual({ v1: "both", v2: "both" });
      expect(row.route[platform]).toBe("frontend");
      expect(row.key[platform].defaults.v2).toBe("F11");
    }
    const capabilities = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
    expect(capabilities.permissions.filter((permission: string) => permission === "core:window:allow-set-fullscreen")).toHaveLength(1);
  });
});
