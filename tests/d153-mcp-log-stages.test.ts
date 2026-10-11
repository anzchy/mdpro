/**
 * D153 — an MCP write that Rust schedules and the frontend applies logs two
 * lines under one event name. They must be told apart (`stage`) and joined
 * (`actionId`): Rust logs `stage: "scheduled"` and mints the id it carries on
 * the event payload as `action_id`; the frontend logs `stage: "applied"` with
 * that same id on every line it writes (success and fail alike), and mints one
 * of its own when an older emitter sent none.
 *
 * Covers `mcp:table_action` (`processTableActionEvent`) and
 * `mcp:insert_content` (`processInsertContentEvent`), the two routes whose
 * frontend handler logs a success line under the Rust handler's event name.
 * Only `@tauri-apps/api/core` `invoke` is mocked; `loggingService` is real and
 * log entries are read as `log_event` calls at the Tauri boundary.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { processTableActionEvent, type TableActionEvent } from "../src/hooks/mcpTableAction";
import { processInsertContentEvent, type InsertContentEvent } from "../src/hooks/mcpInsertContent";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
const RUST_ID = "rust-minted-id";
const GENERATED_ID = "00000000-0000-4000-8000-0000000d153f";

type LogPayload = { level: string; event: string; status?: string; actionId?: string; context?: Record<string, unknown> };
type LogCall = [string, { payload: LogPayload }];
const logs = (event: string): LogPayload[] =>
  (invoke.mock.calls as unknown as LogCall[])
    .filter(([cmd, a]) => cmd === "log_event" && a.payload.event === event)
    .map(([, a]) => a.payload);

const deps = {
  currentWindowLabel: "main",
  updateDocumentContent: (id: string, c: string) =>
    useDocumentStore.getState().updateDocumentContent(id, c),
};

// The intersection keeps these literals valid whether or not the payload types
// declare `action_id` yet (the field is optional on both).
const tableEvt = (
  documentId: string,
  overrides: Partial<TableActionEvent & { action_id: string }> = {},
): TableActionEvent & { action_id?: string } => ({
  document_id: documentId,
  action: "set_cell",
  payload: { row: 1, col: 0, content: "Q" },
  window_label: "main",
  action_id: RUST_ID,
  ...overrides,
});

const insertEvt = (
  documentId: string,
  overrides: Partial<InsertContentEvent & { action_id: string }> = {},
): InsertContentEvent & { action_id?: string } => ({
  document_id: documentId,
  text: "X",
  position: "end",
  window_label: "main",
  action_id: RUST_ID,
  ...overrides,
});

const contentOf = (id: string) => useDocumentStore.getState().getDocumentById(id)?.content;

beforeEach(() => {
  invoke.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({
    documents: [
      { id: "doc-1", path: null, content: TABLE, encoding: "UTF-8", lineEnding: "lf",
        isModified: false, lastSaved: null, fileSize: null },
    ],
    // Not active: the store-only branch, so no editor is needed.
    activeDocumentId: null,
  });
  useEditorStore.setState({ viewMode: "source", editorView: null });
  vi.spyOn(loggingService, "generateActionId").mockReturnValue(GENERATED_ID);
});

describe("D153-T: mcp:table_action logs the applied stage under Rust's action id", () => {
  it("T1 a successful set_cell logs one success line with stage applied and the payload's action_id", () => {
    processTableActionEvent(tableEvt("doc-1"), deps);

    expect(contentOf("doc-1")).toContain("| Q");
    expect(logs("mcp.table.set_cell")).toEqual([
      {
        level: "info",
        event: "mcp.table.set_cell",
        status: "success",
        actionId: RUST_ID,
        context: { documentId: "doc-1", stage: "applied" },
      },
    ]);
  });

  it("T2 a refused action (document not found) logs its fail line with the same stage and id", () => {
    processTableActionEvent(tableEvt("doc-missing"), deps);

    expect(logs("mcp.table.set_cell")).toEqual([
      {
        level: "warn",
        event: "mcp.table.set_cell",
        status: "fail",
        actionId: RUST_ID,
        context: { documentId: "doc-missing", stage: "applied", reason: "not found" },
      },
    ]);
  });

  it("T3 an event without action_id (older emitter) falls back to a generated id", () => {
    processTableActionEvent(tableEvt("doc-1", { action_id: undefined }), deps);

    const [line] = logs("mcp.table.set_cell");
    expect(line.actionId).toBe(GENERATED_ID);
    expect(line.context).toEqual({ documentId: "doc-1", stage: "applied" });
  });

  it("T4 a foreign-window event logs nothing and changes nothing", () => {
    processTableActionEvent(tableEvt("doc-1", { window_label: "other" }), deps);

    expect(logs("mcp.table.set_cell")).toEqual([]);
    expect(contentOf("doc-1")).toBe(TABLE);
  });
});

describe("D153-I: mcp:insert_content logs the applied stage under Rust's action id", () => {
  it("I1 a successful insert logs one success line with stage applied and the payload's action_id", () => {
    processInsertContentEvent(insertEvt("doc-1"), deps);

    expect(contentOf("doc-1")).toBe(TABLE + "X");
    expect(logs("mcp.insert")).toEqual([
      {
        level: "info",
        event: "mcp.insert",
        status: "success",
        actionId: RUST_ID,
        context: { documentId: "doc-1", stage: "applied", wholesale: false },
      },
    ]);
  });

  it("I2 a refused insert (document not found) logs its fail line with the same stage and id", () => {
    processInsertContentEvent(insertEvt("doc-missing"), deps);

    expect(logs("mcp.insert")).toEqual([
      {
        level: "warn",
        event: "mcp.insert",
        status: "fail",
        actionId: RUST_ID,
        context: { documentId: "doc-missing", stage: "applied", reason: "not found" },
      },
    ]);
  });

  it("I3 an event without action_id (older emitter) falls back to a generated id", () => {
    processInsertContentEvent(insertEvt("doc-1", { action_id: undefined }), deps);

    const [line] = logs("mcp.insert");
    expect(line.actionId).toBe(GENERATED_ID);
    expect(line.context).toMatchObject({ documentId: "doc-1", stage: "applied" });
  });
});
