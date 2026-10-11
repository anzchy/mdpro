/**
 * D135: a cell paste that widens the host table must not invent an alignment for
 * the columns the widen adds.
 *
 * prosemirror-tables' `handlePaste` → `insertCells` → `growTable` fills every
 * added column and row with `createAndFill()` — the schema default, which
 * preset-gfm sets to `alignment: "left"`. The serializer reads a table's column
 * alignment from its header row only, so the D83-3 paste serialized as
 * `| -- | -- | :- |`: a `left` the user never set.
 *
 * Expected: a header cell the widen adds carries no alignment (no colon in its
 * delimiter); the host's existing columns keep theirs; a row the widen adds takes
 * each existing column's header alignment (Milkdown's own add-row convention) and
 * `null` in an added column. Cells the paste itself wrote are left as pasted.
 *
 * Paste is driven the way prosemirror-view's doPaste does it (same driver as
 * tests/d83-paste-mixed-slice-in-table.test.ts): parseFromClipboard →
 * handlePaste → replaceSelection(With). Real Milkdown commonmark + gfm + the
 * parity list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { Fragment, Slice } from "@milkdown/kit/prose/model";
import { __parseFromClipboard } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import {
  caretAfter,
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyParityEditors();
});

function pasteHtml(e: Editor, html: string): void {
  const view = viewOf(e);
  const slice = __parseFromClipboard(view, "", html, false, view.state.selection.$from);
  const event = new Event("paste") as ClipboardEvent;
  if (view.someProp("handlePaste", (f) => f(view, event, slice ?? Slice.empty))) return;
  if (!slice) return;
  view.dispatch(view.state.tr.replaceSelection(slice).setMeta("paste", true).setMeta("uiEvent", "paste"));
}

const row = (tag: "th" | "td", cells: string[]) =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;

/** D83-3's paste: header h1,h2; body rows of 3 and 1 cells — pasted as cells it is 3 wide. */
const RAGGED =
  `<table><thead>${row("th", ["h1", "h2"])}</thead>` +
  `<tbody>${row("td", ["a", "b", "c"])}${row("td", ["d"])}</tbody></table>`;


const HOST = "| X1 | X2 |\n| -- | -- |\n| y1 | y2 |\n";
const ALIGNED_HOST = "| X1 | X2 |\n| :-: | --: |\n| y1 | y2 |\n";

/** A copy source after the host: header s1,s2 over body rows p,q and r,s. */
const SOURCE = "| s1 | s2 |\n| -- | -- |\n| p  | q  |\n| r  | s  |\n";

/**
 * Paste the source table's two body rows as an open slice of rows — the shape a
 * CellSelection copy puts on the clipboard (D83-4b) — through the registered
 * `handlePaste` props, with the caret after `needle`.
 */
function pasteSourceRows(e: Editor, needle: string): void {
  caretAfter(e, needle);
  const view = viewOf(e);
  const source = docOf(e).child(1);
  if (source.type.name !== "table") throw new Error("source table missing");
  const rows = new Slice(Fragment.from([source.child(1), source.child(2)]), 1, 1);
  const event = new Event("paste") as ClipboardEvent;
  expect(view.someProp("handlePaste", (f) => f(view, event, rows))).toBe(true);
}

type Align = "none" | "left" | "center" | "right";

/** The alignment each delimiter cell of the first table in `md` spells. */
function delimiterAlignments(md: string): Align[] {
  const line = md.split("\n")[1];
  if (!line || !/^\|[\s:|-]+\|$/.test(line)) throw new Error(`no delimiter row: ${line}`);
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
    .map((c): Align => {
      if (/^:-+:$/.test(c)) return "center";
      if (/^-+:$/.test(c)) return "right";
      if (/^:-+$/.test(c)) return "left";
      if (/^-+$/.test(c)) return "none";
      throw new Error(`not a delimiter cell: ${c}`);
    });
}

const widenLogs = () =>
  logSpy.mock.calls
    .map((c) => c[0] as { event: string; status?: string; context?: Record<string, unknown> })
    .filter((p) => p.event === "editor.table.paste-widened");

describe("D135 — a widening cell paste adds columns with no alignment", () => {
  it("D135-1: the D83-3 paste serializes with no colon on the added column", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    pasteHtml(e, RAGGED);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].width).toBe(3);
    expect(shapes[0].align[0]).toEqual([null, null, null]);
    expect(delimiterAlignments(serialize(e))).toEqual(["none", "none", "none"]);
  });

  it("D135-2: an aligned host keeps :-: and --: on its own columns; only the added one is bare", async () => {
    const e = await mountParityEditor(ALIGNED_HOST);
    caretAfter(e, "y1");
    pasteHtml(e, RAGGED);
    expect(tableShapes(docOf(e))[0].align[0]).toEqual(["center", "right", null]);
    expect(delimiterAlignments(serialize(e))).toEqual(["center", "right", "none"]);
  });

  it("D135-3: a paste that widens and lengthens — added rows take the column's header alignment", async () => {
    const e = await mountParityEditor(`${ALIGNED_HOST}\n${SOURCE}`);
    pasteSourceRows(e, "y2");
    const [shape] = tableShapes(docOf(e));
    // Written from (1, 1): p,q in row 1 cols 1–2; r,s in a new row 2.
    expect(shape.cells).toEqual([
      ["X1", "X2", ""],
      ["y1", "p", "q"],
      ["", "r", "s"],
    ]);
    // Header: host columns kept, added column bare.
    expect(shape.align[0]).toEqual(["center", "right", null]);
    // The added row's cell in an existing column follows that column's header.
    expect(shape.align[2][0]).toBe("center");
    expect(delimiterAlignments(serialize(e))).toEqual(["center", "right", "none"]);
  });

  it("D135-4: the reset is logged once as editor.table.paste-widened with the widths", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    pasteHtml(e, RAGGED);
    const logs = widenLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("success");
    expect(logs[0].context).toMatchObject({ fromColCount: 2, toColCount: 3 });
  });

  it("D135-5: a cell paste that does not widen leaves alignment alone and logs nothing", async () => {
    const e = await mountParityEditor(`${ALIGNED_HOST}\n${SOURCE}`);
    pasteSourceRows(e, "y1");
    const [shape] = tableShapes(docOf(e));
    // Written from (1, 0): it lengthens the table by a row but stays 2 wide.
    expect(shape.cells).toEqual([
      ["X1", "X2"],
      ["p", "q"],
      ["r", "s"],
    ]);
    expect(delimiterAlignments(serialize(e))).toEqual(["center", "right"]);
    expect(widenLogs()).toHaveLength(0);
  });
});
