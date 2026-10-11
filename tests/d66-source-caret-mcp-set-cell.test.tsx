/**
 * D66 — in Source mode an MCP `set_cell` that arrives while the user is typing
 * must not move the caret to offset 0.
 *
 * Device repro (docs/test/20261009-d49-d58-device-check.md F3): caret at the end of
 * `Last line.`, the user types `kq1` while curl sends `set_cell` to T0; `k` stayed at
 * the end and `q1` landed at the start of the document.
 *
 * Mounts the REAL `Editor` (real `<CodeMirror>` wrapper, value prop bound to the
 * document store, onChange writing the store — the App/SplitView wiring) and the
 * REAL `useMcpEvents` listener. Only the Tauri boundary is mocked (`invoke`,
 * `listen`, `getCurrentWindow`). The expected content is the `applyMcpTableAction`
 * oracle over the text the editor held when the action arrived, so the content
 * result is pinned to today's.
 *
 * Red before the fix: the source branch of `processTableActionEvent` replaced the
 * whole CodeMirror document (`from: 0, to: doc.length`), so every caret mapped into
 * the replaced range and collapsed to 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { eventListeners, invoke } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Editor } from "../src/components/Editor/Editor";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { applyMcpTableAction } from "../src/utils/tableMcp";

const DOC_ID = "doc-d66";
const TITLE = "# D49 / D58 table check";
const LAST = "Last line.";
/** Ends in a newline like the device fixture (a heredoc), so the end of `Last line.`
 * is strictly inside the document — a whole-document replace collapses it to 0. */
const FIXTURE = `${TITLE}\n\nIntro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n${LAST}\n`;
/** A cell value wider than the column, so the whole table is re-padded. */
const CELL = "R1-wide-cell";
const SET_CELL = { row: 1, col: 1, content: CELL };

let view: EditorView;

function Harness() {
  const content = useDocumentStore(
    (s) => s.documents.find((d) => d.id === DOC_ID)?.content ?? "",
  );
  return (
    <Editor
      value={content}
      onChange={(next) => useDocumentStore.getState().updateDocumentContent(DOC_ID, next)}
    />
  );
}

async function mount(): Promise<void> {
  useDocumentStore.setState({
    documents: [
      {
        id: DOC_ID,
        path: "/tmp/d66.md",
        content: FIXTURE,
        encoding: "utf-8",
        lineEnding: "lf",
        isModified: false,
        lastSaved: null,
      },
    ] as never,
    activeDocumentId: DOC_ID,
  });
  useEditorStore.setState({ viewMode: "source", editorView: null, sourceTableVerdicts: {} });
  render(<Harness />);
  renderHook(() => useMcpEvents());
  await act(async () => {});
  view = useEditorStore.getState().editorView!;
  expect(view, "source editor did not mount").toBeTruthy();
  expect(view.state.doc.toString()).toBe(FIXTURE);
  expect(eventListeners.get("mcp:table_action"), "no mcp:table_action listener").toBeTypeOf(
    "function",
  );
}

function storeContent(): string {
  return useDocumentStore.getState().getDocumentById(DOC_ID)!.content;
}

/** What the user's keystrokes do: insert at (replace) the selection. */
function type(text: string): void {
  act(() => {
    view.dispatch(view.state.replaceSelection(text), { userEvent: "input.type" });
  });
}

function place(anchor: number, head = anchor): void {
  act(() => {
    view.dispatch({ selection: EditorSelection.range(anchor, head) });
  });
}

async function emitSetCell(): Promise<void> {
  await act(async () => {
    eventListeners.get("mcp:table_action")!({
      payload: { document_id: DOC_ID, action: "set_cell", payload: SET_CELL, window_label: null },
    });
  });
}

function oracle(text: string): string {
  const out = applyMcpTableAction(text, "set_cell", SET_CELL);
  expect(out, "oracle refused the fixture").not.toBeNull();
  return out!;
}

beforeEach(async () => {
  invoke.mockClear();
  eventListeners.clear();
  await mount();
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {}, viewMode: "wysiwyg" });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D66: a source-mode set_cell maps the caret instead of resetting it", () => {
  it("D66-1 caret at the end of the last line (the device repro): typing continues there", async () => {
    place(FIXTURE.indexOf(LAST) + LAST.length);
    type("k");
    const before = view.state.doc.toString();
    const delta = oracle(before).length - before.length;
    expect(delta, "fixture must change the table length").not.toBe(0);
    const headBefore = view.state.selection.main.head;

    await emitSetCell();

    expect(view.state.selection.main.head).toBe(headBefore + delta);
    expect(view.state.selection.main.head).not.toBe(0);
    type("q1");

    const expected = `${oracle(before).slice(0, -1)}q1\n`;
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.doc.toString().startsWith(TITLE)).toBe(true);
    expect(view.state.doc.toString().endsWith(`${LAST}kq1\n`)).toBe(true);
    expect(view.state.doc.toString()).toContain(CELL);
    expect(storeContent()).toBe(expected);
  });

  it("D66-2 caret before the table stays at the same offset", async () => {
    const at = TITLE.indexOf("/");
    place(at);
    const before = view.state.doc.toString();

    await emitSetCell();

    expect(view.state.selection.main.head).toBe(at);
    type("X");

    const expected = oracle(before).slice(0, at) + "X" + oracle(before).slice(at);
    expect(view.state.doc.toString()).toBe(expected);
    expect(storeContent()).toBe(expected);
  });

  it("D66-3 a range selection after the table keeps the same text selected", async () => {
    const from = FIXTURE.indexOf(LAST);
    const to = from + "Last".length;
    place(from, to);
    const before = view.state.doc.toString();
    const delta = oracle(before).length - before.length;

    await emitSetCell();

    const sel = view.state.selection.main;
    expect({ anchor: sel.anchor, head: sel.head }).toEqual({ anchor: from + delta, head: to + delta });
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("Last");
    expect(view.state.doc.toString()).toBe(oracle(before));
    expect(storeContent()).toBe(oracle(before));
  });
});
