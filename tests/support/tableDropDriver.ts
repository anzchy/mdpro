/**
 * @module tests/support/tableDropDriver
 * Purpose: the drop driver, slice fixtures and position oracles shared by the
 * D90 / D94 / D102 table-drop suites. Not a `*.test.ts`, so vitest does not
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
import type { EditorView } from "@milkdown/kit/prose/view";
import { expect, vi } from "vitest";
import { useToastStore } from "../../src/stores/toastStore";
import { destroyParityEditors, docOf, mountParityEditor, serialize, tableShapes, viewOf } from "./raggedTableD64";

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

export const DROP_TOAST = "A table can't be dropped inside a table cell. Drop it outside the table.";

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
