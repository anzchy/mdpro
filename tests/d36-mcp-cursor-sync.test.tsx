/**
 * D36 — a cursor-only move in source mode must resync the MCP shadow store.
 *
 * `useMcpSync` re-synced only on document count, active document and content
 * changes. Moving the caret without typing left the shadow store's `cursor`
 * at its last synced value, so MCP `insert_content { position: "cursor" }`
 * computed both the landing offset and the returned `newCursor` from a stale
 * caret.
 *
 * Mounts the REAL `Editor` (real CodeMirror view, real update listener →
 * `pluginRegistry` events) and the REAL `useMcpSync`, with the real document
 * and editor stores. Only the Tauri boundary is mocked: `invoke` (the
 * `mcp_sync_documents` IPC is read off it) and `listen`.
 *
 * Red: D36-1 and D36-2 fail on the pre-fix hook — no sync goes out after a
 * cursor-only move. D36-G1 (same position is deduped) and D36-G2 (typing
 * still syncs on the debounce) hold before and after the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => null));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMcpSync } from "../src/hooks/useMcpSync";

const DOC_ID = "doc-1";
const TEXT = "hello world";
const DEBOUNCE_MS = 300;

interface SyncedDoc {
  id: string;
  content: string;
  cursor: number;
}

function syncCalls(): SyncedDoc[][] {
  return invoke.mock.calls
    .filter((c) => (c as unknown[])[0] === "mcp_sync_documents")
    .map((c) => ((c as unknown[])[1] as { payload: { documents: SyncedDoc[] } }).payload.documents);
}

function activeDoc(docs: SyncedDoc[]): SyncedDoc {
  return docs.find((d) => d.id === DOC_ID)!;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let view: EditorView;

async function mount() {
  useDocumentStore.setState({
    documents: [
      {
        id: DOC_ID,
        path: "/tmp/d36.md",
        content: TEXT,
        encoding: "utf-8",
        lineEnding: "lf",
        isModified: false,
        lastSaved: null,
      },
    ] as never,
    activeDocumentId: DOC_ID,
  });
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });

  // The app's onChange path: the editor's text goes into the document store.
  render(
    <Editor
      value={TEXT}
      onChange={(next) => {
        useDocumentStore.getState().updateDocumentContent(DOC_ID, next);
      }}
    />,
  );
  renderHook(() => useMcpSync());
  view = useEditorStore.getState().editorView!;
  expect(view).toBeTruthy();
  expect(view.state.doc.toString()).toBe(TEXT);

  // Let the mount-time content debounce go out, then start counting.
  await advance(DEBOUNCE_MS);
  expect(syncCalls().length).toBeGreaterThanOrEqual(1);
  expect(activeDoc(syncCalls().at(-1)!).cursor).toBe(view.state.selection.main.head);
  invoke.mockClear();
}

function moveCursor(pos: number) {
  act(() => {
    view.dispatch({ selection: EditorSelection.cursor(pos) });
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D36: cursor-only moves in source mode resync the shadow store", () => {
  it("D36-1: a cursor-only move syncs the new caret once the debounce elapses, not before", async () => {
    moveCursor(6);

    // Not immediate: an arrow press must not fire an IPC per key.
    await advance(DEBOUNCE_MS - 1);
    expect(syncCalls()).toHaveLength(0);

    await advance(1);
    const calls = syncCalls();
    expect(calls, "no mcp_sync_documents after a cursor-only move").toHaveLength(1);
    expect(activeDoc(calls[0]).cursor).toBe(6);
    expect(activeDoc(calls[0]).content).toBe(TEXT);
  });

  it("D36-2: a burst of moves inside the debounce coalesces into one sync at the last caret", async () => {
    for (const pos of [1, 2, 3, 4]) {
      moveCursor(pos);
      await advance(50);
    }
    await advance(DEBOUNCE_MS);

    const calls = syncCalls();
    expect(calls, "a burst of moves must produce exactly one sync").toHaveLength(1);
    expect(activeDoc(calls[0]).cursor).toBe(4);
  });

  it("D36-G1: re-placing the caret where it already is sends nothing (identical payload is deduped)", async () => {
    const head = view.state.selection.main.head;
    moveCursor(head);
    await advance(DEBOUNCE_MS * 2);

    expect(syncCalls()).toHaveLength(0);
  });

  it("D36-G2: typing still syncs the new content and caret on the debounce", async () => {
    act(() => {
      view.dispatch({
        changes: { from: TEXT.length, insert: "!" },
        selection: EditorSelection.cursor(TEXT.length + 1),
      });
    });
    expect(useDocumentStore.getState().documents[0].content).toBe(`${TEXT}!`);

    await advance(DEBOUNCE_MS - 1);
    expect(syncCalls()).toHaveLength(0);
    await advance(1);

    const calls = syncCalls();
    expect(calls).toHaveLength(1);
    expect(activeDoc(calls[0]).content).toBe(`${TEXT}!`);
    expect(activeDoc(calls[0]).cursor).toBe(TEXT.length + 1);
  });
});

describe("D36: a pending debounce sends the state as it is when the timer fires", () => {
  // Same-length replace: the content-change effect keys on `id:length:isModified`,
  // so once the document is already modified it does NOT re-arm the debounce.
  // The only pending timer is the one the selection event armed inside
  // CodeMirror's update, before React re-rendered with the new content. A timer
  // that captured doSync at schedule time would send the pre-edit text.
  function replaceFirstChar(ch: string) {
    act(() => {
      view.dispatch({
        changes: { from: 0, to: 1, insert: ch },
        selection: EditorSelection.cursor(1),
      });
    });
  }

  it("D36-3: a same-length replace syncs the NEW content and caret, not the pre-edit snapshot", async () => {
    // Precondition: make the document modified, so the next replace leaves the
    // content hash unchanged. Let that sync go out, then start counting.
    replaceFirstChar("j");
    await advance(DEBOUNCE_MS);
    expect(useDocumentStore.getState().documents[0].isModified).toBe(true);
    expect(activeDoc(syncCalls().at(-1)!).content).toBe(`j${TEXT.slice(1)}`);
    invoke.mockClear();

    replaceFirstChar("y");
    expect(useDocumentStore.getState().documents[0].content).toBe(`y${TEXT.slice(1)}`);
    await advance(DEBOUNCE_MS);

    const calls = syncCalls();
    expect(calls, "the same-length replace must produce exactly one sync").toHaveLength(1);
    expect(activeDoc(calls[0]).content).toBe(`y${TEXT.slice(1)}`);
    expect(activeDoc(calls[0]).cursor).toBe(1);
  });
});
