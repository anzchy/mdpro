// @vitest-environment node
/**
 * Regression tests for issue #6:
 * "bug(wysiwyg): editor content not synced to document store — Cmd+S discards edits"
 *
 * Root cause: MilkdownEditor.tsx had no listener plugin, so updateDocumentContent
 * was never called when the user typed in WYSIWYG mode.
 *
 * These tests verify that the store mechanism the fix relies on works correctly.
 * The integration (Milkdown listener → store) is verified by manual QA.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../src/stores/documentStore";
import type { Document } from "../src/types/document";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

const makeDoc = (overrides: Partial<Document> = {}): Document => ({
  id: "doc-1",
  content: "# Original",
  path: null,
  encoding: "utf-8",
  lineEnding: "lf",
  isModified: false,
  lastSaved: null,
  fileSize: null,
  ...overrides,
});

describe("documentStore — WYSIWYG content sync (regression #6)", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
  });

  it("updateDocumentContent sets new content and marks document as modified", () => {
    const doc = makeDoc();
    useDocumentStore.setState({ documents: [doc], activeDocumentId: "doc-1" });

    const { updateDocumentContent } = useDocumentStore.getState();
    updateDocumentContent("doc-1", "# Edited by WYSIWYG");

    const updated = useDocumentStore.getState().documents.find((d) => d.id === "doc-1");
    expect(updated?.content).toBe("# Edited by WYSIWYG");
    expect(updated?.isModified).toBe(true);
  });

  it("getActiveDocument returns updated content after WYSIWYG edit", () => {
    const doc = makeDoc();
    useDocumentStore.setState({ documents: [doc], activeDocumentId: "doc-1" });

    const { updateDocumentContent, getActiveDocument } = useDocumentStore.getState();
    updateDocumentContent("doc-1", "# Updated content");

    const active = getActiveDocument();
    expect(active?.content).toBe("# Updated content");
    expect(active?.isModified).toBe(true);
  });

  it("does not modify other documents when updating active document", () => {
    const docs = [
      makeDoc({ id: "doc-1", content: "doc1 original" }),
      makeDoc({ id: "doc-2", content: "doc2 original" }),
    ];
    useDocumentStore.setState({ documents: docs, activeDocumentId: "doc-1" });

    const { updateDocumentContent } = useDocumentStore.getState();
    updateDocumentContent("doc-1", "doc1 edited");

    const doc2 = useDocumentStore.getState().documents.find((d) => d.id === "doc-2");
    expect(doc2?.content).toBe("doc2 original");
    expect(doc2?.isModified).toBe(false);
  });

  it("successive WYSIWYG edits always reflect the latest content", () => {
    const doc = makeDoc();
    useDocumentStore.setState({ documents: [doc], activeDocumentId: "doc-1" });

    const { updateDocumentContent } = useDocumentStore.getState();
    updateDocumentContent("doc-1", "edit 1");
    updateDocumentContent("doc-1", "edit 2");
    updateDocumentContent("doc-1", "edit 3");

    const updated = useDocumentStore.getState().documents.find((d) => d.id === "doc-1");
    expect(updated?.content).toBe("edit 3");
    expect(updated?.isModified).toBe(true);
  });

  it("updateDocumentContent with empty string clears content", () => {
    const doc = makeDoc({ content: "# Has content" });
    useDocumentStore.setState({ documents: [doc], activeDocumentId: "doc-1" });

    const { updateDocumentContent } = useDocumentStore.getState();
    updateDocumentContent("doc-1", "");

    const updated = useDocumentStore.getState().documents.find((d) => d.id === "doc-1");
    expect(updated?.content).toBe("");
    expect(updated?.isModified).toBe(true);
  });
});
