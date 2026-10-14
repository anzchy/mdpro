/**
 * D161: `mcp:create_document` opens its tab in one window only.
 *
 * Rust broadcasts the event and names the owner in `window_label` (the
 * focused window, else the most recently focused one). This window ("main")
 * opens the tab only when the event names it; a null label is refused rather
 * than applied in every window, which is how one create used to open a tab in
 * each of N windows.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window,webviewWindow}` and the
 * `loggingService` sink. Every store and hook is real; events are delivered
 * through the hook's own `listen` registrations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { listeners, sink } = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  sink: {
    generateActionId: vi.fn(() => "generated-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "generated-id"),
    logDialogAction: vi.fn(),
  },
}));

function register(name: string, cb: Cb): Promise<() => void> {
  const set = listeners.get(name) ?? new Set<Cb>();
  set.add(cb);
  listeners.set(name, set);
  return Promise.resolve(() => set.delete(cb));
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: register }),
}));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Cb) => register(name, cb),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { Document } from "../src/types/document";

const RUST_ID = "rust-minted-d161";

type LogPayload = {
  level: string;
  event: string;
  status: string;
  actionId?: string;
  context?: Record<string, unknown>;
};
const logs = (event: string): LogPayload[] =>
  sink.logEventSync.mock.calls.map(([p]) => p as LogPayload).filter((p) => p.event === event);

function doc(id: string): Document {
  return { id, path: null, content: `c-${id}`, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}
const ids = () => useDocumentStore.getState().documents.map((d) => d.id);

async function emit(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
  await act(async () => {
    for (const cb of [...(listeners.get(name) ?? [])]) cb({ payload });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

const create = (window_label: string | null) => ({
  document_id: "doc-new",
  content: "hello",
  window_label,
  action_id: RUST_ID,
});

beforeEach(() => {
  listeners.clear();
  sink.logEventSync.mockClear();
  useDocumentStore.setState({ documents: [doc("doc-a")], activeDocumentId: "doc-a" });
  useEditorStore.setState({ activeDocumentId: "doc-a", viewMode: "source", editorView: null });
});

describe("D161 mcp:create_document opens its tab in the one window it names", () => {
  it("F1 a create with no window label is refused: no tab, one warn line naming why", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create(null));

    expect(ids()).toEqual(["doc-a"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
    expect(logs("mcp.create")).toEqual([
      {
        level: "warn",
        event: "mcp.create",
        status: "fail",
        actionId: RUST_ID,
        context: { documentId: "doc-new", stage: "applied", reason: "no window label" },
      },
    ]);
  });

  it("F2 a create naming another window leaves this window untouched and logs nothing", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create("window-2"));

    expect(ids()).toEqual(["doc-a"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
    expect(logs("mcp.create")).toEqual([]);
  });

  it("F3 a create naming this window opens and activates exactly one tab", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create("main"));

    expect(ids()).toEqual(["doc-a", "doc-new"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-new");
    expect(logs("mcp.create").map((l) => l.status)).toEqual(["success"]);
  });
});
