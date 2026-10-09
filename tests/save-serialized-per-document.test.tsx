/**
 * D70: two saves of the same document are serialized, and a finished save never
 * reports clean content it did not write.
 *
 * Repro: ⌘S → type → ⌘S. Before the fix both saves were in flight at once; when
 * the older `save_file` landed last, disk held the older text while the store said
 * "saved" (`isModified: false`), so close did not prompt.
 *
 * Boundary: `invoke` (a per-call deferred double below, which also models the disk
 * as "the content of the last `save_file` to resolve"), `loggingService`, and the
 * `@tauri-apps/api/{event,window}` bus. Stores, `useDocument` and `performSave` are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

type Args = Record<string, unknown>;
type Call = { cmd: string; args: Args; resolve: (v: unknown) => void; reject: (e: unknown) => void; settled: boolean };

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { performSave } from "../src/services/saveService";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

const SAVED_AT = 1_700_000_000_000;
const A_PATH = "/tmp/a.md";
const B_PATH = "/tmp/b.md";
const DIALOG_PATH = "/tmp/chosen.md";
const HELD = new Set(["save_file", "save_file_dialog"]);

let calls: Call[] = [];
/** Content of each path as of the last `save_file` to resolve successfully. */
let disk: Record<string, string> = {};

function installInvoke(): void {
  invokeMock.mockReset();
  calls = [];
  disk = {};
  invokeMock.mockImplementation((cmd: string, args: Args = {}) => {
    if (!HELD.has(cmd)) {
      if (cmd === "get_preferences") return Promise.resolve({ markdown: { autoReformatTablesOnSave: false } });
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      calls.push({ cmd, args, resolve, reject, settled: false });
    });
  });
}

const callsOf = (cmd: string) => calls.filter((c) => c.cmd === cmd);
const pending = (cmd: string) => callsOf(cmd).filter((c) => !c.settled);

/** Resolve one held call; a `save_file` success writes its content to the modelled disk. */
async function land(call: Call): Promise<void> {
  await act(async () => {
    call.settled = true;
    if (call.cmd === "save_file") {
      disk[call.args.path as string] = call.args.content as string;
      call.resolve({ success: true, path: call.args.path, savedAt: SAVED_AT });
    } else {
      call.resolve({ success: true, path: DIALOG_PATH, savedAt: SAVED_AT });
    }
    await flushAsync();
  });
}

async function failCall(call: Call, message: string): Promise<void> {
  await act(async () => {
    call.settled = true;
    call.reject(new Error(message));
    await flushAsync();
  });
}

const flushAsync = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flushAsync(); });

function doc(id: string, content: string, path: string | null, isModified: boolean): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

const docById = (id: string) => useDocumentStore.getState().documents.find((d) => d.id === id);
const write = (id: string, content: string) =>
  act(() => { useDocumentStore.getState().updateDocumentContent(id, content); });

function mountApi() {
  const { result } = renderHook(() => useDocument());
  return result;
}

function deps(api: ReturnType<typeof mountApi>, toasts: string[]) {
  return {
    markSaveInProgress: () => {},
    saveActiveDocument: (id?: string) => api.current.saveActiveDocument(id),
    updateRecentFiles: () => {},
    showToast: (m: string) => { toasts.push(m); },
  };
}

beforeEach(() => {
  installInvoke();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(loggingService.logEventSync).mockClear();
  useDocumentStore.setState({
    documents: [doc("doc-a", "V1", A_PATH, true), doc("doc-b", "B1", B_PATH, true)],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "source" });
});

afterEach(async () => {
  // Drain anything still held so no save stays in flight into the next test.
  for (let guard = 0; guard < 10 && calls.some((c) => !c.settled); guard++) {
    for (const c of calls.filter((x) => !x.settled)) await land(c);
  }
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D70 — ⌘S, type, ⌘S on one document", () => {
  it("RED: with the older save landing last whenever possible, the result is honest", async () => {
    const api = mountApi();
    const toasts: string[] = [];
    let s1!: Promise<void>;
    let s2!: Promise<void>;
    await act(async () => { s1 = performSave("a1", deps(api, toasts)); await flushAsync(); });
    expect(callsOf("save_file")).toHaveLength(1);

    await write("doc-a", "V2");
    await act(async () => { s2 = performSave("a2", deps(api, toasts)); await flushAsync(); });

    // Adversarial schedule: if the second save is already in flight, land it first.
    const [first, second] = callsOf("save_file");
    if (second) {
      await land(second);
      await land(first);
    } else {
      await land(first);
      await settle();
      await land(callsOf("save_file")[1]);
    }
    await act(async () => { await Promise.all([s1, s2]); });
    await settle();

    const a = docById("doc-a")!;
    // Honest: either the disk holds what the buffer holds, or the document is dirty.
    expect(disk[A_PATH] === a.content || a.isModified).toBe(true);
  });

  it("the second save waits for the first, then writes the current buffer", async () => {
    const api = mountApi();
    const toasts: string[] = [];
    let s1!: Promise<void>;
    let s2!: Promise<void>;
    await act(async () => { s1 = performSave("a1", deps(api, toasts)); await flushAsync(); });
    await write("doc-a", "V2");
    await act(async () => { s2 = performSave("a2", deps(api, toasts)); await flushAsync(); });

    expect(callsOf("save_file")).toHaveLength(1);
    const queued = vi.mocked(loggingService.logEventSync).mock.calls.filter(([e]) => e.event === "file.save.queued");
    expect(queued).toHaveLength(1);
    expect(queued[0][0].context).toEqual({ documentId: "doc-a" });

    await land(callsOf("save_file")[0]);
    await settle();
    expect(callsOf("save_file")).toHaveLength(2);
    expect(callsOf("save_file")[1].args.content).toBe("V2");
    await land(callsOf("save_file")[1]);
    await act(async () => { await Promise.all([s1, s2]); });

    expect(disk[A_PATH]).toBe("V2");
    expect(docById("doc-a")).toMatchObject({ content: "V2", isModified: false });
    expect(toasts).toEqual(["Saved", "Saved"]);
  });

  it("a failing first save does not wedge the chain", async () => {
    const api = mountApi();
    const toasts: string[] = [];
    let s1!: Promise<void>;
    let s2!: Promise<void>;
    await act(async () => { s1 = performSave("a1", deps(api, toasts)); await flushAsync(); });
    await write("doc-a", "V2");
    await act(async () => { s2 = performSave("a2", deps(api, toasts)); await flushAsync(); });

    await failCall(callsOf("save_file")[0], "disk full");
    await settle();
    expect(callsOf("save_file")).toHaveLength(2);
    await land(callsOf("save_file")[1]);
    await act(async () => { await Promise.all([s1, s2]); });

    expect(toasts).toEqual(["Save failed: disk full", "Saved"]);
    expect(disk[A_PATH]).toBe("V2");
    expect(docById("doc-a")).toMatchObject({ content: "V2", isModified: false });
  });

  it("a queued save writes the document it was requested for, even after a tab switch", async () => {
    const api = mountApi();
    let s1!: Promise<unknown>;
    let s2!: Promise<unknown>;
    await act(async () => { s1 = api.current.saveActiveDocument(); await flushAsync(); });
    await write("doc-a", "V2");
    await act(async () => { s2 = api.current.saveActiveDocument(); await flushAsync(); });
    act(() => { useDocumentStore.getState().setActiveDocumentId("doc-b"); });

    await land(callsOf("save_file")[0]);
    await settle();
    expect(callsOf("save_file")[1].args).toMatchObject({ path: A_PATH, content: "V2" });
    await land(callsOf("save_file")[1]);
    await act(async () => { await Promise.all([s1, s2]); });
    expect(disk[B_PATH]).toBeUndefined();
  });

  it("a queued save of a document closed while it waited does nothing", async () => {
    const api = mountApi();
    let s1!: Promise<unknown>;
    let s2!: Promise<unknown>;
    await act(async () => { s1 = api.current.saveActiveDocument(); await flushAsync(); });
    await act(async () => { s2 = api.current.saveActiveDocument(); await flushAsync(); });
    await act(async () => { await api.current.closeDocumentById("doc-a", true); });

    await land(callsOf("save_file")[0]);
    await settle();
    let out: unknown;
    await act(async () => { await s1; out = await s2; });
    expect(out).toBeNull();
    expect(callsOf("save_file")).toHaveLength(1);
  });
});

describe("D70 — no unnecessary serialization", () => {
  it("a save of a different document is not blocked", async () => {
    const api = mountApi();
    await act(async () => { void api.current.saveActiveDocument(); await flushAsync(); });
    act(() => { useDocumentStore.getState().setActiveDocumentId("doc-b"); });
    await act(async () => { void api.current.saveActiveDocument(); await flushAsync(); });

    expect(pending("save_file").map((c) => c.args.path)).toEqual([A_PATH, B_PATH]);
    const queued = vi.mocked(loggingService.logEventSync).mock.calls.filter(([e]) => e.event === "file.save.queued");
    expect(queued).toHaveLength(0);
  });

  it("Save As of a different document is not blocked", async () => {
    const api = mountApi();
    await act(async () => { void api.current.saveActiveDocument(); await flushAsync(); });
    act(() => { useDocumentStore.getState().setActiveDocumentId("doc-b"); });
    await act(async () => { void api.current.saveActiveDocumentAs(); await flushAsync(); });

    expect(pending("save_file")).toHaveLength(1);
    expect(pending("save_file_dialog")).toHaveLength(1);
    expect(pending("save_file_dialog")[0].args.documentId).toBe("doc-b");
  });

  it("Save As of the same document waits for its in-flight save", async () => {
    const api = mountApi();
    await act(async () => { void api.current.saveActiveDocument(); await flushAsync(); });
    await act(async () => { void api.current.saveActiveDocumentAs(); await flushAsync(); });
    expect(pending("save_file_dialog")).toHaveLength(0);

    await land(callsOf("save_file")[0]);
    await settle();
    expect(pending("save_file_dialog")).toHaveLength(1);
  });
});
