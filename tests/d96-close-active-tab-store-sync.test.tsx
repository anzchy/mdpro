/**
 * D96 — closing a tab with × (`useDocument.closeDocumentById`, the `onClose` App.tsx
 * hands `BottomTabs`) must leave `documentStore.activeDocumentId` and
 * `editorStore.activeDocumentId` naming the same document, and neither may name the
 * closed one.
 *
 * Real `useDocument` (renderHook), real `documentStore` / `editorStore` /
 * `milkdownEditorStore`. Only `@tauri-apps/api/core` (the `close_document` IPC) and the
 * logging sink are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) =>
    cmd === "close_document" ? { success: true, documentId: args?.documentId } : null,
  ),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

function makeDoc(id: string): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content: `# ${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

/** Three open docs, `active` active in BOTH stores. */
function seed(active: string): void {
  useDocumentStore.setState({
    documents: [makeDoc("doc-a"), makeDoc("doc-b"), makeDoc("doc-c")],
    activeDocumentId: active,
  });
  useEditorStore.setState({ activeDocumentId: active });
}

const ids = () => ({
  documentStore: useDocumentStore.getState().activeDocumentId,
  editorStore: useEditorStore.getState().activeDocumentId,
});

async function closeViaTabX(id: string): Promise<void> {
  const { result } = renderHook(() => useDocument());
  await act(async () => {
    await result.current.closeDocumentById(id, true);
  });
}

beforeEach(() => {
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ activeDocumentId: null });
});

describe("D96 — closeDocumentById keeps the two active-document stores in sync", () => {
  it("D96-T1 closing the ACTIVE middle tab: both stores name the same neighbour, not the closed id", async () => {
    seed("doc-b");
    await closeViaTabX("doc-b");

    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-a", "doc-c"]);
    expect(ids().documentStore).toBe("doc-c");
    expect(ids().editorStore).not.toBe("doc-b");
    expect(ids().editorStore).toBe(ids().documentStore);
  });

  it("D96-T2 closing the ACTIVE last tab: both stores name the previous tab", async () => {
    seed("doc-c");
    await closeViaTabX("doc-c");

    expect(ids().documentStore).toBe("doc-b");
    expect(ids().editorStore).not.toBe("doc-c");
    expect(ids().editorStore).toBe(ids().documentStore);
  });

  it("D96-T3 closing a NON-active tab leaves the active document unchanged in both stores", async () => {
    seed("doc-a");
    await closeViaTabX("doc-c");

    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-a", "doc-b"]);
    expect(ids()).toEqual({ documentStore: "doc-a", editorStore: "doc-a" });
  });

  it("D96-T4 closing the only remaining tab: both stores are null", async () => {
    useDocumentStore.setState({ documents: [makeDoc("doc-a")], activeDocumentId: "doc-a" });
    useEditorStore.setState({ activeDocumentId: "doc-a" });
    await closeViaTabX("doc-a");

    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(ids()).toEqual({ documentStore: null, editorStore: null });
  });
});

describe("D96 — closeActiveDocument (⌘W) keeps the two active-document stores in sync", () => {
  async function closeViaCmdW(): Promise<void> {
    const { result } = renderHook(() => useDocument());
    await act(async () => {
      await result.current.closeActiveDocument(true);
    });
  }

  it("D96-T5 closing the active middle doc: both stores name the same neighbour", async () => {
    seed("doc-b");
    await closeViaCmdW();

    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-a", "doc-c"]);
    expect(ids()).toEqual({ documentStore: "doc-c", editorStore: "doc-c" });
  });

  it("D96-T6 closing the only doc: both stores are null", async () => {
    useDocumentStore.setState({ documents: [makeDoc("doc-a")], activeDocumentId: "doc-a" });
    useEditorStore.setState({ activeDocumentId: "doc-a" });
    await closeViaCmdW();

    expect(ids()).toEqual({ documentStore: null, editorStore: null });
  });
});
