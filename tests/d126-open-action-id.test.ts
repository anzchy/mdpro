/**
 * D126 — every external open carries one actionId from its entry to the read.
 *
 * Before D126, `openPaths` (Finder `file:open`, cold-launch paths) called
 * `openPathOutcome(path)` with no actionId, so `open_file` and the guard's
 * `file.open.*` logs could not be joined to anything; and the open-in-window route
 * generated a fresh actionId for every log line and passed none to the read.
 *
 * Decided behaviour:
 * - `openPaths` generates one actionId per path with `loggingService.generateActionId()`
 *   and passes it to `openPathOutcome`; each path's id is its own.
 * - The open-in-window handler generates one actionId per event at its entry; the
 *   `file.open.route` outcome log and the `open_file` read of an `opened-path` route
 *   carry that same id.
 *
 * ── SPEC LEVEL: BEHAVIOUR ───────────────────────────────────────────────────
 * Mock boundary: `@tauri-apps/api/{core,event,window,webviewWindow}` and the
 * `loggingService` sink (whose ids count up, so two ids that should match are not
 * equal by accident). `useDocument`, the open-write guard and the stores are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { listeners, invokeMock, sink } = vi.hoisted(() => {
  let n = 0;
  return {
    listeners: new Map<string, Set<Cb>>(),
    invokeMock: vi.fn(),
    sink: {
      generateActionId: vi.fn(() => `gen-${++n}`),
      logEvent: vi.fn(async () => {}),
      logEventSync: vi.fn(),
      logUiEvent: vi.fn(() => "ui-id"),
      logDialogAction: vi.fn(),
    },
  };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "mdpro-a",
    listen: async (name: string, cb: Cb) => {
      const set = listeners.get(name) ?? new Set<Cb>();
      set.add(cb);
      listeners.set(name, set);
      return () => set.delete(cb);
    },
  }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "mdpro-a" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useDocument } from "../src/hooks/useDocument";
import { useOpenInWindow } from "../src/hooks/useOpenInWindow";
import { useOpenPaths } from "../src/hooks/useOpenPaths";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

const LABEL = "mdpro-a";
const EVENT = "file:open-in-window";

function doc(id: string, p: string): Document {
  return { id, path: p, content: `c-${id}`, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}

type LogPayload = { event: string; status: string; actionId?: string; context?: Record<string, unknown> };
const logs = (event: string): LogPayload[] =>
  sink.logEventSync.mock.calls.map(([p]) => p as LogPayload).filter((p) => p.event === event);
const readIds = (): Array<string | undefined> =>
  invokeMock.mock.calls.filter(([cmd]) => cmd === "open_file").map(([, a]) => (a as { actionId?: string }).actionId);

let cleanups: Array<() => void> = [];
function installFlusher(documentId: string, status: "failed" | "clean"): void {
  cleanups.push(useMilkdownEditorStore.getState().registerFlusher(documentId, () => ({ status })));
}

/** `open_file` decodes each listed document by its path; any other path is too large. */
function answerOpens(...decoded: Document[]): void {
  invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd !== "open_file") return null;
    const hit = decoded.find((d) => d.path === args?.path);
    if (!hit) throw { FileTooLarge: { path: args?.path, size: 10485761 } };
    return { document: hit, recoveredDraft: null };
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function emit(payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(listeners.get(EVENT) ?? [])]) cb({ payload });
  });
  await settle();
}

beforeEach(() => {
  listeners.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  sink.logEventSync.mockClear();
  sink.generateActionId.mockClear();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
  useEditorStore.setState({ activeDocumentId: "doc-a", viewMode: "wysiwyg" });
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

describe("D126 openPaths (file:open, launch paths)", () => {
  it("each path's read carries its own generated actionId", async () => {
    installFlusher("doc-a", "clean");
    answerOpens(doc("doc-n", "/tmp/n.md"), doc("doc-m", "/tmp/m.md"));
    const { result } = renderHook(() => {
      const { openPathOutcome } = useDocument();
      return useOpenPaths({
        openPathOutcome,
        updateRecentFiles: () => {},
        setBusyLabel: () => {},
        defaultViewMode: "source",
        setViewMode: () => {},
      });
    });
    await act(async () => {
      await result.current.openPaths(["/tmp/n.md", "/tmp/big.md", "/tmp/m.md"]);
    });
    const ids = readIds();
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(id).toMatch(/^gen-\d+$/);
    expect(new Set(ids).size).toBe(3);
  });

  it("the guard's file.open log for a path carries that path's read actionId", async () => {
    installFlusher("doc-a", "clean");
    useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
    answerOpens(doc("doc-a", "/tmp/a.md"));
    const { result } = renderHook(() => {
      const { openPathOutcome } = useDocument();
      return useOpenPaths({
        openPathOutcome,
        updateRecentFiles: () => {},
        setBusyLabel: () => {},
        defaultViewMode: "source",
        setViewMode: () => {},
      });
    });
    await act(async () => {
      await result.current.openPaths(["/tmp/a.md"]);
    });
    const [readId] = readIds();
    expect(readId).toMatch(/^gen-\d+$/);
    expect(logs("file.open.reload_clean").map((p) => p.actionId)).toEqual([readId]);
  });
});

describe("D126 open-in-window route", () => {
  async function mount(): Promise<void> {
    renderHook(() => {
      const { openPathOutcome } = useDocument();
      return useOpenInWindow({ openPathOutcome });
    });
    await settle();
  }

  it("an opened-path route's read and outcome log share the one actionId", async () => {
    installFlusher("doc-a", "clean");
    answerOpens(doc("doc-z", "/tmp/z.md"));
    await mount();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/z.md" });
    const route = logs("file.open.route");
    expect(route).toHaveLength(1);
    expect(route[0].status).toBe("success");
    expect(readIds()).toEqual([route[0].actionId]);
  });

  it("a refused opened-path route's read and outcome log share the one actionId", async () => {
    installFlusher("doc-a", "failed");
    answerOpens(doc("doc-z", "/tmp/z.md"));
    await mount();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/z.md" });
    const route = logs("file.open.route");
    expect(route).toHaveLength(1);
    expect(route[0].context).toMatchObject({ activated: false, reason: "flush-failed" });
    expect(readIds()).toEqual([route[0].actionId]);
  });

  it("a failed opened-path route's read and fail log share the one actionId", async () => {
    answerOpens();
    await mount();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/big.md" });
    const route = logs("file.open.route");
    expect(route).toHaveLength(1);
    expect(route[0].status).toBe("fail");
    expect(readIds()).toEqual([route[0].actionId]);
  });
});
