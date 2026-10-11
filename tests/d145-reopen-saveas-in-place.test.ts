/**
 * D145 — re-opening a file whose tab is open and CLEAN, when that tab's id is not the
 * path-derived id (a document that started Untitled keeps its UUID after Save As).
 *
 * Before the fix `commitOpenedDocument` upserted the decoded document under its own
 * (path-derived) id, so Open Recent / ⌘O / drag-and-drop added a second tab on the same
 * file. The fix writes the decoded document in place under the existing tab's id and
 * activates that tab, exactly as a clean same-id re-open already reloads in place.
 *
 * Mock boundary: `@tauri-apps/api/{core,event}` and the `loggingService` recording sink.
 * Every store is real; each is reset with `setState` in `beforeEach`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sink } = vi.hoisted(() => ({
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logShortcut: vi.fn(),
    logMenuSelect: vi.fn(),
    logButtonClick: vi.fn(),
    logDialogAction: vi.fn(),
    getLoggingSettings: vi.fn(async () => ({ enabled: true, level: "info" })),
    hydrateSettings: vi.fn(async () => ({ enabled: true, level: "info" })),
    setLoggingSettings: vi.fn(async (x: unknown) => x),
  },
}));

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { commitOpenedDocument, type OpenWriteReason } from "../src/utils/openWriteGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";

const UUID = "3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b";
const UUID_2 = "9a8b7c6d-1e2f-4a3b-8c5d-6e7f8091a2b3";
const PATH = "/x/w8-new.md";
const PATH_ID = "path-derived-w8-new";

function doc(id: string, p: string | null, content: string, isModified: boolean): Document {
  return {
    id, path: p, content, encoding: "UTF-8", lineEnding: "lf",
    isModified, lastSaved: null, fileSize: null,
  };
}

const other = () => doc("doc-o", "/x/other.md", "other body", false);
const savedAs = (content = "old body", dirty = false) => doc(UUID, PATH, content, dirty);
const decoded = (over: Partial<Document> = {}): Document => ({
  ...doc(PATH_ID, PATH, "fresh", false), fileSize: 5, lastSaved: 42, ...over,
});

function seed(documents: Document[], active = "doc-o"): void {
  useDocumentStore.setState({ documents: structuredClone(documents), activeDocumentId: active });
  useEditorStore.setState({ activeDocumentId: active });
  useMilkdownEditorStore.setState({
    getEditor: () => null, flushers: {}, editorGenerations: { [UUID]: 3, [UUID_2]: 6, "doc-o": 5 },
  });
  useTOCStore.setState({
    entries: [], documentId: null, activeEntryId: null,
    collapsedIds: new Set(), byDocument: new Map(),
  });
}

const docs = () => useDocumentStore.getState().documents;
const docById = (id: string) => docs().find((d) => d.id === id);
const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];

interface LogCall {
  event: string;
  context?: Record<string, unknown>;
}
const logsOf = (event: string): LogCall[] =>
  sink.logEventSync.mock.calls.map((c) => c[0] as LogCall).filter((c) => c.event === event);

beforeEach(() => {
  for (const fn of Object.values(sink)) fn.mockClear();
});

describe("D145 — a clean path match with a different id is reloaded in place", () => {
  it("a. Save As shape, Open Recent: no second tab, the UUID tab is reloaded and active", () => {
    seed([other(), savedAs()]);

    const result = commitOpenedDocument(decoded(), "file-open");

    expect(docs().length).toBe(2);
    expect(docById(PATH_ID)).toBeUndefined();
    expect(docs().filter((d) => d.path === PATH).length).toBe(1);
    expect(docById(UUID)?.content).toBe("fresh");
    expect(docById(UUID)?.isModified).toBe(false);
    expect(docById(UUID)).toEqual({ ...decoded(), id: UUID });
    expect(activeIds()).toEqual([UUID, UUID]);
    expect(result.kind).toBe("written");
    expect(result.document.id).toBe(UUID);
    expect(result).toEqual({ kind: "written", document: { ...decoded(), id: UUID }, largeFile: false });
    expect(useMilkdownEditorStore.getState().editorGenerations[UUID]).toBe(4);
    expect(useMilkdownEditorStore.getState().editorGenerations[PATH_ID]).toBeUndefined();
    expect(docs().map((d) => d.id)).toEqual(["doc-o", UUID]);
  });

  const REASONS: OpenWriteReason[] = ["file-open", "encoding-reopen"];

  it.each(REASONS)("b. entry reason %s: written in place under the UUID", (reason) => {
    seed([other(), savedAs()]);

    const result = commitOpenedDocument(decoded(), reason);

    expect(docs().length).toBe(2);
    expect(docById(PATH_ID)).toBeUndefined();
    expect(docById(UUID)?.content).toBe("fresh");
    expect(activeIds()).toEqual([UUID, UUID]);
    expect(result).toMatchObject({ kind: "written", document: { id: UUID, content: "fresh" } });
  });

  it("c. a dirty path match is focused, nothing is written", () => {
    seed([other(), savedAs("my edits", true)]);

    const result = commitOpenedDocument(decoded(), "file-open");

    expect(result).toEqual({ kind: "focused-dirty", matchedBy: "path", document: savedAs("my edits", true) });
    expect(docs().length).toBe(2);
    expect(docById(PATH_ID)).toBeUndefined();
    expect(docById(UUID)?.content).toBe("my edits");
    expect(docById(UUID)?.isModified).toBe(true);
    expect(activeIds()).toEqual([UUID, UUID]);
    expect(useMilkdownEditorStore.getState().editorGenerations[UUID]).toBe(3);
    expect(logsOf("file.open.reload_clean")).toHaveLength(0);
  });

  it("d. a clean same-id re-open still reloads in place", () => {
    seed([other(), doc(PATH_ID, PATH, "old body", false)]);

    const result = commitOpenedDocument(decoded(), "file-open");

    expect(result).toEqual({ kind: "written", document: decoded(), largeFile: false });
    expect(docs().length).toBe(2);
    expect(docById(PATH_ID)).toEqual(decoded());
    expect(activeIds()).toEqual([PATH_ID, PATH_ID]);
    const logs = logsOf("file.open.reload_clean");
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({ documentId: PATH_ID, entry: "file-open", activated: true });
  });

  it("e. no match: a new document is added under the decoded id", () => {
    seed([other()]);

    const result = commitOpenedDocument(decoded(), "file-open");

    expect(result).toEqual({ kind: "written", document: decoded(), largeFile: false });
    expect(docs().map((d) => d.id)).toEqual(["doc-o", PATH_ID]);
    expect(activeIds()).toEqual([PATH_ID, PATH_ID]);
    expect(logsOf("file.open.reload_clean")).toHaveLength(0);
  });

  it("f. the reload_clean line names the target id, the decoded id and matchedBy path", () => {
    seed([other(), savedAs()]);

    commitOpenedDocument(decoded(), "file-open", { actionId: "act-1" });

    const logs = logsOf("file.open.reload_clean");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actionId: "act-1", status: "success" });
    expect(logs[0].context).toEqual({
      documentId: UUID, entry: "file-open", activated: true,
      decodedId: PATH_ID, matchedBy: "path", pathMatchCount: 1,
    });
    expect(JSON.stringify(logs[0])).not.toContain("fresh");
  });

  it("g. several clean path matches: the first in store order, nothing added", () => {
    seed([other(), savedAs(), doc(UUID_2, PATH, "second body", false)]);

    const result = commitOpenedDocument(decoded(), "file-open");

    expect(result.document.id).toBe(UUID);
    expect(docs().map((d) => d.id)).toEqual(["doc-o", UUID, UUID_2]);
    expect(docById(UUID)?.content).toBe("fresh");
    expect(docById(UUID_2)?.content).toBe("second body");
    expect(activeIds()).toEqual([UUID, UUID]);
    expect(logsOf("file.open.reload_clean")[0].context).toMatchObject({
      documentId: UUID, decodedId: PATH_ID, matchedBy: "path", pathMatchCount: 2,
    });
  });

  it("h. several clean path matches: the active one wins when it is among them", () => {
    seed([other(), savedAs(), doc(UUID_2, PATH, "second body", false)], UUID_2);

    const result = commitOpenedDocument(decoded(), "file-open");

    expect(result.document.id).toBe(UUID_2);
    expect(docs().map((d) => d.id)).toEqual(["doc-o", UUID, UUID_2]);
    expect(docById(UUID_2)?.content).toBe("fresh");
    expect(docById(UUID)?.content).toBe("old body");
    expect(activeIds()).toEqual([UUID_2, UUID_2]);
  });
});
