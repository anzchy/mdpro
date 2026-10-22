/** Purpose: real App menu and hydration paths settle the reported theme mode. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

const { state } = vi.hoisted(() => ({
  state: {
    preferences: null as unknown,
    nativeTheme: "system" as string,
    themeWrites: [] as string[],
    menuReports: [] as string[],
    rejectLight: null as null | ((error: Error) => void),
    deferLight: false,
    menuListener: null as null | ((event: { payload: unknown }) => void),
    themeListener: null as null | ((event: { payload: unknown }) => void),
    focusListener: null as null | ((event: { payload: boolean }) => void),
  },
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({
    isTauri: true,
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "get_preferences") return state.preferences;
      if (command === "get_logging_settings") return { enabled: true, level: "info" };
      if (command === "get_system_theme") return "light";
      if (command === "get_launch_paths" || command === "list_drafts") return [];
      if (command === "sync_recent_files_menu") {
        if (typeof args.themeMode === "string") {
          state.nativeTheme = args.themeMode;
          state.menuReports.push(args.themeMode);
        }
        return [];
      }
      if (command === "set_preferences") {
        const mode = (args.preferences as { themeMode?: string })?.themeMode;
        if (mode) state.themeWrites.push(mode);
        if (mode === "light" && state.deferLight) {
          return new Promise((_, reject) => { state.rejectLight = reject; });
        }
      }
      return null;
    },
  }),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    if (name === "theme:changed") state.themeListener = callback;
    return () => { if (name === "theme:changed") state.themeListener = null; };
  }),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main", setTitle: async () => {}, onCloseRequested: async () => () => {},
    onFocusChanged: async (callback: (event: { payload: boolean }) => void) => {
      state.focusListener = callback;
      return () => { state.focusListener = null; };
    },
    listen: async (name: string, callback: (event: { payload: unknown }) => void) => {
      if (name === "menu:action") state.menuListener = callback;
      return () => { if (name === "menu:action") state.menuListener = null; };
    },
  }),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import App from "../src/App";
import { useThemeStore } from "../src/stores/themeStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { makePreferences } from "./support/preferenceFixtures";

beforeEach(() => {
  state.preferences = makePreferences({ themeMode: "system", recentFiles: [] });
  state.nativeTheme = "system";
  state.themeWrites.length = 0;
  state.menuReports.length = 0;
  state.rejectLight = null;
  state.deferLight = false;
  state.menuListener = null;
  state.themeListener = null;
  state.focusListener = null;
  useThemeStore.setState({ mode: "system", resolvedTheme: "light", activeTheme: null });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
});
afterEach(() => { state.rejectLight?.(new Error("teardown")); state.rejectLight = null; });

async function clickTheme(mode: "light" | "dark" | "system") {
  await waitFor(() => expect(state.menuListener).not.toBeNull());
  await act(async () => {
    state.menuListener!({ payload: { action: `theme.${mode}`, target: "main" } });
  });
}

describe("M4 theme mode through the real App", () => {
  it("hydrates Dark without a write and does not persist a repeated Dark click", async () => {
    state.preferences = makePreferences({ themeMode: "dark", recentFiles: [] });
    const view = render(<App />);
    await waitFor(() => expect(state.nativeTheme).toBe("dark"));
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(state.themeWrites).toEqual([]);
    state.menuReports.length = 0;
    await act(async () => { state.focusListener?.({ payload: true }); });
    await waitFor(() => expect(state.menuReports.at(-1)).toBe("dark"));
    await clickTheme("dark");
    await clickTheme("dark");
    expect(state.themeWrites).toEqual([]);
    expect(state.nativeTheme).toBe("dark");
    view.unmount();
  });

  it("reports the rolled-back System mode after a failed Light write", async () => {
    state.deferLight = true;
    const view = render(<App />);
    await waitFor(() => expect(state.menuListener).not.toBeNull());
    await clickTheme("light");
    await waitFor(() => expect(state.rejectLight).not.toBeNull());
    await act(async () => { state.rejectLight!(new Error("disk failed")); });
    await waitFor(() => expect(useThemeStore.getState().mode).toBe("system"));
    await waitFor(() => expect(state.nativeTheme).toBe("system"));
    expect(state.menuReports.at(-1)).toBe("system");
    view.unmount();
    state.rejectLight = null;
  });

  it("keeps Dark when an older Light write fails, and System tick through appearance change", async () => {
    state.deferLight = true;
    const view = render(<App />);
    await clickTheme("light");
    await waitFor(() => expect(state.rejectLight).not.toBeNull());
    await clickTheme("dark");
    await waitFor(() => expect(state.nativeTheme).toBe("dark"));
    await act(async () => { state.rejectLight!(new Error("older write failed")); });
    await waitFor(() => expect(useThemeStore.getState().mode).toBe("dark"));
    expect(state.nativeTheme).toBe("dark");
    await clickTheme("system");
    await waitFor(() => expect(state.nativeTheme).toBe("system"));
    await act(async () => { state.themeListener?.({ payload: { theme: "dark" } }); });
    expect(useThemeStore.getState().mode).toBe("system");
    expect(state.nativeTheme).toBe("system");
    view.unmount();
    state.rejectLight = null;
  });
});
