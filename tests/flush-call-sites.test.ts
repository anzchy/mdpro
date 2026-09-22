/**
 * D15 WI-3 — flush call sites, unit level (no editor mounted).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-163219.md`, cases S-save-flush-failed and
 * V-noflush. The flusher is a double at the registry seam (`registerFlusher`), because
 * forcing a real Milkdown serializer to throw would need a production hook; C14 + R4 pair
 * it with the real `failed` origin. `invoke` and `loggingService` are process boundaries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { ViewMode } from "../src/types/editor";
import type { Document } from "../src/types/document";

function dirtyDoc(id: string, content: string, path: string | null): Document {
  return {
    id,
    path,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: true,
    lastSaved: null,
    fileSize: null,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === "save_file" ? { success: true, path: "/tmp/a.md", savedAt: 1 } : null,
  );
  useDocumentStore.setState({
    documents: [dirtyDoc("doc-a", "BASE", "/tmp/a.md")],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

describe("S-save-flush-failed — a failed flush aborts the save (L-S2)", () => {
  it("never reaches save_file, keeps the doc dirty and surfaces 'Save failed:'", async () => {
    useMilkdownEditorStore.getState().registerFlusher("doc-a", () => ({ status: "failed" }));
    const { result } = renderHook(() => useDocument());
    const showToast = vi.fn();

    await performSave(undefined, {
      markSaveInProgress: vi.fn(),
      saveActiveDocument: result.current.saveActiveDocument,
      updateRecentFiles: vi.fn(),
      showToast,
    });

    const commands = invokeMock.mock.calls.map(([c]) => c);
    expect(commands).not.toContain("save_file");
    const doc = useDocumentStore.getState().documents[0];
    expect(doc.isModified).toBe(true);
    expect(doc.content).toBe("BASE");
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(String(showToast.mock.calls[0][0])).toMatch(/^Save failed:/);
    expect(showToast).not.toHaveBeenCalledWith("Saved");
  });
});

describe("V-noflush — only leaving wysiwyg flushes (L-V2)", () => {
  const MODES: ViewMode[] = ["wysiwyg", "source"];
  type Action = "set-wysiwyg" | "set-source" | "cycle";
  const ACTIONS: Action[] = ["set-wysiwyg", "set-source", "cycle"];

  it("flushes with 'view-mode' exactly when from=wysiwyg and the result is not wysiwyg", () => {
    let expectedCalls = 0;
    for (const from of MODES) {
      for (const action of ACTIONS) {
        const row = `from=${from} action=${action}`;
        useMilkdownEditorStore.setState({ flushers: {} });
        const flusher = vi.fn((_reason: string) => ({ status: "clean" as const }));
        useMilkdownEditorStore.getState().registerFlusher("doc-a", flusher);
        useEditorStore.setState({ viewMode: from });

        if (action === "cycle") useEditorStore.getState().cycleViewMode();
        else useEditorStore.getState().setViewMode(action === "set-source" ? "source" : "wysiwyg");

        const to = useEditorStore.getState().viewMode;
        const shouldFlush = from === "wysiwyg" && to !== "wysiwyg";
        if (shouldFlush) {
          expectedCalls += 1;
          expect(flusher, row).toHaveBeenCalledTimes(1);
          expect(flusher, row).toHaveBeenCalledWith("view-mode");
        } else {
          expect(flusher, row).not.toHaveBeenCalled();
        }
      }
    }
    expect(expectedCalls, "non-vacuity: at least one row expects a flush").toBeGreaterThan(0);
  });
});
