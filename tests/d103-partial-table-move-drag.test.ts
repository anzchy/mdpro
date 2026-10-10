/**
 * D103 (reproduction): a move-drag whose source selection crosses a table edge —
 * from a paragraph into a cell, or from a cell out into a paragraph — dropped
 * OUTSIDE any table. `handleDrop` in pasteTableNormalize.ts only refuses drops
 * that land inside a table, so prosemirror-view's drop handler runs:
 * `tr.deleteSelection()` on the source (move), then `tr.replaceRange` of the
 * slice at the drop point. Neither step is checked for what it leaves behind.
 *
 * The safe outcome asserted here: either the drop is refused (document
 * unchanged), or afterwards every table is rectangular (TableMap reports no
 * problems) and the document still serializes. A failing case reproduces D103.
 *
 * Driven through prosemirror-view's own drop handler (tests/support/
 * tableDropDriver.ts, only `posAtCoords` stubbed); the drop event carries no
 * copy modifier, so prosemirror-view's `dragMoves` treats it as a move. Real
 * Milkdown commonmark + gfm + the parity list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  posAfter,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";
import { drop, HOST } from "./support/tableDropDriver";

const MD = `Pre\n\n${HOST}\nPost\n`;

beforeEach(() => {
  useToastStore.getState().clearToast();
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  useToastStore.getState().clearToast();
  await destroyParityEditors();
});

const ancestors = (doc: PmNode, pos: number): string[] => {
  const $p = doc.resolve(pos);
  return Array.from({ length: $p.depth + 1 }, (_, d) => $p.node(d).type.name);
};
const inCell = (names: string[]) => names.includes("table_cell") || names.includes("table_header");

/** Select from just after `fromNeedle` to just after `toNeedle`. */
function select(e: Editor, fromNeedle: string, toNeedle: string): void {
  const view = viewOf(e);
  const sel = TextSelection.create(
    view.state.doc,
    posAfter(view, fromNeedle),
    posAfter(view, toNeedle),
  );
  view.dispatch(view.state.tr.setSelection(sel));
}

/** Refused (unchanged), or every table rectangular and the document serializes. */
function safeOutcome(e: Editor, before: PmNode) {
  if (docOf(e).eq(before)) return { refused: true };
  let serializeError: string | null = null;
  try {
    serialize(e);
  } catch (err) {
    serializeError = err instanceof Error ? err.message : String(err);
  }
  const problems = tableShapes(docOf(e))
    .filter((s) => s.problems !== null)
    .map((s) => ({ problems: s.problems, cells: s.cells }));
  return { serializeError, problems };
}

const SAFE_IF_CHANGED = { serializeError: null, problems: [] };

describe("D103 — a move-drag of a selection crossing a table edge, dropped outside the table", () => {
  // [id, from-needle, to-needle, direction]: the selection starts right after the
  // first needle and ends right after the second.
  const cases: [string, string, string, "into" | "out"][] = [
    ["D103-1: paragraph 'Pre' -> body cell 'y1'", "P", "y1", "into"],
    ["D103-2: paragraph 'Pre' -> header cell 'X2'", "P", "X2", "into"],
    ["D103-3: body cell 'y1' -> trailing paragraph 'Post'", "y", "Post", "out"],
    ["D103-4 (control): paragraph 'Pre' -> header cell 'X1'", "P", "X1", "into"],
    ["D103-5 (control): paragraph 'Pre' -> last body cell 'y2'", "P", "y2", "into"],
  ];

  for (const [name, fromNeedle, toNeedle, dir] of cases) {
    it(`${name}: refused, or leaves only rectangular tables that serialize`, async () => {
      const e = await mountParityEditor(MD);
      const view = viewOf(e);
      select(e, fromNeedle, toNeedle);

      // Non-vacuous: a TextSelection whose one end is in a paragraph and the
      // other in a cell, and whose slice carries a table.
      const sel = view.state.selection;
      expect(sel).toBeInstanceOf(TextSelection);
      const [para, cell] = dir === "into" ? [sel.from, sel.to] : [sel.to, sel.from];
      expect(inCell(ancestors(view.state.doc, para))).toBe(false);
      expect(inCell(ancestors(view.state.doc, cell))).toBe(true);
      const slice = sel.content();
      let carriesTable = false;
      slice.content.forEach((n) => {
        if (n.type.name === "table") carriesTable = true;
      });
      expect(carriesTable).toBe(true);

      // Drop at the end of the trailing paragraph 'Post': outside every table.
      const dropPos = view.state.doc.content.size - 1;
      const names = ancestors(view.state.doc, dropPos);
      expect(names).not.toContain("table");
      expect(names.at(-1)).toBe("paragraph");

      const before = docOf(e);
      expect(() => drop(view, dropPos, { slice })).not.toThrow();
      const outcome = safeOutcome(e, before);
      if (!("refused" in outcome)) expect(outcome).toEqual(SAFE_IF_CHANGED);
    });
  }
});
