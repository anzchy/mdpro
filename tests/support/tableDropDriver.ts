/**
 * @module tests/support/tableDropDriver
 * Purpose: the drop driver, cell-selection and copy helpers, slice fixtures,
 * position oracles and refusal copy / log oracles shared by the D83 / D90 / D91 /
 * D94 / D102 / D136 table suites. Not a `*.test.ts`, so vitest does not
 * collect it.
 *
 * The drop goes through prosemirror-view's own `drop` handler: a `drop` event
 * dispatched on `view.dom`, with a DataTransfer stub (external drop) or
 * `view.dragging` set (internal drag). Only the layout-dependent
 * `view.posAtCoords` is stubbed.
 *
 * Move vs copy: prosemirror-view 1.41.5 does not read `view.dragging.move` on
 * drop. Its `dragMoves` decides from the drop event's copy modifier — `altKey`
 * on macOS, `ctrlKey` elsewhere (jsdom is not detected as a Mac) — unless a
 * `dragCopies` prop answers first. So `move` is expressed on the event: a move
 * carries neither modifier, a copy carries both (whichever the platform reads).
 */
import type { Node as PmNode, Slice } from "@milkdown/kit/prose/model";
import { CellSelection } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { expect, vi } from "vitest";
import { useToastStore } from "../../src/stores/toastStore";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  posAfter,
  serialize,
  tableShapes,
  viewOf,
} from "./raggedTableD64";

const row = (tag: "th" | "td", cells: string[]) =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;

/** A closed 2x2 HTML table. */
export const TABLE =
  `<table><thead>${row("th", ["h1", "h2"])}</thead>` +
  `<tbody>${row("td", ["a", "b"])}</tbody></table>`;

/** paragraph + table + paragraph: parsed open at its paragraph edges. */
export const MIXED = `<p>before</p>${TABLE}<p>after</p>`;

/** The dropped table's cells, header row first. */
export const DROPPED_CELLS = [
  ["h1", "h2"],
  ["a", "b"],
];

/** An existing rectangular table whose values share nothing with the dropped one. */
export const HOST = "| X1 | X2 |\n| -- | -- |\n| y1 | y2 |\n";

/** Refusal copy, per operation (D91 ⑤): what is checked is the host table splitting. */
export const PASTE_TOAST = "This paste would split the current table. Paste it outside the table.";
export const DROP_TOAST = "This drop would split the current table. Drop it outside the table.";

/** The `reason` a refusal's `fail` log carries, per operation (D91 ⑤). */
export const PASTE_REASON = "table-carrying slice not pasted as cells would split the host table";
export const DROP_REASON = "table-carrying drop would break the host table";

/**
 * Refusal copy and reason for a table-carrying slice pasted over a CellSelection
 * (D136): prosemirror-tables would fit it into the selected cells, dropping the
 * table and everything after it — nothing is split.
 */
export const CELL_PASTE_TOAST =
  "A table mixed with other content can't be pasted over selected cells. Paste it outside the table.";
export const CELL_PASTE_REASON = "table-carrying slice not pasted as cells would be dropped by the cell selection";

/** The shape of an `editor.table.paste` / `editor.table.drop` log call. */
export interface RefusalLog {
  level: string;
  event: string;
  status: string;
  actionId?: string;
  context?: Record<string, unknown>;
}

/**
 * Assert `logs` (one event's calls) is exactly one refusal: a `start` then a
 * `fail` under the same actionId (D91 ④, rule 20).
 */
export function expectOneRefusal(logs: RefusalLog[]): void {
  expect(logs.map((l) => l.status)).toEqual(["start", "fail"]);
  expect(logs[1].actionId).toBe(logs[0].actionId);
}

/** Position before the table cell holding `needle`. */
export function cellPosOf(view: EditorView, needle: string): number {
  const $p = view.state.doc.resolve(posAfter(view, needle));
  let d = $p.depth;
  while (d > 0 && !/table_(cell|header)/.test($p.node(d).type.name)) d -= 1;
  return $p.before(d);
}

/** Select the cells from `fromNeedle` to `toNeedle` as a CellSelection. */
export function selectCells(view: EditorView, fromNeedle: string, toNeedle: string): void {
  const sel = CellSelection.create(view.state.doc, cellPosOf(view, fromNeedle), cellPosOf(view, toNeedle));
  view.dispatch(view.state.tr.setSelection(sel));
}

/**
 * Select the cells from `fromNeedle` to `toNeedle` and copy them through
 * prosemirror-view's own copy handler; returns the clipboard HTML.
 */
export function copyCells(view: EditorView, fromNeedle: string, toNeedle: string): string {
  selectCells(view, fromNeedle, toNeedle);
  const data = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { clearData: () => data.clear(), setData: (t: string, v: string) => data.set(t, v) },
  });
  view.dom.dispatchEvent(event);
  const html = data.get("text/html");
  if (!html) throw new Error("copy produced no text/html");
  return html;
}

export interface DropOptions {
  /** External drop: the dataTransfer's `text/html`. */
  html?: string;
  /** Internal drag: the slice prosemirror-view holds in `view.dragging`. */
  slice?: Slice;
  /**
   * Internal drag only: `true` (default) drops as a move — the source range is
   * deleted; `false` drops as a copy. Set through the event's copy modifier,
   * which is what prosemirror-view reads (see the module header).
   */
  move?: boolean;
}

/**
 * Drop at document position `pos` through prosemirror-view's drop handler.
 * Returns whether the event's default was prevented.
 */
export function drop(view: EditorView, pos: number, opts: DropOptions): boolean {
  vi.spyOn(view, "posAtCoords").mockReturnValue({ pos, inside: -1 });
  const move = opts.move ?? true;
  if (opts.slice) {
    (view as unknown as { dragging: unknown }).dragging = { slice: opts.slice, move };
  }
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: 10 },
    clientY: { value: 20 },
    ctrlKey: { value: !move },
    altKey: { value: !move },
    dataTransfer: {
      value: {
        getData: (type: string) => (type === "text/html" ? (opts.html ?? "") : ""),
        files: [],
        types: opts.html ? ["text/html"] : [],
      },
    },
  });
  view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Every position inside a table's content that is NOT inside a cell: table
 * start/end edges, row edges, and the boundaries between cells and rows. Derived
 * from the document's ancestor names (independent of the code under test), not
 * hard-coded. Assumes no table nested inside a cell.
 */
export function inTableNonCellPositions(doc: PmNode): number[] {
  const out: number[] = [];
  for (let p = 0; p <= doc.content.size; p += 1) {
    const $p = doc.resolve(p);
    const names = Array.from({ length: $p.depth + 1 }, (_, d) => $p.node(d).type.name);
    const inTable = names.includes("table");
    const inCell = names.includes("table_cell") || names.includes("table_header");
    if (inTable && !inCell) out.push(p);
  }
  return out;
}

/**
 * The outer-edge chain of the first table in `doc`: its content start, its first
 * row's start, its last row's end and its content end. Derived from the table's
 * own position and size, not from the code under test.
 */
export function outerEdgeChain(doc: PmNode): number[] {
  let at = -1;
  let size = 0;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name !== "table") return true;
    at = pos;
    size = node.nodeSize;
    return false;
  });
  if (at < 0) throw new Error("no table in doc");
  return [at + 1, at + 2, at + size - 2, at + size - 1];
}

/**
 * Mount `md` (one host table), drop MIXED at `pos`, and assert the drop LANDED:
 * no refusal log or toast, the dropped table beside the host, the host's cells
 * unchanged, both paragraphs present, and the document still serializes with the
 * host's rows intact. `dropLogs` returns the `editor.table.drop` log calls so far.
 */
export async function expectLandsAt(md: string, pos: number, dropLogs: () => unknown[]): Promise<void> {
  const e = await mountParityEditor(md);
  const host = tableShapes(docOf(e)).map((s) => s.cells);
  expect(host).toHaveLength(1);
  drop(viewOf(e), pos, { html: MIXED });
  expect(dropLogs(), `refused at ${pos}`).toHaveLength(0);
  expect(useToastStore.getState().message).toBeNull();
  const cells = tableShapes(docOf(e)).map((s) => s.cells);
  expect(cells, `tables after a drop at ${pos}`).toHaveLength(2);
  expect(cells).toContainEqual(host[0]);
  expect(cells).toContainEqual(DROPPED_CELLS);
  expect(docOf(e).textContent).toContain("before");
  expect(docOf(e).textContent).toContain("after");
  expect(() => serialize(e)).not.toThrow();
  expect(serialize(e)).toContain("| X1 | X2 |");
  expect(serialize(e)).toContain("| y1 | y2 |");
  await destroyParityEditors();
}
