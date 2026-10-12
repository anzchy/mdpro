/**
 * @module tests/support/d162PasteTargets
 * Purpose: table oracles for the D162-WI-3 paste-listener regression — the
 * selected rect, the host slots a paste must leave alone, the cells that cross a
 * rect's edge, and a driver that gives the host a span by pasting one. Not a `*.test.ts`, so vitest does
 * not collect it.
 */
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { CellSelection, type Rect, TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";

/** The doc's only table node. */
export function tableOf(doc: PmNode): PmNode {
  let found: PmNode | null = null;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "table") {
      found = node;
      return false;
    }
    return true;
  });
  if (!found) throw new Error("no table in doc");
  return found;
}

/** The rect of a CellSelection, or null when the selection is not one. */
export function selectionRect(view: EditorView): Rect | null {
  const sel = view.state.selection;
  if (!(sel instanceof CellSelection)) return null;
  const table = sel.$anchorCell.node(-1);
  const start = sel.$anchorCell.start(-1);
  return TableMap.get(table).rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const inside = (a: Rect, b: Rect): boolean =>
  a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;

/** Each cell of `table` with its rect and text. */
export function cellRects(table: PmNode): { rect: Rect; text: string }[] {
  const map = TableMap.get(table);
  const seen = new Set<number>();
  const out: { rect: Rect; text: string }[] = [];
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    out.push({ rect: map.findCell(pos), text: table.nodeAt(pos)?.textContent ?? "" });
  }
  return out;
}

/**
 * The text of each slot whose host cell lies wholly outside `rect` (keyed
 * `row,col`): the slots a paste into `rect` must not touch. A cell that straddles
 * `rect`'s edge is split by the paste, so its slots are not in here.
 */
export function untouchedSlots(table: PmNode, rect: Rect): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cellRects(table)) {
    if (overlaps(c.rect, rect)) continue;
    for (let r = c.rect.top; r < c.rect.bottom; r += 1) {
      for (let col = c.rect.left; col < c.rect.right; col += 1) out.set(`${r},${col}`, c.text);
    }
  }
  return out;
}

/** The text of each slot of `table`, keyed `row,col`. */
export function allSlots(table: PmNode): Map<string, string> {
  const map = TableMap.get(table);
  const out = new Map<string, string>();
  for (let r = 0; r < map.height; r += 1) {
    for (let c = 0; c < map.width; c += 1) {
      out.set(`${r},${c}`, table.nodeAt(map.map[r * map.width + c])?.textContent ?? "");
    }
  }
  return out;
}

/** Cells that straddle `rect`'s edge: partly inside, partly out. */
export function crossing(table: PmNode, rect: Rect): Rect[] {
  return cellRects(table)
    .map((c) => c.rect)
    .filter((r) => overlaps(r, rect) && !inside(r, rect));
}

/** Paste `html` through prosemirror-view's own paste listener; returns the event. */
export function pasteHtml(view: EditorView, html: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (t: string) => (t === "text/html" ? html : ""), types: ["text/html"], files: [] },
  });
  view.dom.dispatchEvent(event);
  return event;
}

/** A 2-row span V at the caret, with W and X beside it. */
export const VSPAN = '<table><tr><td rowspan="2">V</td><td>W</td></tr><tr><td>X</td></tr></table>';
/** A 2-column span H at the caret, with I and J below it. */
export const HSPAN = '<table><tr><td colspan="2">H</td></tr><tr><td>I</td><td>J</td></tr></table>';

/**
 * Give the host a span by pasting `html` at the caret in `cell` (a host span the
 * user can make: mdpro's GFM tables load without spans). Returns the span's rect.
 */
export function seedSpan(view: EditorView, cell: number, html: string): Rect {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cell + 2)));
  const event = pasteHtml(view, html);
  if (!event.defaultPrevented) throw new Error("seed paste not handled");
  const span = cellRects(tableOf(view.state.doc)).find((c) => c.text === "V" || c.text === "H");
  if (!span) throw new Error("seed span missing");
  return span.rect;
}
