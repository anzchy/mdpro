/**
 * D138 WI-1: Reload after Save As adds a duplicate tab, and a later ⌘S in the original
 * tab overwrites the reloaded external edit.
 *
 * Device record: docs/test/20261011-watcher-819fa2c-device-check.md, W8. An Untitled
 * document keeps its UUID when ⌘S takes it through Save As; `reload_file` answers with a
 * Document under the path-derived id, and `replaceDocument` upserted it as a second tab.
 *
 * The reload is driven through `reloadActiveFromDisk`, the body `App.handleReloadFile`
 * runs, with the real `useDocument().replaceDocument`, the real stores and the real
 * `saveActiveDocument`. Boundary only: `invoke`, the `@tauri-apps/api/{event,window}` bus
 * and `loggingService`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { saveActiveDocument } from "../src/services/documentSave";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";
import { reloadActiveFromDisk, reloadedInPlace } from "../src/utils/reloadTarget";

const TOC_INITIAL = useTOCStore.getState();
const UUID = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a5b";
const W8_PATH = "/x/w8-new.md";
const PATH_ID = "path-derived-w8";
const SAVED_AT = 1_760_000_000_000;

function doc(overrides: Partial<Document> & { id: string }): Document {
  return {
    path: null,
    content: "",
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...overrides,
  };
}

/** What `reload_file` answers for `path`: always under the path-derived id. */
const reloadedFromDisk = (path: string, content: string): Document =>
  doc({ id: PATH_ID, path, content, lastSaved: SAVED_AT, fileSize: content.length });

const docs = () => useDocumentStore.getState().documents;
const byId = (id: string) => docs().find((d) => d.id === id);
const calls = (cmd: string) =>
  invokeMock.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args as Record<string, unknown>);
const reloadLogs = () =>
  vi.mocked(loggingService.logEventSync).mock.calls.map(([e]) => e).filter((e) => e.event === "file.reload");
const generation = (id: string) => useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;

function routeInvoke(reloadContent: string): void {
  invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case "save_file_dialog":
        return { success: true, path: W8_PATH, savedAt: SAVED_AT };
      case "save_file":
        return { success: true, path: args.path, savedAt: SAVED_AT + 1 };
      case "reload_file":
        return reloadedFromDisk(String(args.path), reloadContent);
      default:
        return undefined;
    }
  });
}

function mountReplace(): (document: Document) => void {
  const { result } = renderHook(() => useDocument());
  return result.current.replaceDocument;
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.mocked(loggingService.logEventSync).mockClear();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
  useEditorStore.setState({ viewMode: "source" });
  useTOCStore.setState(TOC_INITIAL, true);
});

afterEach(() => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D138 (a) a document first saved through Save As reloads in place", () => {
  it("keeps one tab under the UUID, takes the disk bytes, and a later ⌘S keeps them", async () => {
    useDocumentStore.setState({
      documents: [doc({ id: UUID, content: "D69 new", isModified: true })],
      activeDocumentId: UUID,
    });
    routeInvoke("D69 newx");
    const replaceDocument = mountReplace();

    await act(async () => {
      await saveActiveDocument();
    });
    expect(calls("save_file_dialog")).toHaveLength(1);
    expect(byId(UUID)).toMatchObject({ path: W8_PATH, isModified: false });
    const generationBefore = generation(UUID);

    let outcome: unknown;
    await act(async () => {
      outcome = await reloadActiveFromDisk(W8_PATH, replaceDocument);
    });

    expect(outcome).toEqual({ kind: "reloaded", documentId: UUID });
    expect(docs()).toHaveLength(1);
    expect(byId(PATH_ID)).toBeUndefined();
    expect(useDocumentStore.getState().activeDocumentId).toBe(UUID);
    expect(byId(UUID)).toMatchObject({ path: W8_PATH, content: "D69 newx", isModified: false });
    expect(generation(UUID)).toBe(generationBefore + 1);
    expect(generation(PATH_ID)).toBe(0);
    expect(reloadLogs()).toEqual([
      expect.objectContaining({
        status: "success",
        context: { documentId: UUID, reloadedId: PATH_ID },
      }),
    ]);

    act(() => {
      useDocumentStore.getState().updateDocumentContent(UUID, "D69 newx\ntyped after reload");
    });
    await act(async () => {
      await saveActiveDocument();
    });
    const saves = calls("save_file");
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ documentId: UUID, path: W8_PATH });
    expect(String(saves[0].content)).toContain("D69 newx");
  });
});

describe("D138 (b) a document opened by path still reloads in place", () => {
  it("replaces the content under its own (path-derived) id and logs no reloadedId", async () => {
    useDocumentStore.setState({
      documents: [
        doc({ id: "other", path: "/x/other.md", content: "OTHER" }),
        doc({ id: PATH_ID, path: W8_PATH, content: "old bytes", lastSaved: 1 }),
      ],
      activeDocumentId: PATH_ID,
    });
    routeInvoke("new bytes");
    const replaceDocument = mountReplace();

    let outcome: unknown;
    await act(async () => {
      outcome = await reloadActiveFromDisk(W8_PATH, replaceDocument);
    });

    expect(outcome).toEqual({ kind: "reloaded", documentId: PATH_ID });
    expect(docs().map((d) => d.id)).toEqual(["other", PATH_ID]);
    expect(byId(PATH_ID)).toMatchObject({ content: "new bytes", isModified: false, lastSaved: SAVED_AT });
    expect(byId("other")).toMatchObject({ content: "OTHER" });
    expect(generation(PATH_ID)).toBe(1);
    expect(reloadLogs()).toEqual([
      expect.objectContaining({ status: "success", context: { documentId: PATH_ID } }),
    ]);
  });
});

describe("D138 (c) no target: nothing is added", () => {
  it("does not add a document when no open document has the event's path", async () => {
    const before = [doc({ id: "kept", path: "/x/kept.md", content: "KEPT" })];
    useDocumentStore.setState({ documents: before, activeDocumentId: "kept" });
    routeInvoke("ghost bytes");
    const replaceDocument = mountReplace();

    let outcome: unknown;
    await act(async () => {
      outcome = await reloadActiveFromDisk(W8_PATH, replaceDocument);
    });

    expect(outcome).toEqual({ kind: "no-target" });
    expect(docs()).toEqual(before);
    expect(calls("reload_file")).toHaveLength(0);
    expect(reloadLogs()).toEqual([expect.objectContaining({ status: "cancel" })]);
  });

  it("does not reload a document with the path that is no longer the active one", async () => {
    const before = [
      doc({ id: UUID, path: W8_PATH, content: "stale" }),
      doc({ id: "now-active", path: "/x/b.md", content: "B" }),
    ];
    useDocumentStore.setState({ documents: before, activeDocumentId: "now-active" });
    routeInvoke("new bytes");
    const replaceDocument = mountReplace();

    let outcome: unknown;
    await act(async () => {
      outcome = await reloadActiveFromDisk(W8_PATH, replaceDocument);
    });

    expect(outcome).toEqual({ kind: "no-target" });
    expect(docs()).toEqual(before);
    expect(calls("reload_file")).toHaveLength(0);
  });

  it("does not resurrect the target when its tab is closed while reload_file is pending", async () => {
    useDocumentStore.setState({
      documents: [
        doc({ id: UUID, path: W8_PATH, content: "stale" }),
        doc({ id: "b", path: "/x/b.md", content: "B" }),
      ],
      activeDocumentId: UUID,
    });
    let release!: (value: Document) => void;
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "reload_file" ? new Promise<Document>((resolve) => { release = resolve; }) : Promise.resolve(undefined),
    );
    const replaceDocument = mountReplace();

    let pending!: Promise<unknown>;
    act(() => {
      pending = reloadActiveFromDisk(W8_PATH, replaceDocument);
    });
    act(() => {
      useDocumentStore.getState().closeDocument(UUID);
    });
    let outcome: unknown;
    await act(async () => {
      release(reloadedFromDisk(W8_PATH, "late bytes"));
      outcome = await pending;
    });

    expect(outcome).toEqual({ kind: "no-target" });
    expect(docs().map((d) => d.id)).toEqual(["b"]);
  });

  it("rethrows a failed reload_file, leaves the store alone, and logs the failure", async () => {
    const before = [doc({ id: UUID, path: W8_PATH, content: "stale" })];
    useDocumentStore.setState({ documents: before, activeDocumentId: UUID });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "reload_file") throw new Error("disk gone");
      return undefined;
    });
    const replaceDocument = mountReplace();

    await act(async () => {
      await expect(reloadActiveFromDisk(W8_PATH, replaceDocument)).rejects.toThrow("disk gone");
    });

    expect(docs()).toEqual(before);
    expect(reloadLogs()).toEqual([
      expect.objectContaining({ status: "fail", context: expect.objectContaining({ documentId: UUID }) }),
    ]);
  });
});

describe("D138 (d) reloadedInPlace", () => {
  const target = doc({
    id: UUID,
    path: W8_PATH,
    content: "stale",
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: true,
    lastSaved: 1,
    fileSize: 5,
  });

  it("keeps the target's id and takes the reloaded content, encoding, line ending and clean state", () => {
    const reloaded = doc({
      id: PATH_ID,
      path: W8_PATH,
      content: "fresh\r\n",
      encoding: "GBK",
      lineEnding: "crlf",
      isModified: false,
      lastSaved: SAVED_AT,
      fileSize: 7,
    });

    expect(reloadedInPlace(target, reloaded)).toEqual({
      id: UUID,
      path: W8_PATH,
      content: "fresh\r\n",
      encoding: "GBK",
      lineEnding: "crlf",
      isModified: false,
      lastSaved: SAVED_AT,
      fileSize: 7,
    });
  });

  it("is clean even if the reload result claims otherwise, and mutates neither input", () => {
    const reloaded = doc({ id: PATH_ID, path: W8_PATH, content: "fresh", isModified: true });
    const targetCopy = { ...target };
    const reloadedCopy = { ...reloaded };

    const out = reloadedInPlace(target, reloaded);

    expect(out.isModified).toBe(false);
    expect(out.id).toBe(UUID);
    expect(target).toEqual(targetCopy);
    expect(reloaded).toEqual(reloadedCopy);
  });
});
