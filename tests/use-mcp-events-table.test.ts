/**
 * @module use-mcp-events-table.test
 * Purpose: Verify the WYSIWYG-side dispatch of MCP table actions
 * (Phase 3 WI-3.3 plan acceptance + audit H5). When a `mcp:table_action`
 * event fires while WYSIWYG mode is active, the handler must:
 *   1. Compute the new content via `applyMcpTableAction`.
 *   2. Push to documentStore (closing Risk R12).
 *   3. Dispatch into the live Milkdown editor via `replaceAll(...)`.
 *
 * Tests exercise the extracted pure function `processTableActionEvent`
 * — no React renderer required (the hook is just a thin wrapper).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));

const replaceAllMock = vi.fn(
  (markdown: string) => (ctx: unknown) => ({ replacedWith: markdown, ctx }),
);
vi.mock("@milkdown/kit/utils", () => ({
  replaceAll: (markdown: string) => replaceAllMock(markdown),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  processTableActionEvent,
  type TableActionEvent,
} from "../src/hooks/useMcpEvents";

const SIMPLE_MD = "| a | b |\n| - | - |\n| 1 | 2 |\n";

let capturedUpdates: Array<{ id: string; content: string }> = [];
const updateDocumentContent = (id: string, content: string) => {
  capturedUpdates.push({ id, content });
  // Also reflect in store for subsequent reads.
  useDocumentStore.setState((s) => ({
    documents: s.documents.map((d) =>
      d.id === id ? { ...d, content } : d,
    ),
  }));
};

beforeEach(() => {
  capturedUpdates = [];
  replaceAllMock.mockClear();
  useDocumentStore.setState({
    documents: [
      {
        id: "doc-1",
        path: null,
        content: SIMPLE_MD,
        encoding: "UTF-8",
        lineEnding: "lf",
        isModified: false,
        lastSaved: null,
        fileSize: null,
      },
    ],
    activeDocumentId: "doc-1",
  });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
  useMilkdownEditorStore.setState({ getEditor: () => null });
});

afterEach(() => {
  vi.clearAllMocks();
});

function event(
  partial: Partial<TableActionEvent> = {},
): TableActionEvent {
  return {
    document_id: "doc-1",
    action: "set_cell",
    payload: { row: 1, col: 0, content: "X" },
    window_label: "main",
    ...partial,
  };
}

describe("processTableActionEvent — Risk R12 (WYSIWYG live update)", () => {
  it("calls replaceAll on the live Milkdown editor when WYSIWYG is active", () => {
    const actionSpy = vi.fn();
    useMilkdownEditorStore.setState({
      getEditor: () => ({ action: actionSpy }),
    });

    processTableActionEvent(event(), {
      currentWindowLabel: "main",
      updateDocumentContent,
    });

    expect(replaceAllMock).toHaveBeenCalledTimes(1);
    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].content).toContain("X");
  });

  it("does NOT call replaceAll in source mode (the CodeMirror dispatch path runs instead)", () => {
    const actionSpy = vi.fn();
    useMilkdownEditorStore.setState({
      getEditor: () => ({ action: actionSpy }),
    });
    useEditorStore.setState({ viewMode: "source", editorView: null });

    processTableActionEvent(event(), {
      currentWindowLabel: "main",
      updateDocumentContent,
    });

    expect(replaceAllMock).not.toHaveBeenCalled();
    expect(actionSpy).not.toHaveBeenCalled();
    // documentStore IS still updated.
    expect(capturedUpdates).toHaveLength(1);
  });
});

describe("processTableActionEvent — gating", () => {
  it("ignores events for other windows", () => {
    const actionSpy = vi.fn();
    useMilkdownEditorStore.setState({
      getEditor: () => ({ action: actionSpy }),
    });

    processTableActionEvent(event({ window_label: "other-window" }), {
      currentWindowLabel: "main",
      updateDocumentContent,
    });

    expect(replaceAllMock).not.toHaveBeenCalled();
    expect(capturedUpdates).toHaveLength(0);
  });

  it("no-ops on unknown document id", () => {
    processTableActionEvent(event({ document_id: "doc-missing" }), {
      currentWindowLabel: "main",
      updateDocumentContent,
    });

    expect(replaceAllMock).not.toHaveBeenCalled();
    expect(capturedUpdates).toHaveLength(0);
  });

  it("no-ops on invalid payload (out-of-range row)", () => {
    processTableActionEvent(
      event({ action: "delete_row", payload: { index: 99 } }),
      { currentWindowLabel: "main", updateDocumentContent },
    );

    expect(replaceAllMock).not.toHaveBeenCalled();
    expect(capturedUpdates).toHaveLength(0);
  });
});

describe("processTableActionEvent — audit M3 (no false success log)", () => {
  it("returns after Milkdown replaceAll throws — does not reach the success log", async () => {
    // Use the loggingService mock to capture all calls.
    const loggingMod = await import("../src/services/loggingService");
    const logSpy = vi.mocked(loggingMod.loggingService.logEventSync);
    logSpy.mockClear();

    useMilkdownEditorStore.setState({
      getEditor: () => ({
        action: () => {
          throw new Error("simulated milkdown failure");
        },
      }),
    });

    processTableActionEvent(event(), {
      currentWindowLabel: "main",
      updateDocumentContent,
    });

    // Capture all log calls' status fields.
    const statuses = logSpy.mock.calls.map(
      (call) => (call[0] as { status?: string }).status,
    );
    expect(statuses).toContain("fail");
    expect(statuses).not.toContain("success");
  });
});
