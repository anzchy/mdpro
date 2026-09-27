/**
 * WI-1 (ADR-0031 step 5a) — the `?open=` URL-parameter open waits for
 * preference hydration.
 *
 * Cases WI1-01 … WI1-08 of `.claude/tdd-guardian/tests-20260926-221500.md`
 * (revision 3).
 *
 * **Laws.**
 * - (Idempotence) The `?open=` document is opened at most once per mount, and
 *   the hook's `setViewMode` parameter is called at most once per mount.
 * - (Ordering) No open, `setViewMode` or `set_preferences` before
 *   `preferencesLoaded` is true.
 * - (Conservation) The stored `recentFiles` survive the hydrate → open
 *   transition; inherited from WI-5's `useRecentFiles`, witnessed by WI1-03.
 *
 * **vmHistory** records every call the hook makes through its `setViewMode`
 * parameter (revision 3, Defect A), not store notifications.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke` (recording `vi.fn`) and
 * `@tauri-apps/api/window#getCurrentWindow` (label `mdpro-abc`). `useDocument`,
 * `useRecentFiles`, the stores, `preferencesService` and `loggingService` are
 * real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";

const { invokeMock, openControl } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  openControl: {
    /** When set, `open_file` awaits this promise before answering. */
    gate: null as Promise<void> | null,
    /** When set, `open_file` rejects with this error. */
    error: null as Error | null,
  },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "mdpro-abc" }),
}));

import { useOpenUrlParam } from "../src/hooks/useOpenUrlParam";
import { useDocument } from "../src/hooks/useDocument";
import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";
import type { ViewMode } from "../src/types/editor";
import { BASE_PREFERENCES } from "./support/preferenceFixtures";

const BASE = BASE_PREFERENCES.recentFiles;
const TEN = Array.from({ length: 10 }, (_, i) => `/s/${i}.md`);

function doc(id: string, path: string): Document {
  return {
    id,
    path,
    content: `content of ${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

async function answer(cmd: unknown, args: unknown): Promise<unknown> {
  if (cmd === "open_file") {
    if (openControl.gate) await openControl.gate;
    if (openControl.error) throw openControl.error;
    const { path } = args as { path: string };
    return { document: doc("d1", path), recoveredDraft: null };
  }
  return null;
}

let vmHistory: ViewMode[] = [];

interface HarnessProps {
  loaded: boolean;
  defaultViewMode: ViewMode;
  stored: string[];
}

function useHarness({ loaded, defaultViewMode, stored }: HarnessProps) {
  const { openDocumentFromPath } = useDocument();
  const recent = useRecentFiles();
  const { hydrateRecentFiles, updateRecentFiles } = recent;
  // Declared before the hook under test, so it runs first in the same commit
  // (mirrors App.tsx: hydrate, then setPreferencesLoaded).
  useEffect(() => {
    if (loaded) hydrateRecentFiles(stored);
  }, [loaded, stored, hydrateRecentFiles]);
  // New identity every render, on purpose.
  const setViewMode = (m: ViewMode) => {
    vmHistory.push(m);
    useEditorStore.getState().setViewMode(m);
  };
  useOpenUrlParam({
    preferencesLoaded: loaded,
    defaultViewMode,
    openDocumentFromPath: (p: string, a?: string) => openDocumentFromPath(p, a),
    setViewMode,
    updateRecentFiles,
  });
  return recent;
}

function mount(props: HarnessProps) {
  return renderHook((p: HarnessProps) => useHarness(p), { initialProps: props });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

function logPayloads(event?: string) {
  return callsFor("log_event")
    .map(([, args]) => (args as { payload: Record<string, unknown> }).payload)
    .filter((p) => event === undefined || p.event === event);
}

beforeEach(() => {
  vmHistory = [];
  openControl.gate = null;
  openControl.error = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ viewMode: "wysiwyg", activeDocumentId: null });
  window.history.replaceState({}, "", "/?open=%2Ftmp%2Fx.md");
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useOpenUrlParam — hydration gate", () => {
  // WI1-01 — REGRESSION RED. The red is carried by open_file === 0 and
  // vmHistory === []; set_preferences === 0 is vacuous with WI-5 landed.
  it("WI1-01 before hydration nothing is opened, set or written, and the query survives", async () => {
    const view = mount({ loaded: false, defaultViewMode: "wysiwyg", stored: BASE });
    await flush();
    for (const mode of ["source", "wysiwyg", "source"] as ViewMode[]) {
      view.rerender({ loaded: false, defaultViewMode: mode, stored: BASE });
      await flush();
    }

    expect(callsFor("open_file")).toHaveLength(0);
    expect(callsFor("set_preferences")).toHaveLength(0);
    expect(vmHistory).toEqual([]);
    expect(window.location.search).toBe("?open=%2Ftmp%2Fx.md");
  });

  it.each([
    { storeStart: "wysiwyg" as ViewMode, hydrated: "source" as ViewMode },
    { storeStart: "source" as ViewMode, hydrated: "wysiwyg" as ViewMode },
  ])(
    "WI1-02 once hydrated, setViewMode receives the hydrated $hydrated (store starts $storeStart)",
    async ({ storeStart, hydrated }) => {
      useEditorStore.setState({ viewMode: storeStart });
      const view = mount({ loaded: false, defaultViewMode: "wysiwyg", stored: BASE });
      view.rerender({ loaded: true, defaultViewMode: hydrated, stored: BASE });
      await flush();

      expect(vmHistory).toEqual([hydrated]);
      expect(useEditorStore.getState().viewMode).toBe(hydrated);
    },
  );

  it.each([
    {
      row: "a",
      query: "/?open=%2Ftmp%2Fx.md",
      stored: BASE,
      expected: ["/tmp/x.md", "/base/one.md", "/base/two.md"],
    },
    {
      row: "b",
      query: "/?open=%2Fbase%2Ftwo.md",
      stored: BASE,
      expected: ["/base/two.md", "/base/one.md"],
    },
    {
      row: "c",
      query: "/?open=%2Ftmp%2Fx.md",
      stored: TEN,
      expected: ["/tmp/x.md", ...TEN.slice(0, 9)],
    },
  ])(
    "WI1-03 ($row) the recentFiles write prepends the opened path and conserves the stored list",
    async ({ query, stored, expected }) => {
      window.history.replaceState({}, "", query);
      const view = mount({ loaded: false, defaultViewMode: "wysiwyg", stored });
      await flush();
      view.rerender({ loaded: true, defaultViewMode: "wysiwyg", stored });
      await flush();

      expect(callsFor("set_preferences").map((c) => c[1])).toEqual([
        { preferences: { recentFiles: expected } },
      ]);
      expect(view.result.current.recentFiles).toEqual(expected);
    },
  );

  it("WI1-04 exactly one open and one setViewMode per mount while identities churn", async () => {
    let release!: () => void;
    openControl.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = mount({ loaded: true, defaultViewMode: "source", stored: BASE });
    for (let i = 0; i < 5 && callsFor("open_file").length === 0; i += 1) await flush();
    expect(callsFor("open_file")).toHaveLength(1);

    for (const mode of ["wysiwyg", "source", "wysiwyg"] as ViewMode[]) {
      view.rerender({ loaded: true, defaultViewMode: mode, stored: BASE });
      await flush();
    }
    await act(async () => {
      release();
    });
    await flush();
    for (const mode of ["wysiwyg", "source"] as ViewMode[]) {
      view.rerender({ loaded: true, defaultViewMode: mode, stored: BASE });
      await flush();
    }

    expect(callsFor("open_file")).toHaveLength(1);
    expect(callsFor("set_preferences")).toHaveLength(1);
    expect(
      useDocumentStore.getState().documents.filter((d) => d.path === "/tmp/x.md"),
    ).toHaveLength(1);
    expect(
      logPayloads("file.open.url_param").filter((p) => p.status === "start"),
    ).toHaveLength(1);
    expect(window.location.search).toBe("");
    expect(vmHistory).toEqual(["source"]);
    expect(useEditorStore.getState().viewMode).toBe("source");
    expect(useEditorStore.getState().activeDocumentId).toBe("d1");
  });

  it("WI1-05 control: already hydrated at mount, opens once, clears the query, logs start and success", async () => {
    window.history.replaceState({}, "", "/?open=%2Ftmp%2Fmy%20file.md");
    mount({ loaded: true, defaultViewMode: "source", stored: [] });
    await flush();
    await flush();

    const opens = callsFor("open_file");
    expect(opens).toHaveLength(1);
    expect((opens[0][1] as { path: string }).path).toBe("/tmp/my file.md");
    expect(window.location.search).toBe("");
    const logs = logPayloads("file.open.url_param");
    const actionId = logs[0]?.actionId;
    expect(typeof actionId).toBe("string");
    expect(logs).toEqual([
      {
        level: "info",
        event: "file.open.url_param",
        status: "start",
        actionId,
        context: { windowLabel: "mdpro-abc", fileBasename: "my file.md" },
      },
      {
        level: "info",
        event: "file.open.url_param",
        status: "success",
        actionId,
        context: {
          windowLabel: "mdpro-abc",
          fileBasename: "my file.md",
          documentId: "d1",
          hasContent: true,
        },
        error: undefined,
      },
    ]);
  });

  it("WI1-06 no ?open= param: one url_param_check log with hasOpenParam false, nothing opened or written", async () => {
    window.history.replaceState({}, "", "/");
    const view = mount({ loaded: false, defaultViewMode: "wysiwyg", stored: BASE });
    await flush();
    view.rerender({ loaded: true, defaultViewMode: "wysiwyg", stored: BASE });
    await flush();
    for (const mode of ["source", "wysiwyg"] as ViewMode[]) {
      view.rerender({ loaded: true, defaultViewMode: mode, stored: BASE });
      await flush();
    }

    const checks = logPayloads("app.url_param_check");
    expect(checks).toHaveLength(1);
    expect(checks[0].context).toEqual({ windowLabel: "mdpro-abc", hasOpenParam: false });
    expect(callsFor("open_file")).toHaveLength(0);
    expect(callsFor("set_preferences")).toHaveLength(0);
    expect(vmHistory).toEqual([]);
  });

  it("WI1-07 the open fails: one fail log, no recentFiles write, and the query still cleared", async () => {
    openControl.error = new Error("ENOENT");
    mount({ loaded: true, defaultViewMode: "source", stored: BASE });
    await flush();
    await flush();

    const fails = logPayloads("file.open.url_param").filter((p) => p.status === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0].level).toBe("error");
    expect(fails[0].error).toBe("openDocumentFromPath returned null");
    expect(callsFor("set_preferences")).toHaveLength(0);
    expect(window.location.search).toBe("");
    expect(useEditorStore.getState().viewMode).toBe("source");
  });

  it("WI1-08 log contexts carry no new path-bearing keys", async () => {
    const allowed = new Set(["windowLabel", "hasOpenParam", "fileBasename", "documentId", "hasContent"]);
    const eventsOfHook = new Set(["app.url_param_check", "file.open.url_param"]);

    // WI1-05 setup: open success.
    window.history.replaceState({}, "", "/?open=%2Ftmp%2Fmy%20file.md");
    const a = mount({ loaded: true, defaultViewMode: "source", stored: [] });
    await flush();
    await flush();
    a.unmount();
    // WI1-06 setup: no param.
    window.history.replaceState({}, "", "/");
    const b = mount({ loaded: false, defaultViewMode: "wysiwyg", stored: BASE });
    await flush();
    b.rerender({ loaded: true, defaultViewMode: "wysiwyg", stored: BASE });
    await flush();

    const payloads = logPayloads().filter((p) => eventsOfHook.has(p.event as string));
    expect(payloads.length).toBeGreaterThanOrEqual(4);
    for (const p of payloads) {
      const context = (p.context ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(context)) expect(allowed.has(key)).toBe(true);
      expect(Object.values(context)).not.toContain("/tmp/my file.md");
    }
  });
});
