/**
 * D41 WI-1 (BLOCK): the real ⌘S format-on-save path and the real
 * `mcp:table_action` hook path move a cell into the wrong column when a body
 * row starts with a blank cell.
 *
 * On af51749 `parseRowCells("| | x |")` returns x in column 0, so
 * `useDocument.saveActiveDocument` with `autoReformatTablesOnSave` writes
 * `| x   |     |` to disk, and MCP `set_cell(row 1, col 0, "y")` overwrites x.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261002-D41.md` cases C1-SAVE-LEAD,
 * C1-SAVE-OFF, C1-MCP-HOOK (round-2 "Minor": `performSave` is not on this path).
 *
 * Boundary: `@tauri-apps/api/core` `invoke` (through `tests/helpers/heldInvoke.ts`),
 * plus the `@tauri-apps/api/{event,window}` bus. `useDocument`, `useMcpEvents`,
 * `preferencesService`, `fileService`, `formatAllTables`, `loggingService` and the
 * stores are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";

const { invokeMock, listeners } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listeners: {} as Record<string, (event: { payload: unknown }) => void>,
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners[name] = handler;
    return () => {};
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { useDocument } from "../src/hooks/useDocument";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";
import { A_PATH, SAVED_AT, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const TOC_INITIAL = useTOCStore.getState();
const LEAD = "| h1 | h2 |\n| - | - |\n| | x |\n";
const LEAD_FORMATTED = "| h1  | h2  |\n| --- | --- |\n|     | x   |\n";

let held: HeldInvoke;
const docA = () => useDocumentStore.getState().documents.find((d) => d.id === "doc-a");
const ok = (path: string) => ({ success: true, path, savedAt: SAVED_AT });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function doc(id: string, content: string, path: string | null): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null };
}

function resetStores(aContent: string): void {
  useDocumentStore.setState({ documents: [doc("doc-a", aContent, A_PATH)], activeDocumentId: "doc-a" });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "source", editorView: null });
  useTOCStore.setState(TOC_INITIAL, true);
}

async function saveWith(autoReformatTablesOnSave: boolean): Promise<string> {
  held.reply("get_preferences", () => ({ markdown: { autoReformatTablesOnSave } }));
  held.reply("save_file", () => ok(A_PATH));
  const { result, unmount } = renderHook(() => useDocument());
  await act(async () => { await result.current.saveActiveDocument(); });
  await settle();
  unmount();
  expect(held.calls("save_file")).toHaveLength(1);
  return held.calls("save_file")[0].content as string;
}

beforeEach(() => {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  for (const k of Object.keys(listeners)) delete listeners[k];
  resetStores(LEAD);
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  held.assertDrained();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("C1-SAVE ⌘S format-on-save keeps the blank leading cell in column 0", () => {
  it("C1-SAVE-LEAD: auto-reformat on writes x in column 1", async () => {
    expect(await saveWith(true)).toBe(LEAD_FORMATTED);
    expect(docA()!.lastSaved).toBe(SAVED_AT);
  });

  it("C1-SAVE-OFF: auto-reformat off writes the bytes verbatim", async () => {
    expect(await saveWith(false)).toBe(LEAD);
    expect(docA()!.lastSaved).toBe(SAVED_AT);
  });
});

describe("C1-MCP-HOOK mcp:table_action set_cell through the real hook", () => {
  it("set_cell row 1 col 0 writes y beside x in the store", async () => {
    const { unmount } = renderHook(() => useMcpEvents());
    await waitFor(() => expect(listeners["mcp:table_action"]).toBeDefined());
    await act(async () => {
      listeners["mcp:table_action"]({
        payload: {
          document_id: "doc-a",
          action: "set_cell",
          payload: { row: 1, col: 0, content: "y" },
          window_label: "main",
        },
      });
    });
    await settle();
    expect(docA()!.content).toBe("| h1  | h2  |\n| --- | --- |\n| y   | x   |\n");
    unmount();
  });
});
