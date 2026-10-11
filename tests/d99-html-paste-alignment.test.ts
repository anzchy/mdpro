/**
 * D99: an HTML table with no alignment, pasted into WYSIWYG, must stay unaligned.
 *
 * Measured on device (`docs/test/20261010-d67-d81-d83-d84-device-check.md`, D83
 * cases 3a / 3b): Clip-A (an in-app ⌘A/⌘C of `| s1 | s2 |` over `| --- | --- |`)
 * and `rag83.html` (plain `<th>`) both serialized with a `| :- | :- |` delimiter.
 * An HTML paste does not go through remark, so a cell's alignment comes from the
 * cell schema's DOM rules, and preset-gfm reads "no alignment" as `left`.
 *
 * The oracle for "unaligned" is the serializer's own output for the markdown
 * source (`| --- |` round-trips with no colon), not a hand-written delimiter.
 * Guards: a cell whose HTML does carry alignment (`style="text-align: …"` or
 * `align="…"`) keeps it, and a markdown-parsed table is unchanged.
 *
 * Paste is driven the way prosemirror-view's doPaste does it (see
 * `tests/table-paste-normalize.test.ts`); the in-app copy is the view's clipboard
 * serializer, `DOMSerializer.fromSchema` (no `clipboardSerializer` prop is set).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { DOMSerializer, Slice } from "@milkdown/kit/prose/model";
import { __parseFromClipboard } from "@milkdown/kit/prose/view";
import {
  caretAfter,
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";

afterEach(destroyParityEditors);

function pasteHtml(e: Editor, html: string): void {
  const view = viewOf(e);
  const slice = __parseFromClipboard(view, "", html, false, view.state.selection.$from);
  const event = new Event("paste") as ClipboardEvent;
  if (view.someProp("handlePaste", (f) => f(view, event, slice ?? Slice.empty))) return;
  if (!slice) return;
  const single =
    slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
      ? slice.content.firstChild
      : null;
  const tr = single
    ? view.state.tr.replaceSelectionWith(single, false)
    : view.state.tr.replaceSelection(slice);
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
}

/** The HTML an in-app ⌘A / ⌘C puts on the clipboard for the whole document. */
function copyAllAsHtml(e: Editor): string {
  const view = viewOf(e);
  const serializer = DOMSerializer.fromSchema(view.state.schema);
  const wrap = document.createElement("div");
  wrap.appendChild(serializer.serializeFragment(view.state.doc.content, { document }));
  return wrap.innerHTML;
}

/** The table block (header line through last row) whose first header cell is `first`. */
function tableBlock(markdown: string, first: string): string[] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^\\|\\s*${first}\\s*\\|`).test(l));
  if (at < 0) throw new Error(`table not found: ${first}`);
  const end = lines.findIndex((l, i) => i > at && !l.startsWith("|"));
  return lines.slice(at, end < 0 ? undefined : end);
}

/** The delimiter cells of the table whose first header cell is `first`, trimmed. */
function delimiterCells(markdown: string, first: string): string[] {
  return tableBlock(markdown, first)[1]
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

/** src83.md from the device record: a source table with no alignment. */
const SRC83 = "Before para.\n\n| s1 | s2 |\n| --- | --- |\n| P1 | P2 |\n\nAfter para.\n";

/** rag83.html from the D83 device brief, byte for byte. */
const RAG83 =
  '<meta charset="utf-8"><p>Rag before.</p><table><thead><tr><th>r1</th><th>r2</th></tr></thead>' +
  "<tbody><tr><td>Q1</td></tr><tr><td>Q2</td><td>Q3</td><td>Q4</td></tr></tbody></table><p>Rag after.</p>";

/** One column per alignment source: style center, align right, style left, none. */
const ALIGNED_HTML =
  "<table><thead><tr>" +
  '<th style="text-align: center">c</th><th align="right">r</th>' +
  '<th style="text-align: left">l</th><th>n</th>' +
  "</tr></thead><tbody><tr>" +
  '<td style="text-align: center">1</td><td align="right">2</td>' +
  '<td style="text-align: left">3</td><td>4</td>' +
  "</tr></tbody></table>";

const ALIGNED_MD =
  "Intro.\n\n| c | r | l | n |\n| :-: | --: | :-- | --- |\n| 1 | 2 | 3 | 4 |\n\nAnchor\n";

const BASE = "Intro.\n\nAnchor\n";

describe("D99 — an unaligned HTML table pastes unaligned", () => {
  it("A-1: Clip-A (in-app copy of a `| --- |` table) pastes as the source serializes it", async () => {
    const src = await mountParityEditor(SRC83);
    const sourceTable = tableBlock(serialize(src), "s1");
    const clip = copyAllAsHtml(src);

    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, clip);

    const [shape] = tableShapes(docOf(e));
    expect(shape.align).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(tableBlock(serialize(e), "s1")).toEqual(sourceTable);
    for (const cell of delimiterCells(serialize(e), "s1")) expect(cell).toMatch(/^-+$/);
  });

  it("A-2: rag83.html (plain <th>, ragged) pastes with no colon in any delimiter cell", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, RAG83);

    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.align).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
    const md = serialize(e);
    expect(delimiterCells(md, "r1")).toEqual(["--", "--", "--"]);
    expect(tableBlock(md, "r1")[0]).toMatch(/^\| r1 \| r2 \| +\|$/);
  });
});

describe("D99 — alignment the source does carry is kept (guards)", () => {
  it("G-1: style text-align and the align attribute both survive an HTML paste", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, ALIGNED_HTML);

    const [shape] = tableShapes(docOf(e));
    expect(shape.align).toEqual([
      ["center", "right", "left", null],
      ["center", "right", "left", null],
    ]);
    const cells = delimiterCells(serialize(e), "c");
    expect(cells[0]).toMatch(/^:-+:$/);
    expect(cells[1]).toMatch(/^-+:$/);
    expect(cells[2]).toMatch(/^:-+$/);
    expect(cells[3]).toMatch(/^-+$/);
  });

  it("G-2: a markdown-parsed table keeps its delimiter alignment (parse path unchanged)", async () => {
    const e = await mountParityEditor(ALIGNED_MD);
    const [shape] = tableShapes(docOf(e));
    expect(shape.align).toEqual([
      ["center", "right", "left", null],
      ["center", "right", "left", null],
    ]);
    const cells = delimiterCells(serialize(e), "c");
    expect(cells[0]).toMatch(/^:-+:$/);
    expect(cells[1]).toMatch(/^-+:$/);
    expect(cells[2]).toMatch(/^:-+$/);
    expect(cells[3]).toMatch(/^-+$/);
  });

  it("G-3: an in-app copy of a mixed-alignment table pastes back with every column as it was", async () => {
    const src = await mountParityEditor(ALIGNED_MD);
    const sourceTable = tableBlock(serialize(src), "c");
    const clip = copyAllAsHtml(src);

    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, clip);

    expect(tableShapes(docOf(e))[0].align).toEqual([
      ["center", "right", "left", null],
      ["center", "right", "left", null],
    ]);
    expect(tableBlock(serialize(e), "c")).toEqual(sourceTable);
  });
});
