/**
 * D67: both table context menus, mounted for real, keep the menu's bottom edge
 * inside the window when the rendered menu is taller than the old 480 px
 * constant (device evidence: docs/test/20261009-d49-d58-device-check.md F4).
 *
 * jsdom has no layout, so the two layout reads are stubbed at the boundary:
 * `window.innerWidth/innerHeight` (1200x800) and `getBoundingClientRect` for
 * the `.table-context-menu` element only (220x560, the measured size of the
 * 15-item menu). Everything else delegates to jsdom's original.
 *
 * Harnesses:
 *   - Source: a real `#source-container` holding a real CodeMirror
 *     `EditorView` in `useEditorStore` (same as the withheld test);
 *     `posAtCoords` is stubbed on the instance.
 *   - WYSIWYG: a `#milkdown-container > .ProseMirror > table` DOM target and a
 *     fake Milkdown editor in `useMilkdownEditorStore` whose view resolves into
 *     a REAL ProseMirror table document, so `computeTableContext` runs real.
 * `loggingService` crosses IPC and is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Schema } from "@milkdown/kit/prose/model";
import { tableNodes } from "@milkdown/kit/prose/tables";

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

const { tableDetectionExtension } = await import(
  "../src/plugins/codemirror/sourceTableDetection"
);
const { SourceTableContextMenu } = await import(
  "../src/components/Editor/SourceTableContextMenu"
);
const { TableContextMenu } = await import("../src/components/Editor/TableContextMenu");
const { useEditorStore } = await import("../src/stores/editorStore");
const { useDocumentStore } = await import("../src/stores/documentStore");
const { useMilkdownEditorStore } = await import("../src/stores/milkdownEditorStore");

const VIEW_W = 1200;
const VIEW_H = 800;
const PAD = 8;
const MENU_H = 560;
const MENU_W = 220;
const CLICK = { clientX: 300, clientY: 500 };

const SIMPLE_MD = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalW = Object.getOwnPropertyDescriptor(window, "innerWidth");
const originalH = Object.getOwnPropertyDescriptor(window, "innerHeight");
const cleanups: Array<() => void> = [];

function stubLayout() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: VIEW_W });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VIEW_H });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("table-context-menu")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: MENU_W, height: MENU_H });
    }
    return originalRect.call(this);
  };
}

function restoreLayout() {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  if (originalW) Object.defineProperty(window, "innerWidth", originalW);
  if (originalH) Object.defineProperty(window, "innerHeight", originalH);
}

function menuBox(): { top: number; left: number } {
  const menu = screen.getByRole("menu");
  return { top: parseFloat(menu.style.top), left: parseFloat(menu.style.left) };
}

function mountSource(): HTMLElement {
  const container = document.createElement("div");
  container.id = "source-container";
  document.body.appendChild(container);
  const view = new EditorView({
    state: EditorState.create({
      doc: SIMPLE_MD,
      selection: EditorSelection.cursor(0),
      extensions: [markdown(), tableDetectionExtension()],
    }),
    parent: container,
  });
  view.posAtCoords = (() => SIMPLE_MD.indexOf("2")) as EditorView["posAtCoords"];
  useEditorStore.setState({ editorView: view });
  cleanups.push(() => {
    view.destroy();
    container.remove();
    useEditorStore.setState({ editorView: null });
  });
  render(<SourceTableContextMenu />);
  const line = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")).find(
    (el) => el.textContent === "| 1 | 2 | 3 |",
  );
  if (!line) throw new Error("row line not rendered");
  return line;
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
    ...tableNodes({
      tableGroup: "block",
      cellContent: "paragraph",
      cellAttributes: { alignment: { default: "left" } },
    }),
  },
});

function buildTableDoc() {
  const cell = (t: string) =>
    schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text(t)));
  const row = (cells: string[]) => schema.nodes.table_row.create(null, cells.map(cell));
  return schema.nodes.doc.create(null, [
    schema.nodes.table.create(null, [row(["a", "b"]), row(["1", "2"])]),
  ]);
}

function mountWysiwyg(): HTMLElement {
  const doc = buildTableDoc();
  let cellPos = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === "2") cellPos = pos;
  });
  const fakeView = {
    posAtCoords: () => ({ pos: cellPos }),
    state: { doc, selection: { $from: doc.resolve(cellPos) } },
  };
  const fakeEditor = { action: (fn: (ctx: unknown) => void) => fn({ get: () => fakeView }) };
  useMilkdownEditorStore.setState({ getEditor: () => fakeEditor });

  const container = document.createElement("div");
  container.id = "milkdown-container";
  container.innerHTML =
    '<div class="ProseMirror"><table><tbody><tr><td id="d67-cell">2</td></tr></tbody></table></div>';
  document.body.appendChild(container);
  cleanups.push(() => {
    container.remove();
    useMilkdownEditorStore.setState({ getEditor: () => null });
  });
  render(<TableContextMenu />);
  const cell = container.querySelector<HTMLElement>("#d67-cell");
  if (!cell) throw new Error("cell not rendered");
  return cell;
}

beforeEach(() => {
  useEditorStore.setState({ sourceTableVerdicts: {}, activeDocumentId: "doc-Z" });
  useDocumentStore.setState({ documents: [], activeDocumentId: "doc-A" });
  stubLayout();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  restoreLayout();
});

describe("D67 component: the opened menu's bottom edge stays inside the window", () => {
  it("D67-C1 source menu opened at y=500 with a 560 px menu", () => {
    const target = mountSource();
    fireEvent.contextMenu(target, CLICK);
    const { top, left } = menuBox();
    expect(top + MENU_H).toBeLessThanOrEqual(VIEW_H - PAD);
    expect(top).toBeGreaterThanOrEqual(PAD);
    expect(left).toBe(CLICK.clientX);
  });

  it("D67-C2 WYSIWYG menu opened at y=500 with a 560 px menu", () => {
    const target = mountWysiwyg();
    fireEvent.contextMenu(target, CLICK);
    const { top, left } = menuBox();
    expect(top + MENU_H).toBeLessThanOrEqual(VIEW_H - PAD);
    expect(top).toBeGreaterThanOrEqual(PAD);
    expect(left).toBe(CLICK.clientX);
  });

  it("D67-C3 a menu that fits below the click opens exactly at the click (both menus)", () => {
    const high = { clientX: 300, clientY: 100 };
    const source = mountSource();
    fireEvent.contextMenu(source, high);
    expect(menuBox()).toEqual({ top: 100, left: 300 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    while (cleanups.length) cleanups.pop()?.();

    const wysiwyg = mountWysiwyg();
    fireEvent.contextMenu(wysiwyg, high);
    expect(menuBox()).toEqual({ top: 100, left: 300 });
  });

  it("D67-C4 the first enabled item still receives focus after the position correction", () => {
    const target = mountSource();
    fireEvent.contextMenu(target, CLICK);
    const menu = screen.getByRole("menu");
    const first = menu.querySelector('button[role="menuitem"]:not([aria-disabled="true"])');
    expect(first).not.toBeNull();
    expect(document.activeElement).toBe(first);
  });
});
