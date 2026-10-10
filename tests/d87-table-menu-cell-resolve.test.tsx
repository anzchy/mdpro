/**
 * D87: the WYSIWYG table menu must act on the cell the user right-clicked, even
 * when `view.posAtCoords` lands on a cell or row BOUNDARY (a click on a cell
 * border or its padding), and a pick refused as `stale-position` must tell the
 * user (shared toast), not only the log.
 *
 * ① `computeTableContext` used to scan `TableMap.map` and break at the first
 *   cell start >= the position, so a position exactly at cell B's start (or
 *   between two rows) resolved to the PREVIOUS cell, and a delete removed the
 *   wrong row/column. It now resolves strictly: the position's own cell or null.
 * ② The menu derives its target from the right-clicked `td`/`th` (posAtDOM),
 *   so a boundary posAtCoords cannot move the target to a neighbour.
 *
 * Real Milkdown (commonmark + gfm + `tableParityPlugins` + history). Boundaries
 * stubbed: `view.posAtCoords` (jsdom has no layout), `view.posAtDOM` only in the
 * no-verified-cell case, `loggingService` (IPC) and `@tauri-apps/api/core`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

const { TableContextMenu } = await import("../src/components/Editor/TableContextMenu");
const { useMilkdownEditorStore } = await import("../src/stores/milkdownEditorStore");
const { useToastStore } = await import("../src/stores/toastStore");
const { loggingService } = await import("../src/services/loggingService");
const { computeTableContext, dispatchTableActionDetailed, dispatchTableActionFromKeyboard } =
  await import("../src/plugins/milkdown/table/contextMenu");
const support = await import("./support/raggedTableD64");
const { caretAfter, destroyParityEditors, docOf, mountParityEditor, posAfter, tableShapes, viewOf } =
  support;

const MD = "| H0 | H1 | H2 |\n| --- | --- | --- |\n| A0 | A1 | A2 |\n| B0 | B1 | B2 |\n\nend\n";
const H = ["H0", "H1", "H2"];
const A = ["A0", "A1", "A2"];
const B = ["B0", "B1", "B2"];
const STALE_TOAST = "Document changed — reopen the menu";

const logSpy = vi.mocked(loggingService.logEventSync);

/** Depth of the cell (td/th node) enclosing the text `needle`. */
function cellDepthAt(view: EditorView, needle: string): number {
  const $p = view.state.doc.resolve(posAfter(view, needle));
  let d = $p.depth;
  while (d > 0 && !/table_(cell|header)/.test($p.node(d).type.name)) d -= 1;
  if (d === 0) throw new Error(`no cell around ${needle}`);
  return d;
}

/** The position exactly at the start boundary of the cell holding `needle` (before the cell node). */
function cellBoundary(view: EditorView, needle: string): number {
  const $p = view.state.doc.resolve(posAfter(view, needle));
  return $p.before(cellDepthAt(view, needle));
}

/** The position between the row holding `needle` and the row before it (before the row node). */
function rowBoundary(view: EditorView, needle: string): number {
  const $p = view.state.doc.resolve(posAfter(view, needle));
  return $p.before(cellDepthAt(view, needle) - 1);
}

function ctxAt(view: EditorView, pos: number) {
  return computeTableContext(view, view.state.doc.resolve(pos));
}

function dispatchAt(e: Editor, id: Parameters<typeof dispatchTableActionDetailed>[1], pos: number) {
  const view = viewOf(e);
  const caretCtx = computeTableContext(view);
  expect(caretCtx, "caret not in a table").not.toBeNull();
  return dispatchTableActionDetailed(e as never, id, caretCtx!, { pos, doc: view.state.doc });
}

/** Mount the editor inside `#milkdown-container` and register it in the store. */
async function mountMenu(): Promise<Editor> {
  const e = await mountParityEditor(MD);
  const root = viewOf(e).dom.closest("body > div");
  if (!(root instanceof HTMLElement)) throw new Error("editor root not found");
  root.id = "milkdown-container";
  useMilkdownEditorStore.setState({ getEditor: () => e as never });
  render(<TableContextMenu />);
  return e;
}

/** Right-click the td/th holding `needle` while posAtCoords reports `coordPos`. */
function rightClickCell(e: Editor, needle: string, coordPos: number | null): void {
  const view = viewOf(e);
  view.posAtCoords = (() =>
    coordPos === null ? null : { pos: coordPos, inside: -1 }) as typeof view.posAtCoords;
  const cell = Array.from(view.dom.querySelectorAll<HTMLElement>("td, th")).find(
    (el) => el.textContent === needle,
  );
  if (!cell) throw new Error(`cell ${needle} not rendered`);
  fireEvent.contextMenu(cell, { clientX: 200, clientY: 100 });
}

function openEvents() {
  return logSpy.mock.calls.map(([p]) => p).filter((p) => p.event === "ui.table-context-menu.open");
}

beforeEach(() => {
  logSpy.mockClear();
  useToastStore.getState().clearToast();
});

afterEach(async () => {
  useMilkdownEditorStore.setState({ getEditor: () => null });
  useToastStore.getState().clearToast();
  await destroyParityEditors();
});

describe("D87 ① computeTableContext resolves the cell strictly", () => {
  it("D87-a1 a position exactly at the start of cell A1 never resolves to A0", async () => {
    const e = await mountParityEditor(MD);
    const view = viewOf(e);
    expect(ctxAt(view, cellBoundary(view, "A1"))).toBeNull();
    // A position inside A1 still resolves to (1, 1).
    expect(ctxAt(view, cellBoundary(view, "A1") + 1)).toMatchObject({ rowIndex: 1, colIndex: 1 });
  });

  it("D87-a2 delete_column at A1's start boundary does not delete column 0", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "B2");
    const target = cellBoundary(viewOf(e), "A1");
    expect(dispatchAt(e, "delete_column", target)).toEqual({ applied: false, reason: "not-in-table" });
    const [shape] = tableShapes(docOf(e));
    expect(shape.cells).toEqual([H, A, B]);
  });

  it("D87-b1 a position between body rows (and at row B's first cell start) never resolves to row A", async () => {
    const e = await mountParityEditor(MD);
    const view = viewOf(e);
    expect(ctxAt(view, rowBoundary(view, "B0"))).toBeNull();
    expect(ctxAt(view, cellBoundary(view, "B0"))).toBeNull();
  });

  it("D87-b2 delete_row at the A/B row boundary does not delete row A", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "H0");
    for (const target of [rowBoundary(viewOf(e), "B0"), cellBoundary(viewOf(e), "B0")]) {
      expect(dispatchAt(e, "delete_row", target)).toEqual({ applied: false, reason: "not-in-table" });
      expect(tableShapes(docOf(e))[0].cells).toEqual([H, A, B]);
    }
  });

  it("D87-a3 an in-cell target at the cell's content start (cellPos + 1) acts on that cell", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "B2");
    const target = cellBoundary(viewOf(e), "A1") + 1;
    expect(dispatchAt(e, "delete_column", target)).toEqual({ applied: true });
    expect(tableShapes(docOf(e))[0].cells).toEqual([H, A, B].map((r) => [r[0], r[2]]));
  });
});

describe("D87 ② the menu targets the right-clicked td/th", () => {
  it("D87-c1 posAtCoords at A1's start boundary: the menu targets (1, 1) and deletes column 1", async () => {
    const user = userEvent.setup();
    const e = await mountMenu();
    caretAfter(e, "B2");
    rightClickCell(e, "A1", cellBoundary(viewOf(e), "A1"));
    await user.click(screen.getByRole("menuitem", { name: "Delete column" }));
    expect(tableShapes(docOf(e))[0].cells).toEqual([H, A, B].map((r) => [r[0], r[2]]));
    expect(openEvents().at(-1)).toMatchObject({
      context: expect.objectContaining({ rowIndex: 1, colIndex: 1 }),
    });
  });

  it("D87-c2 posAtCoords between rows A and B while B0 is clicked: delete row removes row B", async () => {
    const user = userEvent.setup();
    const e = await mountMenu();
    caretAfter(e, "H2");
    rightClickCell(e, "B0", rowBoundary(viewOf(e), "B0"));
    await user.click(screen.getByRole("menuitem", { name: "Delete row" }));
    expect(tableShapes(docOf(e))[0].cells).toEqual([H, A]);
    expect(openEvents().at(-1)).toMatchObject({
      context: expect.objectContaining({ rowIndex: 2, colIndex: 0 }),
    });
  });

  it("D87-c3 posAtCoords finds nothing: the menu still targets the clicked cell, not the caret's", async () => {
    const user = userEvent.setup();
    const e = await mountMenu();
    caretAfter(e, "A0");
    rightClickCell(e, "B2", null);
    await user.click(screen.getByRole("menuitem", { name: "Delete column" }));
    expect(tableShapes(docOf(e))[0].cells).toEqual([H, A, B].map((r) => [r[0], r[1]]));
    expect(openEvents().at(-1)).toMatchObject({
      context: expect.objectContaining({ rowIndex: 2, colIndex: 2 }),
    });
  });

  it("D87-c4 posAtCoords inside the clicked cell keeps the clicked caret position", async () => {
    const user = userEvent.setup();
    const e = await mountMenu();
    caretAfter(e, "A0");
    const inside = posAfter(viewOf(e), "B1") - 1; // between "B" and "1"
    rightClickCell(e, "B1", inside);
    await user.click(screen.getByRole("menuitemradio", { name: "Align right" }));
    expect(viewOf(e).state.selection.from).toBe(inside);
    for (const row of tableShapes(docOf(e))[0].align) expect(row[1]).toBe("right");
  });

  it("D87-d no verified cell (posAtDOM fails) and a boundary posAtCoords: the menu does not open", async () => {
    const e = await mountMenu();
    caretAfter(e, "A0");
    const view = viewOf(e);
    view.posAtDOM = (() => {
      throw new RangeError("Invalid DOM position");
    }) as typeof view.posAtDOM;
    rightClickCell(e, "B0", rowBoundary(view, "B0"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(openEvents()).toHaveLength(0);
  });

  it("D87-e a stale pick shows the shared toast and does not apply", async () => {
    const user = userEvent.setup();
    const e = await mountMenu();
    caretAfter(e, "A0");
    rightClickCell(e, "A1", posAfter(viewOf(e), "A1"));
    const view = viewOf(e);
    view.dispatch(view.state.tr.insertText("x", posAfter(view, "B0")));
    await user.click(screen.getByRole("menuitem", { name: "Delete column" }));
    expect(useToastStore.getState().message).toBe(STALE_TOAST);
    expect(tableShapes(docOf(e))[0].cells).toEqual([H, A, ["B0x", "B1", "B2"]]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("D87-e2 a non-stale failed pick does not show the stale toast", async () => {
    const user = userEvent.setup();
    const e = await mountMenu();
    caretAfter(e, "A0");
    rightClickCell(e, "A1", posAfter(viewOf(e), "A1"));
    await user.click(screen.getByRole("menuitem", { name: "Reformat table" }));
    expect(useToastStore.getState().message).toBeNull();
  });
});

describe("D87 caret path (keyboard) is unchanged", () => {
  it("D87-f1 delete_column from a caret inside A1's text deletes column 1", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A1");
    expect(computeTableContext(viewOf(e))).toMatchObject({ rowIndex: 1, colIndex: 1 });
    expect(dispatchTableActionFromKeyboard(e as never, "delete_column")).toBe(true);
    expect(tableShapes(docOf(e))[0].cells).toEqual([H, A, B].map((r) => [r[0], r[2]]));
  });

  it("D87-f2 a caret at the very start of B0's text resolves to (2, 0)", async () => {
    const e = await mountParityEditor(MD);
    const view = viewOf(e);
    const start = posAfter(view, "B0") - 2;
    expect(ctxAt(view, start)).toMatchObject({ rowIndex: 2, colIndex: 0 });
  });
});
