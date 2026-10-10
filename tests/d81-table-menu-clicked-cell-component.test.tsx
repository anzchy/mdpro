/**
 * D81 component: `TableContextMenu`, mounted for real over a REAL Milkdown editor,
 * acts on the right-clicked cell and refuses — loudly — a position that went stale
 * while the menu was open.
 *
 * Boundaries stubbed: `view.posAtCoords` (jsdom has no layout; it returns the
 * position inside the cell the test right-clicks), `loggingService` (crosses IPC),
 * and `@tauri-apps/api/core`. The menu is opened with a `contextmenu` event on the
 * cell, as the browser fires it; a browser does not move the caret on right-click,
 * so the caret stays where the test put it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@milkdown/kit/core";

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
const { loggingService } = await import("../src/services/loggingService");
const support = await import("./support/raggedTableD64");
const { caretAfter, destroyParityEditors, docOf, mountParityEditor, posAfter, tableShapes, viewOf } =
  support;

const MD = "| H0 | H1 | H2 |\n| --- | --- | --- |\n| A0 | A1 | A2 |\n| B0 | B1 | B2 |\n\nend\n";

const logSpy = vi.mocked(loggingService.logEventSync);

/** Mount the editor inside `#milkdown-container` and register it in the store. */
async function mount(): Promise<Editor> {
  const e = await mountParityEditor(MD);
  const root = viewOf(e).dom.closest("body > div");
  if (!(root instanceof HTMLElement)) throw new Error("editor root not found");
  root.id = "milkdown-container";
  useMilkdownEditorStore.setState({ getEditor: () => e as never });
  render(<TableContextMenu />);
  return e;
}

/** Right-click the cell holding `needle`; posAtCoords resolves inside that cell. */
function rightClickCell(e: Editor, needle: string): void {
  const view = viewOf(e);
  const pos = posAfter(view, needle);
  view.posAtCoords = (() => ({ pos, inside: -1 })) as typeof view.posAtCoords;
  const cell = Array.from(view.dom.querySelectorAll<HTMLElement>("td, th")).find(
    (el) => el.textContent === needle,
  );
  if (!cell) throw new Error(`cell ${needle} not rendered`);
  fireEvent.contextMenu(cell, { clientX: 200, clientY: 100 });
}

function pickEvents(id: string) {
  return logSpy.mock.calls.map(([p]) => p).filter((p) => p.event === `editor.table.${id}`);
}

beforeEach(() => {
  logSpy.mockClear();
});

afterEach(async () => {
  useMilkdownEditorStore.setState({ getEditor: () => null });
  await destroyParityEditors();
});

describe("D81 component: the WYSIWYG table menu targets the clicked cell", () => {
  it("D81-C1 Align right from column 1 while the caret is in column 0", async () => {
    const user = userEvent.setup();
    const e = await mount();
    caretAfter(e, "A0");
    rightClickCell(e, "A1");
    await user.click(screen.getByRole("menuitemradio", { name: "Align right" }));

    const [shape] = tableShapes(docOf(e));
    for (const row of shape.align) expect(row[1]).toBe("right");
    for (const row of shape.align) expect(row[0]).not.toBe("right");
    expect(pickEvents("align_right")).toHaveLength(1);
    expect(pickEvents("align_right")[0]).toMatchObject({ status: "success" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("D81-C2 a doc edit while the menu is open makes the pick fail with reason stale-position", async () => {
    const user = userEvent.setup();
    const e = await mount();
    caretAfter(e, "A0");
    rightClickCell(e, "A1");
    expect(screen.getByRole("menu")).toBeTruthy();

    // An MCP set_cell lands while the menu is open: B0's text changes.
    const view = viewOf(e);
    view.dispatch(view.state.tr.insertText("x", posAfter(view, "B0")));

    await user.click(screen.getByRole("menuitemradio", { name: "Align right" }));

    const [shape] = tableShapes(docOf(e));
    for (const row of shape.align) expect(row).not.toContain("right");
    expect(shape.cells[2][0]).toBe("B0x");
    const events = pickEvents("align_right");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "fail",
      context: expect.objectContaining({ reason: "stale-position" }),
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
