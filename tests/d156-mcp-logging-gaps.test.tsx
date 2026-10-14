/**
 * D156 — three MCP logging gaps, closed with the D153 pattern: Rust logs
 * `stage: "scheduled"` under an action id it mints and carries on the event
 * payload as `action_id`; the frontend logs `stage: "applied"` under that same
 * id (a generated one when an older emitter sent none).
 *
 * ① `processInsertContentEvent`: the document is gone after the WYSIWYG flush
 *    → one `mcp.insert` fail line (it used to return silently).
 * ② `mcp:create_document` → `mcp.create` applied success / fail lines.
 * ③ `mcp:write_document` → `mcp.write` applied success and fail lines.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window,webviewWindow}` and the
 * `loggingService` sink. Every store and hook is real; events are delivered
 * through the hook's own `listen` registrations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { processInsertContentEvent, type InsertContentEvent } from "../src/hooks/mcpInsertContent";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

const RUST_ID = "rust-minted-d156";

type LogPayload = {
  level: string;
  event: string;
  status: string;
  actionId?: string;
  context?: Record<string, unknown>;
};
const logs = (event: string): LogPayload[] =>
  sink.logEventSync.mock.calls.map(([p]) => p as LogPayload).filter((p) => p.event === event);

function doc(id: string, content = `c-${id}`): Document {
  return { id, path: null, content, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}
const contentOf = (id: string) => useDocumentStore.getState().getDocumentById(id)?.content;

let cleanups: Array<() => void> = [];

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function emit(name: string, payload: unknown): Promise<void> {
  await settle();
  await act(async () => {
    for (const cb of [...(listeners.get(name) ?? [])]) cb({ payload });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  listeners.clear();
  sink.logEventSync.mockClear();
  sink.generateActionId.mockClear();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [doc("doc-a"), doc("doc-b")], activeDocumentId: "doc-a" });
  useEditorStore.setState({ activeDocumentId: "doc-a", viewMode: "source", editorView: null });
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  useToastStore.getState().clearToast();
});

describe("D156-① insert_content: the document vanished during the flush", () => {
  it("I1 logs one mcp.insert fail line with stage applied, the payload's id and a reason, and changes nothing", () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    // The flush itself succeeds, but the document is gone by the re-read.
    cleanups.push(
      useMilkdownEditorStore.getState().registerFlusher("doc-a", () => {
        useDocumentStore.setState({ documents: [doc("doc-b")] });
        return { status: "clean" };
      }),
    );
    const event: InsertContentEvent & { action_id?: string } = {
      document_id: "doc-a",
      text: "X",
      position: "end",
      window_label: null,
      action_id: RUST_ID,
    };

    processInsertContentEvent(event, {
      currentWindowLabel: "main",
      updateDocumentContent: (id, c) => useDocumentStore.getState().updateDocumentContent(id, c),
    });

    expect(logs("mcp.insert")).toEqual([
      {
        level: "warn",
        event: "mcp.insert",
        status: "fail",
        actionId: RUST_ID,
        context: { documentId: "doc-a", stage: "applied", reason: "not found after flush" },
      },
    ]);
    expect(contentOf("doc-b")).toBe("c-doc-b");
  });
});

describe("D156-③ mcp:write_document logs the applied stage under Rust's action id", () => {
  const write = (overrides: Record<string, unknown> = {}) => ({
    document_id: "doc-b",
    content: "new body",
    window_label: null,
    action_id: RUST_ID,
    ...overrides,
  });

  it("W1 a write that applies logs one success line with stage applied and the payload's id", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:write_document", write());

    expect(contentOf("doc-b")).toBe("new body");
    expect(logs("mcp.write")).toEqual([
      {
        level: "info",
        event: "mcp.write",
        status: "success",
        actionId: RUST_ID,
        context: { documentId: "doc-b", stage: "applied" },
      },
    ]);
  });

  it("W2 a write to a missing document logs its fail line with the same stage and id", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:write_document", write({ document_id: "doc-missing" }));

    expect(logs("mcp.write")).toEqual([
      {
        level: "warn",
        event: "mcp.write",
        status: "fail",
        actionId: RUST_ID,
        context: { documentId: "doc-missing", stage: "applied", reason: "not found" },
      },
    ]);
  });

  it("W3 an event without action_id (older emitter) falls back to a generated id", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:write_document", write({ action_id: undefined }));

    const lines = logs("mcp.write");
    expect(lines).toHaveLength(1);
    expect(lines[0].actionId).toBe("generated-id");
    expect(lines[0].context).toEqual({ documentId: "doc-b", stage: "applied" });
  });

  it("W4 a foreign-window write logs nothing and changes nothing", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:write_document", write({ window_label: "other" }));

    expect(logs("mcp.write")).toEqual([]);
    expect(contentOf("doc-b")).toBe("c-doc-b");
  });
});

describe("D156-② mcp:create_document logs the applied stage under Rust's action id", () => {
  const create = (overrides: Record<string, unknown> = {}) => ({
    document_id: "doc-new",
    content: "hello",
    window_label: "main",
    action_id: RUST_ID,
    ...overrides,
  });

  it("C1 a create that opens and activates the tab logs one success line", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create());

    expect(contentOf("doc-new")).toBe("hello");
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-new");
    expect(logs("mcp.create")).toEqual([
      {
        level: "info",
        event: "mcp.create",
        status: "success",
        actionId: RUST_ID,
        context: { documentId: "doc-new", stage: "applied", activated: true },
      },
    ]);
  });

  it("C2 a create whose tab switch is refused (failed flush) logs one fail line naming that", async () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    cleanups.push(
      useMilkdownEditorStore.getState().registerFlusher("doc-a", () => ({ status: "failed" })),
    );
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create());

    // D92: the tab exists but stays inactive.
    expect(contentOf("doc-new")).toBe("hello");
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
    expect(logs("mcp.create")).toEqual([
      {
        level: "warn",
        event: "mcp.create",
        status: "fail",
        actionId: RUST_ID,
        context: { documentId: "doc-new", stage: "applied", created: true, reason: "activation refused" },
      },
    ]);
  });

  it("C3 an event without action_id (older emitter) falls back to a generated id", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create({ action_id: undefined }));

    const lines = logs("mcp.create");
    expect(lines).toHaveLength(1);
    expect(lines[0].actionId).toBe("generated-id");
  });

  it("C4 a foreign-window create logs nothing and opens nothing", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create({ window_label: "other" }));

    expect(logs("mcp.create")).toEqual([]);
    expect(contentOf("doc-new")).toBeUndefined();
  });

  it("C5 the log line never carries the document's content", async () => {
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", create({ content: "secret-body" }));

    expect(JSON.stringify(logs("mcp.create"))).not.toContain("secret-body");
  });
});
