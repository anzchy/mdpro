/**
 * D189 / ADR-0088: `useSidebarPreference` owns the sidebar width the way it
 * owns visibility. Policy P1 (the last pre-hydration intent wins), one
 * `set_preferences` per settled resize, clamped values, one
 * `ui.sidebar.resize` log per settled resize.
 *
 * **Mocked:** only `@tauri-apps/api/core`; `invoke` is a fake disk.
 * `preferencesService`, `loggingService` and the stores are real.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSidebarPreference } from "../src/hooks/useSidebarPreference";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { LogEntryPayload } from "../src/types/logging";
import type { UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";

const ROOT = resolve(__dirname, "..");
let rejectWrites = false;

beforeEach(() => {
  invokeMock.mockReset();
  rejectWrites = false;
  invokeMock.mockImplementation(async (cmd: unknown, args: unknown) => {
    if (cmd !== "set_preferences") return null;
    if (rejectWrites) throw new Error("disk full");
    return makePreferences((args as { preferences: Partial<UserPreferences> }).preferences);
  });
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useEditorStore.setState({ showSidebar: true, sidebarWidth: 220 });
});

function writes() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "set_preferences").map(([, p]) => p);
}

function resizeLogs(): LogEntryPayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogEntryPayload }).payload)
    .filter((p) => p.event === "ui.sidebar.resize");
}

function width() {
  return useEditorStore.getState().sidebarWidth;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("D189 editorStore.setSidebarWidth", () => {
  it("stores a clamped, rounded width", () => {
    useEditorStore.getState().setSidebarWidth(300);
    expect(width()).toBe(300);
    useEditorStore.getState().setSidebarWidth(9000);
    expect(width()).toBe(480);
    useEditorStore.getState().setSidebarWidth(10.2);
    expect(width()).toBe(180);
    useEditorStore.getState().setSidebarWidth(NaN);
    expect(width()).toBe(220);
  });
});

describe("D189 useSidebarPreference width — policy P1", () => {
  it("W1 a pre-hydration resize survives hydration and is written once after it", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.resize(300, "drag"));
    await flush();
    expect(width()).toBe(300);
    expect(writes()).toEqual([]);

    act(() => result.current.hydrateWidth(220));
    await flush();
    expect(width()).toBe(300);
    expect(writes()).toEqual([{ preferences: { sidebarWidth: 300 } }]);
  });

  it("W2 without a pre-hydration resize, hydration applies disk and never writes", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(350));
    await flush();
    expect(width()).toBe(350);
    expect(writes()).toEqual([]);
  });

  it("W3 an out-of-range stored width is clamped in memory and not written back", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(9999));
    await flush();
    expect(width()).toBe(480);
    expect(writes()).toEqual([]);
  });

  it("W4 a pre-hydration resize equal to disk writes nothing", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.resize(300, "keyboard"));
    act(() => result.current.hydrateWidth(300));
    await flush();
    expect(width()).toBe(300);
    expect(writes()).toEqual([]);
  });

  it("W5 only the first hydration has effect", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(300));
    act(() => result.current.hydrateWidth(400));
    await flush();
    expect(width()).toBe(300);
  });

  it("W6 visibility and width settle independently", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrate(true));
    act(() => result.current.resize(260, "drag"));
    await flush();
    expect(writes()).toEqual([]);
    act(() => result.current.hydrateWidth(220));
    await flush();
    expect(writes()).toEqual([{ preferences: { sidebarWidth: 260 } }]);
  });
});

describe("D189 useSidebarPreference width — after hydration", () => {
  it("W7 one write per settled resize, carrying only sidebarWidth", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(220));
    act(() => result.current.resize(260, "keyboard"));
    await flush();
    expect(width()).toBe(260);
    expect(writes()).toEqual([{ preferences: { sidebarWidth: 260 } }]);
  });

  it("W8 a resize to the current width writes and logs nothing", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(220));
    act(() => result.current.resize(220, "drag"));
    await flush();
    expect(writes()).toEqual([]);
    expect(resizeLogs()).toEqual([]);
  });

  it("W9 a resize is clamped before it is stored and written", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(220));
    act(() => result.current.resize(50, "drag"));
    await flush();
    expect(width()).toBe(180);
    expect(writes()).toEqual([{ preferences: { sidebarWidth: 180 } }]);
  });

  it("W10 after fail(), the width stays and later resizes write", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.resize(300, "drag"));
    act(() => result.current.fail());
    await flush();
    expect(width()).toBe(300);
    expect(writes()).toEqual([]);
    act(() => result.current.resize(320, "drag"));
    await flush();
    expect(writes()).toEqual([{ preferences: { sidebarWidth: 320 } }]);
  });

  it("W11 a rejected write keeps the width and does not escape as an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      rejectWrites = true;
      const { result } = renderHook(() => useSidebarPreference());
      act(() => result.current.hydrateWidth(220));
      act(() => result.current.resize(400, "drag"));
      await flush();
      expect(width()).toBe(400);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("D189 ui.sidebar.resize logging", () => {
  it("logs from, to and source once per settled resize", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrateWidth(220));
    act(() => result.current.resize(252, "keyboard"));
    act(() => result.current.resize(9000, "drag"));
    act(() => result.current.resize(220, "reset"));
    await flush();
    expect(resizeLogs().map((p) => p.context)).toEqual([
      { from: 220, to: 252, source: "keyboard" },
      { from: 252, to: 480, source: "drag" },
      { from: 480, to: 220, source: "reset" },
    ]);
    expect(resizeLogs().every((p) => p.level === "info" && p.status === "success")).toBe(true);
  });
});

describe("D189 App.tsx wiring pin", () => {
  const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");

  it("loadPreferences hydrates the width from what it read", () => {
    const hook = (app.match(/const\s+(\w+)\s*=\s*useSidebarPreference\(\)/) as RegExpMatchArray)[1];
    const load = app.slice(app.indexOf("const loadPreferences = async"), app.indexOf("void loadPreferences();"));
    expect(load).toMatch(new RegExp(`\\b${hook}\\.hydrateWidth\\(prefs\\.sidebarWidth\\)`));
  });

  it("the app shell carries the stored width as --sidebar-width", () => {
    expect(app).toMatch(/"--sidebar-width":\s*`\$\{sidebarWidth\}px`/);
  });

  it("the sidebar's resize commits and the bottom bar's toggle go through the hook", () => {
    const hook = (app.match(/const\s+(\w+)\s*=\s*useSidebarPreference\(\)/) as RegExpMatchArray)[1];
    expect(app).toMatch(new RegExp(`onSidebarResize=\\{${hook}\\.resize\\}`));
    expect(app).toMatch(new RegExp(`onToggleSidebar=\\{${hook}\\.toggle\\}`));
  });
});
