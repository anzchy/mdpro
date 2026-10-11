/**
 * D118 / D125 — an external open routed to a closed tab logs whether the open activated.
 *
 * `useOpenInWindow`'s "tab closed after Rust looked" branch reopens the path. Before
 * D118 it logged `file.open.route` `success` with outcome `opened-path` whenever the
 * open returned a document, with no sign that the D92 flush guard (ADR-0071) wrote the
 * tab but refused to activate it. D118 made that a `fail`; D125 aligned it with
 * `file.open.drop` instead (ADR-0071 decision 3: `success` is the open, `activated` is
 * the activation). The hook takes `useDocument().openPathOutcome` and logs:
 * - activated → `success` `{ outcome: "opened-path", documentId, windowLabel, activated: true }`;
 * - opened but not activated → `success`, same context with `activated: false` and
 *   `reason: "flush-failed"`, no error, and no toast of its own — the store already
 *   showed the one refusal toast;
 * - `null` → `fail` "open returned nothing"; rejection → `fail` with its message; both
 *   with `activated: false` and no reason.
 * The focused-tab refusal opens nothing, so it stays a `fail` (as `tab.switch` does)
 * and carries the same two fields.
 *
 * Mock boundary: `@tauri-apps/api/{webviewWindow,core,event,window}` and the
 * `loggingService` sink. `useDocument`, the open-write guard and every store are real;
 * flusher doubles go through the public `registerFlusher` seam. App's wiring is pinned
 * by source-text inspection (App is never rendered; see
 * tests/large-document-guard-call-site.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { listeners, invokeMock, sink } = vi.hoisted(() => ({
  listeners: new Map<string, Set<Cb>>(),
  invokeMock: vi.fn(),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
}));

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
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

const LABEL = "mdpro-a";
const EVENT = "file:open-in-window";
const TAB_TOAST = "Editor changes could not be captured; stayed on this document";

function doc(id: string, p: string, isModified = false, content = `c-${id}`): Document {
  return { id, path: p, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

type LogPayload = { event: string; status: string; error?: string; context?: Record<string, unknown> };
const routeLogs = (): LogPayload[] =>
  sink.logEventSync.mock.calls.map(([p]) => p as LogPayload).filter((p) => p.event === "file.open.route");
const activeIds = () => [useDocumentStore.getState().activeDocumentId, useEditorStore.getState().activeDocumentId];
const docIds = () => useDocumentStore.getState().documents.map((d) => d.id);

let cleanups: Array<() => void> = [];
function installFlusher(documentId: string, status: "failed" | "clean"): void {
  cleanups.push(useMilkdownEditorStore.getState().registerFlusher(documentId, () => ({ status })));
}

let toasts: string[] = [];
const realShowToast = useToastStore.getState().showToast;

function answerOpen(decoded: Document): void {
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === "open_file" ? { document: decoded, recoveredDraft: null } : null,
  );
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

/**
 * Mounts the real hook pair. Every open callback `useDocument` returns is handed over
 * (through a variable, so the object is not checked for excess keys), so the hook is
 * driven by whichever open it reads.
 */
async function mountReal(): Promise<void> {
  renderHook(() => {
    const options = useDocument();
    return useOpenInWindow(options);
  });
  await settle();
}

beforeEach(() => {
  listeners.clear();
  toasts = [];
  vi.clearAllMocks();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useToastStore.getState().clearToast();
  useToastStore.setState({
    showToast: (message: string, durationMs?: number) => {
      toasts.push(message);
      realShowToast(message, durationMs);
    },
  });
  useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
  useEditorStore.setState({ activeDocumentId: "doc-a", viewMode: "wysiwyg" });
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  useToastStore.getState().clearToast();
  useToastStore.setState({ showToast: realShowToast });
});

describe("D118 — the opened-path route log follows activation", () => {
  it("D118-1 an open that activates logs success opened-path", async () => {
    installFlusher("doc-a", "clean");
    answerOpen(doc("doc-z", "/tmp/z.md"));
    await mountReal();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/z.md" });
    expect(activeIds()).toEqual(["doc-z", "doc-z"]);
    expect(routeLogs()).toHaveLength(1);
    expect(routeLogs()[0]).toMatchObject({
      status: "success",
      context: { outcome: "opened-path", documentId: "doc-z", windowLabel: LABEL, activated: true },
    });
    expect(routeLogs()[0].error).toBeUndefined();
    expect(routeLogs()[0].context).not.toHaveProperty("reason");
    expect(toasts).toEqual([]);
  });

  it("D125-1 an open the flush guard refused to activate logs success, activated false, reason flush-failed, no extra toast", async () => {
    installFlusher("doc-a", "failed");
    answerOpen(doc("doc-z", "/tmp/z.md"));
    await mountReal();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/z.md" });
    expect(docIds()).toContain("doc-z");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    // Same shape as file.open.drop's refusal: a status:fail filter sees neither.
    expect(routeLogs().filter((p) => p.status === "fail")).toHaveLength(0);
    expect(routeLogs()).toHaveLength(1);
    expect(routeLogs()[0]).toMatchObject({
      level: "info",
      status: "success",
      context: {
        outcome: "opened-path",
        documentId: "doc-z",
        windowLabel: LABEL,
        activated: false,
        reason: "flush-failed",
      },
    });
    expect(routeLogs()[0].error).toBeUndefined();
    // The store's refusal toast, once; the route handler adds none.
    expect(toasts).toEqual([TAB_TOAST]);
  });

  it("D118-3 an open that returns nothing logs fail 'open returned nothing'", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_file") throw { FileTooLarge: { path: "/tmp/z.md", size: 10485761 } };
      return null;
    });
    await mountReal();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/z.md" });
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expect(routeLogs()).toHaveLength(1);
    expect(routeLogs()[0]).toMatchObject({
      status: "fail",
      error: "open returned nothing",
      context: { outcome: "opened-path", documentId: "doc-z", windowLabel: LABEL, activated: false },
    });
    expect(routeLogs()[0].context).not.toHaveProperty("reason");
  });

  it("D118-4 a rejected open logs fail with its message", async () => {
    const reject = async (): Promise<never> => {
      throw new Error("boom");
    };
    const options = { openPathOutcome: reject, openDocumentFromPath: reject };
    renderHook(() => useOpenInWindow(options));
    await settle();
    await emit({ windowLabel: LABEL, documentId: "doc-z", path: "/tmp/z.md" });
    expect(routeLogs()).toHaveLength(1);
    expect(routeLogs()[0]).toMatchObject({
      status: "fail",
      error: "boom",
      context: { outcome: "opened-path", documentId: "doc-z", windowLabel: LABEL, activated: false },
    });
    expect(routeLogs()[0].context).not.toHaveProperty("reason");
  });

  it("D118-5 the focused-tab refusal stays fail flush-failed, with activated false and reason (no open)", async () => {
    useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md"), doc("doc-b", "/tmp/b.md")] });
    installFlusher("doc-a", "failed");
    await mountReal();
    await emit({ windowLabel: LABEL, documentId: "doc-b", path: "/tmp/b.md" });
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "open_file")).toHaveLength(0);
    expect(routeLogs()).toHaveLength(1);
    expect(routeLogs()[0]).toMatchObject({
      status: "fail",
      error: "flush-failed",
      context: {
        outcome: "focused-tab",
        documentId: "doc-b",
        windowLabel: LABEL,
        activated: false,
        reason: "flush-failed",
      },
    });
  });

  it("D125-2 a focused tab that activates logs success with activated true and no reason", async () => {
    useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md"), doc("doc-b", "/tmp/b.md")] });
    installFlusher("doc-a", "clean");
    await mountReal();
    await emit({ windowLabel: LABEL, documentId: "doc-b", path: "/tmp/b.md" });
    expect(activeIds()).toEqual(["doc-b", "doc-b"]);
    expect(routeLogs()).toHaveLength(1);
    expect(routeLogs()[0]).toMatchObject({
      status: "success",
      context: { outcome: "focused-tab", documentId: "doc-b", windowLabel: LABEL, activated: true },
    });
    expect(routeLogs()[0].context).not.toHaveProperty("reason");
  });
});

describe("D118 — App wires openPathOutcome into useOpenInWindow (source text)", () => {
  function readApp(): string {
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error("testPath unavailable");
    const src = fs.readFileSync(path.resolve(path.dirname(testPath), "../src/App.tsx"), "utf-8");
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  it("D118-6 the one useOpenInWindow call passes openPathOutcome, not openDocumentFromPath", () => {
    const calls = readApp().match(/useOpenInWindow\(\{[^}]*\}\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\bopenPathOutcome\b/);
    expect(calls[0]).not.toMatch(/\bopenDocumentFromPath\b/);
  });
});
