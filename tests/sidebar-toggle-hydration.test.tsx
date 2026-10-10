/**
 * ADR-0031 step 5b, WI-5 (DEC-4: fix) — a sidebar toggle before preferences
 * load no longer desynchronises the UI from disk.
 *
 * Cases SB1 … SB8 of `.claude/tdd-guardian/tests-20260927-031000.md`.
 * Policy P1 (orchestrator decision 2): the last pre-hydration intent wins.
 *
 * **Law (SB5).** For every sequence in which all IPC succeeds, once everything
 * settles, the store's `showSidebar` equals `disk.showSidebar`, and the write
 * count is the post-hydration toggles plus 1 iff the buffered value differs
 * from the initial disk value.
 *
 * **Mocked:** only `@tauri-apps/api/core` — `invoke` is a stateful fake disk
 * (`get_preferences` waits on a gate the test opens; `set_preferences` merges
 * into `disk`), and the `isTauri` spy is true. `preferencesService`,
 * `useEditorStore` and `useToastStore` are real.
 *
 * SB8 is a source-text call-site pin (below Level 1): `App` cannot be rendered
 * in this suite (`tests/large-document-guard-call-site.test.ts:28-44`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
import { preferencesService } from "../src/services/preferencesService";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";
import { deferred, type Deferred } from "./support/windowSaveHarness";

const ROOT = resolve(__dirname, "..");
const SAVE_FAILED_TOAST = "Failed to save preferences";

const disk = { showSidebar: true };
let gate: Deferred;
let setRejection: unknown = null;
/** Ordered IPC log: "get:resolved" when hydration's read lands, "set:<value>" per write. */
let events: string[] = [];

async function route(cmd: unknown, args: unknown): Promise<unknown> {
  switch (cmd) {
    case "get_preferences":
      await gate.promise;
      events.push("get:resolved");
      return makePreferences({ showSidebar: disk.showSidebar });
    case "set_preferences": {
      if (setRejection !== null) throw setRejection;
      const sent = (args as { preferences: Partial<UserPreferences> }).preferences;
      Object.assign(disk, sent);
      events.push(`set:${String(sent.showSidebar)}`);
      return makePreferences({ showSidebar: disk.showSidebar });
    }
    default:
      return null;
  }
}

function writes() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "set_preferences")
    .map(([, payload]) => payload);
}

function sidebar() {
  return useEditorStore.getState().showSidebar;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

/** The App's `loadPreferences` shape: read, then hydrate with what was read. */
function startLoad() {
  return preferencesService.getPreferences("app_hydrate");
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(route);
  vi.mocked(isTauri).mockReturnValue(true);
  useEditorStore.setState({ showSidebar: true });
  useToastStore.getState().clearToast();
  disk.showSidebar = true;
  gate = deferred();
  setRejection = null;
  events = [];
});

describe("useSidebarPreference — P1, the last pre-hydration intent wins", () => {
  it("SB1 a pre-hydration hide survives hydration and is written once after it", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    const load = startLoad();
    act(() => result.current.toggle());
    expect(sidebar()).toBe(false);
    await flush();
    expect(writes()).toEqual([]);

    gate.resolve();
    const prefs = await load;
    act(() => result.current.hydrate(prefs.showSidebar));
    await flush();

    expect(sidebar()).toBe(false);
    expect(writes()).toEqual([{ preferences: { showSidebar: false } }]);
    expect(events).toEqual(["get:resolved", "set:false"]);
    expect(disk.showSidebar).toBe(false);
  });

  it("SB2 a pre-hydration toggle equal to disk writes nothing", async () => {
    disk.showSidebar = false;
    const { result } = renderHook(() => useSidebarPreference());
    const load = startLoad();
    act(() => result.current.toggle());
    gate.resolve();
    const prefs = await load;
    act(() => result.current.hydrate(prefs.showSidebar));
    await flush();

    expect(sidebar()).toBe(false);
    expect(writes()).toEqual([]);
  });

  it("SB3 no pre-hydration toggle — hydration applies disk and never writes", async () => {
    disk.showSidebar = false;
    const { result } = renderHook(() => useSidebarPreference());
    const load = startLoad();
    gate.resolve();
    const prefs = await load;
    act(() => result.current.hydrate(prefs.showSidebar));
    await flush();

    expect(sidebar()).toBe(false);
    expect(writes()).toEqual([]);
  });

  it("SB4 post-hydration toggles write exactly once each, in order", async () => {
    gate.resolve();
    const single = renderHook(() => useSidebarPreference());
    act(() => single.result.current.hydrate(true));
    act(() => single.result.current.toggle());
    await flush();
    expect(sidebar()).toBe(false);
    expect(writes()).toEqual([{ preferences: { showSidebar: false } }]);
    single.unmount();

    invokeMock.mockClear();
    useEditorStore.setState({ showSidebar: true });
    disk.showSidebar = true;
    const pair = renderHook(() => useSidebarPreference());
    act(() => pair.result.current.hydrate(true));
    act(() => {
      pair.result.current.toggle();
      pair.result.current.toggle();
    });
    await flush();
    expect(sidebar()).toBe(true);
    expect(writes()).toEqual([
      { preferences: { showSidebar: false } },
      { preferences: { showSidebar: true } },
    ]);
    expect(disk.showSidebar).toBe(true);
  });

  it("SB5 law: UI equals disk after settle, over d × k × m", async () => {
    const rows: Array<{ d: boolean; k: number; m: number }> = [];
    for (const d of [true, false]) {
      for (const k of [0, 1, 2, 3]) {
        for (const m of [0, 1, 2]) rows.push({ d, k, m });
      }
    }
    expect(rows).toHaveLength(24);

    for (const { d, k, m } of rows) {
      const tag = `d=${d} k=${k} m=${m}`;
      invokeMock.mockClear();
      useEditorStore.setState({ showSidebar: true });
      disk.showSidebar = d;
      gate = deferred();
      const { result, unmount } = renderHook(() => useSidebarPreference());
      const load = startLoad();
      for (let i = 0; i < k; i += 1) act(() => result.current.toggle());
      gate.resolve();
      const prefs = await load;
      act(() => result.current.hydrate(prefs.showSidebar));
      for (let i = 0; i < m; i += 1) act(() => result.current.toggle());
      await flush();

      const buffered = k % 2 === 0;
      const expectedWrites = m + (k > 0 && buffered !== d ? 1 : 0);
      expect(sidebar(), `store ${tag}`).toBe(disk.showSidebar);
      expect(writes(), `writes ${tag}`).toHaveLength(expectedWrites);
      unmount();
    }
  });

  it("SB6 failed hydration keeps the buffer in memory, writes nothing, then later toggles write", async () => {
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) => {
      if (cmd === "get_preferences") throw new Error("parse");
      return route(cmd, args);
    });
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle());
    await expect(startLoad()).rejects.toThrow("parse");
    act(() => result.current.fail());
    await flush();
    expect(sidebar()).toBe(false);
    expect(writes()).toEqual([]);

    act(() => result.current.toggle());
    await flush();
    expect(sidebar()).toBe(true);
    expect(writes()).toEqual([{ preferences: { showSidebar: true } }]);
  });

  it("SB7 a rejected sidebar write gives one exact toast, no rollback, no unhandled rejection", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrate(true));
    setRejection = { ParseError: { message: "key must be a string at line 1 column 3 /Users/x" } };

    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const emissions: string[] = [];
    const stop = useToastStore.subscribe((s) => {
      if (s.message !== null) emissions.push(s.message);
    });
    try {
      act(() => result.current.toggle());
      await flush();

      expect(writes()).toHaveLength(1);
      expect(rejections).toEqual([]);
      expect(emissions).toEqual([SAVE_FAILED_TOAST]);
      expect(sidebar()).toBe(false);

      const control = Promise.reject(new Error("control"));
      await flush();
      expect(
        rejections.map((r) => (r instanceof Error ? r.message : String(r))),
        "the listener does catch a genuinely unhandled rejection",
      ).toEqual(["control"]);
      control.catch(() => undefined);
      await flush();
    } finally {
      stop();
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("SB8 App.tsx is not a second writer of showSidebar (wiring pin)", () => {
  const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");

  it("SB8-a App.tsx carries no store-level sidebar writer tokens", () => {
    expect(app.match(/\bsetShowSidebar\b/g)).toBeNull();
    expect(app.match(/\btoggleSidebar\b/g)).toBeNull();
    expect(app.match(/showSidebar\s*:/g)).toBeNull();
    expect(app.match(/useEditorStore\.setState\(/g)).toBeNull();
  });

  it("SB8-a both onToggleSidebar bindings are the hook's toggle, and loadPreferences hydrates and fails it", () => {
    const hookBinding = app.match(/const\s+(\w+)\s*=\s*useSidebarPreference\(\)/);
    expect(hookBinding).not.toBeNull();
    const name = (hookBinding as RegExpMatchArray)[1];
    const bindings = [...app.matchAll(/onToggleSidebar:\s*([\w.]+)/g)].map((m) => m[1]);
    expect(bindings).toEqual([`${name}.toggle`, `${name}.toggle`]);

    const load = app.slice(app.indexOf("const loadPreferences = async"), app.indexOf("void loadPreferences();"));
    expect(load).toMatch(new RegExp(`\\b${name}\\.hydrate\\(prefs\\.showSidebar\\)`));
    const catchBlock = load.slice(load.indexOf("} catch"));
    expect(catchBlock).toMatch(new RegExp(`\\b${name}\\.fail\\(\\)`));
  });

  it("SB8-b across src/, only the store, useEditor and the hook name the store's sidebar actions", () => {
    const allowed = new Set([
      "src/stores/editorStore.ts",
      "src/hooks/useEditor.ts",
      "src/hooks/useSidebarPreference.ts",
    ]);
    const files = sourceFiles(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(50);
    const writers = files
      .filter((f) => /\b(setShowSidebar|toggleSidebar)\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).split("\\").join("/"));
    for (const w of writers) expect(allowed, w).toContain(w);
  });
});
