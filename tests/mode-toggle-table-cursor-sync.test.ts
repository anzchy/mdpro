/**
 * @module mode-toggle-table-cursor-sync.test
 * Purpose: Verify that toggling between source and WYSIWYG carries the
 * cursor's table-cell coordinates across (Phase 2 WI-2.6). The capture
 * step happens inside `editorStore.setViewMode` / `cycleViewMode` so
 * EVERY transition trigger (menu click, keyboard shortcut, default
 * startup, large-file auto-switch, Settings) routes through the same
 * code path (Codex finding R14).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

// Mock the ProseMirror-aware capture/restore — exercising real
// `captureCellFromMilkdownView` requires a full TableMap-compatible
// doc, which is out of scope for unit tests. The pure logic is
// covered by `tests/cursor-sync-table.test.ts`; this file verifies
// the editorStore *wiring*: capture is called on the right transition,
// the result lands in the slot, and stale slot state is cleared on
// no-table transitions.
const mockCaptureFromMilkdown = vi.fn();
vi.mock("../src/utils/cursorSync/tableMilkdown", () => ({
  captureCellFromMilkdownEditor: (editor: unknown) =>
    mockCaptureFromMilkdown(editor),
  restoreCellInMilkdownEditor: vi.fn(() => true),
  captureCellFromMilkdownView: vi.fn(),
  restoreCellInMilkdownView: vi.fn(),
}));

import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  getPendingTableCell,
  setPendingTableCell,
  type TableCellPos,
} from "../src/utils/cursorSync/table";

const TWO_TABLE_DOC =
  "Intro.\n\n" +
  "| a | b |\n| - | - |\n| 1 | 2 |\n" +
  "\nMid.\n\n" +
  "| x | y | z |\n| - | - | - |\n| 7 | 8 | 9 |\n";

function makeCmView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown()],
  });
  return new EditorView({ state });
}

beforeEach(() => {
  useEditorStore.setState({ viewMode: "source", editorView: null });
  useDocumentStore.setState({ activeDocumentId: "test-doc" });
  useMilkdownEditorStore.setState({ getEditor: () => null });
  setPendingTableCell(null);
  mockCaptureFromMilkdown.mockReset();
});

afterEach(() => {
  setPendingTableCell(null);
});

// ---------------------------------------------------------------------------
// Source → WYSIWYG capture path
// ---------------------------------------------------------------------------

describe("setViewMode source → wysiwyg captures from CodeMirror", () => {
  it("captures (tableIndex, rowIndex, colIndex) when cursor is in a table", () => {
    const cursorIn1 = TWO_TABLE_DOC.indexOf("| 1") + 2; // body cell of table 0
    const view = makeCmView(TWO_TABLE_DOC, cursorIn1);
    useEditorStore.setState({ viewMode: "source", editorView: view });

    useEditorStore.getState().setViewMode("wysiwyg");

    expect(getPendingTableCell()).toEqual({
      documentId: "test-doc",
      pos: { tableIndex: 0, rowIndex: 1, colIndex: 0 } as TableCellPos,
    });
  });

  it("captures from the second table with the correct tableIndex", () => {
    const cursorIn8 = TWO_TABLE_DOC.indexOf("| 8") + 2;
    const view = makeCmView(TWO_TABLE_DOC, cursorIn8);
    useEditorStore.setState({ viewMode: "source", editorView: view });

    useEditorStore.getState().setViewMode("wysiwyg");

    expect(getPendingTableCell()).toEqual({
      documentId: "test-doc",
      pos: { tableIndex: 1, rowIndex: 1, colIndex: 1 } as TableCellPos,
    });
  });

  it("clears the pending slot to null when cursor is outside any table", () => {
    setPendingTableCell({
      documentId: "stale",
      pos: { tableIndex: 5, rowIndex: 5, colIndex: 5 },
    });
    const view = makeCmView(TWO_TABLE_DOC, 0); // before any table
    useEditorStore.setState({ viewMode: "source", editorView: view });

    useEditorStore.getState().setViewMode("wysiwyg");

    // The stale capture must not survive a no-table transition.
    expect(getPendingTableCell()).toBeNull();
  });

  it("does not capture when the toggle is a no-op (same mode)", () => {
    const cursorIn1 = TWO_TABLE_DOC.indexOf("| 1") + 2;
    const view = makeCmView(TWO_TABLE_DOC, cursorIn1);
    useEditorStore.setState({ viewMode: "source", editorView: view });
    setPendingTableCell({
      documentId: "stale",
      pos: { tableIndex: 99, rowIndex: 99, colIndex: 99 },
    });

    useEditorStore.getState().setViewMode("source"); // same mode

    // Capture is skipped; previous value preserved.
    expect(getPendingTableCell()).toEqual({
      documentId: "stale",
      pos: { tableIndex: 99, rowIndex: 99, colIndex: 99 },
    });
  });
});

// ---------------------------------------------------------------------------
// WYSIWYG → source capture path (via Milkdown editor mock)
// ---------------------------------------------------------------------------

describe("setViewMode wysiwyg → source captures from Milkdown editor", () => {
  it("invokes captureCellFromMilkdownEditor when an editor is registered", () => {
    const fakeEditor = { action: vi.fn() };
    useMilkdownEditorStore.setState({ getEditor: () => fakeEditor });
    useEditorStore.setState({ viewMode: "wysiwyg" });
    mockCaptureFromMilkdown.mockReturnValue({
      tableIndex: 0,
      rowIndex: 1,
      colIndex: 1,
    });

    useEditorStore.getState().setViewMode("source");

    expect(mockCaptureFromMilkdown).toHaveBeenCalledWith(fakeEditor);
    expect(getPendingTableCell()).toEqual({
      documentId: "test-doc",
      pos: { tableIndex: 0, rowIndex: 1, colIndex: 1 },
    });
  });

  it("writes null when no Milkdown editor is registered", () => {
    setPendingTableCell({
      documentId: "stale",
      pos: { tableIndex: 1, rowIndex: 1, colIndex: 1 },
    });
    useMilkdownEditorStore.setState({ getEditor: () => null });
    useEditorStore.setState({ viewMode: "wysiwyg" });

    useEditorStore.getState().setViewMode("source");

    expect(mockCaptureFromMilkdown).not.toHaveBeenCalled();
    expect(getPendingTableCell()).toBeNull();
  });

  it("writes null when the helper returns null (cursor outside any table)", () => {
    setPendingTableCell({
      documentId: "stale",
      pos: { tableIndex: 9, rowIndex: 9, colIndex: 9 },
    });
    const fakeEditor = { action: vi.fn() };
    useMilkdownEditorStore.setState({ getEditor: () => fakeEditor });
    useEditorStore.setState({ viewMode: "wysiwyg" });
    mockCaptureFromMilkdown.mockReturnValue(null);

    useEditorStore.getState().setViewMode("source");

    expect(getPendingTableCell()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cycleViewMode goes through the same capture path
// ---------------------------------------------------------------------------

describe("cycleViewMode triggers capture (Codex R14: not just menu)", () => {
  it("captures on cycle from source to wysiwyg", () => {
    const cursorIn2 = TWO_TABLE_DOC.indexOf("| 2") + 2;
    const view = makeCmView(TWO_TABLE_DOC, cursorIn2);
    useEditorStore.setState({ viewMode: "source", editorView: view });

    useEditorStore.getState().cycleViewMode();

    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
    expect(getPendingTableCell()).toEqual({
      documentId: "test-doc",
      pos: { tableIndex: 0, rowIndex: 1, colIndex: 1 } as TableCellPos,
    });
  });

  // Audit-fix M1: confirm the captured documentId is read from
  // documentStore at transition time, not later. A capture during
  // doc-1 followed by a switch to doc-2 must NOT restore in doc-2.
  it("the captured documentId is locked at transition time, not at consume time", () => {
    const cursorIn1 = TWO_TABLE_DOC.indexOf("| 1") + 2;
    const view = makeCmView(TWO_TABLE_DOC, cursorIn1);
    useDocumentStore.setState({ activeDocumentId: "doc-A" });
    useEditorStore.setState({ viewMode: "source", editorView: view });

    useEditorStore.getState().setViewMode("wysiwyg");

    // Switch documents AFTER capturing.
    useDocumentStore.setState({ activeDocumentId: "doc-B" });

    expect(getPendingTableCell()).toEqual({
      documentId: "doc-A",
      pos: { tableIndex: 0, rowIndex: 1, colIndex: 0 },
    });
  });
});

