/**
 * D49 WI-2 MA-6 (Variant A1, ADR-0064): an MCP `set_cell` on an overflow
 * document reaches the real documentStore and the live CodeMirror view with
 * the overflow cell kept, and logs both the success line and the widening.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-2" MA-6, the
 * paired integration case for the unit cases in
 * `tests/table-mcp-overflow.test.ts`. jsdom, because the view is a real
 * `EditorView`. Only `@tauri-apps/api/core` `invoke` is mocked: the store's
 * `updateDocumentContent`, `loggingService` and `@milkdown/kit/utils` are
 * real (source mode never calls `replaceAll`). Log entries are observed as
 * `log_event` calls at the Tauri boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { processTableActionEvent } from "../src/hooks/mcpTableAction";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

const DOC = "| a | b |\n|---|---|\n| 1 | 2 | Z |\n";
const EXPECTED = "| a   | b   |     |\n| --- | --- | --- |\n| Q   | 2   | Z   |\n";

type LogPayload = { level: string; event: string; status?: string; context?: unknown };
type LogCall = [string, { payload: LogPayload }];
const logs = (event: string): LogPayload[] =>
  (invoke.mock.calls as unknown as LogCall[])
    .filter(([cmd, a]) => cmd === "log_event" && a.payload.event === event)
    .map(([, a]) => a.payload);

let view: EditorView;

beforeEach(() => {
  invoke.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  view = new EditorView({ state: EditorState.create({ doc: DOC }) });
  useDocumentStore.setState({
    documents: [
      {
        id: "doc-1",
        path: null,
        content: DOC,
        encoding: "UTF-8",
        lineEnding: "lf",
        isModified: false,
        lastSaved: null,
        fileSize: null,
      },
    ],
    activeDocumentId: "doc-1",
  });
  useEditorStore.setState({ viewMode: "source", editorView: view });
});

afterEach(() => {
  view.destroy();
  useEditorStore.setState({ editorView: null });
});

describe("MA-6: set_cell on an overflow document reaches the store and the live view", () => {
  it("keeps Z in the store and the view, and logs success plus the widening", () => {
    processTableActionEvent(
      { document_id: "doc-1", action: "set_cell", payload: { row: 1, col: 0, content: "Q" }, window_label: "main" },
      { currentWindowLabel: "main", updateDocumentContent: useDocumentStore.getState().updateDocumentContent },
    );

    const doc = useDocumentStore.getState().getDocumentById("doc-1");
    expect(doc?.content).toBe(EXPECTED);
    expect(doc?.isModified).toBe(true);
    expect(view.state.doc.toString()).toBe(EXPECTED);

    expect(logs("mcp.table.set_cell")).toEqual([
      { level: "info", event: "mcp.table.set_cell", status: "success", context: { documentId: "doc-1" } },
    ]);
    expect(logs("editor.table.edit-widened").map((p) => p.context)).toEqual([
      { action: "set_cell", fromColCount: 2, toColCount: 3 },
    ]);
  });
});
