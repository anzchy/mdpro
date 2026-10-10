/**
 * D84-WI-1: a content edit reaches the MCP shadow store even when it keeps the
 * content length.
 *
 * The content-change gate in `useMcpSync` used to key on
 * `id:content.length:isModified`. An edit on an already-dirty document that
 * keeps the length (typing into table-cell padding `| f  |` → `| fk |`,
 * overtyping a selection) left that signature unchanged, so the debounced
 * `mcp_sync_documents` never fired. Source mode masked it through the D36
 * `selectionChange` debounce, so these cases deliberately emit no selection
 * event.
 *
 * Boundaries mocked: `@tauri-apps/api/core` `invoke` (IPC),
 * `@tauri-apps/api/window` (the Tauri process) and the `loggingService` sink.
 * The document and editor stores, `mcpService` and the hook are real.
 * Paired integration: the D84 device check (MCP `read_document` after a
 * same-length WYSIWYG edit), not run by this lane.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invoke, sink } = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { useMcpSync } from "../src/hooks/useMcpSync";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";

/** Mirrors `CONTENT_DEBOUNCE_MS` in src/hooks/useMcpSync.ts. */
const CONTENT_DEBOUNCE_MS = 300;

interface SyncedDoc {
  id: string;
  content: string;
  is_dirty: boolean;
}
interface SyncPayload {
  documents: SyncedDoc[];
}

function makeDoc(id: string, path: string, content: string, isModified: boolean) {
  return { id, path, content, encoding: "utf-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

/** Payloads of every `mcp_sync_documents` call, in order. */
function syncPayloads(): SyncPayload[] {
  return invoke.mock.calls
    .filter((call) => call[0] === "mcp_sync_documents")
    .map((call) => (call[1] as { payload: SyncPayload }).payload);
}

function contentOf(payload: SyncPayload, id: string): string | undefined {
  return payload.documents.find((d) => d.id === id)?.content;
}

/** Mount, let the initial content debounce send, then forget that call. */
async function mountSettled() {
  const view = renderHook(() => useMcpSync());
  await act(async () => {
    vi.advanceTimersByTime(CONTENT_DEBOUNCE_MS);
  });
  invoke.mockClear();
  return view;
}

async function elapseDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(CONTENT_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockImplementation(async () => undefined);
  useEditorStore.setState({ editorView: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D84-WI-1: same-length content edits sync to the shadow store", () => {
  it("dirty active document: a same-length edit syncs once with the new content", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("d1", "/a/one.md", "| f  |", true)] as never,
      activeDocumentId: "d1",
    });
    await mountSettled();

    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "| fk |");
    });
    await elapseDebounce();

    const payloads = syncPayloads();
    expect(payloads).toHaveLength(1);
    expect(contentOf(payloads[0], "d1")).toBe("| fk |");
  });

  it("clean → dirty same-length edit syncs once with the new content", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("d1", "/a/one.md", "| f  |", false)] as never,
      activeDocumentId: "d1",
    });
    await mountSettled();

    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "| fk |");
    });
    await elapseDebounce();

    const payloads = syncPayloads();
    expect(payloads).toHaveLength(1);
    expect(contentOf(payloads[0], "d1")).toBe("| fk |");
    expect(payloads[0].documents[0].is_dirty).toBe(true);
  });

  it("a new documents array with identical values sends no extra IPC", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("d1", "/a/one.md", "| f  |", true)] as never,
      activeDocumentId: "d1",
    });
    await mountSettled();

    act(() => {
      useDocumentStore.setState({
        documents: useDocumentStore.getState().documents.map((d) => ({ ...d })),
      });
    });
    await elapseDebounce();

    expect(syncPayloads()).toHaveLength(0);
  });

  it("two rapid same-length edits within the debounce send one IPC with the last content", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("d1", "/a/one.md", "| f  |", true)] as never,
      activeDocumentId: "d1",
    });
    await mountSettled();

    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "| fk |");
    });
    await act(async () => {
      vi.advanceTimersByTime(CONTENT_DEBOUNCE_MS / 2);
    });
    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "| fz |");
    });
    await elapseDebounce();

    const payloads = syncPayloads();
    expect(payloads).toHaveLength(1);
    expect(contentOf(payloads[0], "d1")).toBe("| fz |");
  });

  it("a same-length edit in a dirty non-active document also syncs", async () => {
    useDocumentStore.setState({
      documents: [
        makeDoc("d1", "/a/one.md", "active", true),
        makeDoc("d2", "/a/two.md", "| f  |", true),
      ] as never,
      activeDocumentId: "d1",
    });
    await mountSettled();

    act(() => {
      useDocumentStore.getState().updateDocumentContent("d2", "| fk |");
    });
    await elapseDebounce();

    const payloads = syncPayloads();
    expect(payloads).toHaveLength(1);
    expect(contentOf(payloads[0], "d2")).toBe("| fk |");
    expect(contentOf(payloads[0], "d1")).toBe("active");
  });
});
