/**
 * D64/D65 WI-3 (ADR-0067 Decision 4): an HTML paste does not go through remark, so
 * the parse-time widener never sees it. A ragged table in a pasted slice must be
 * end-padded before dispatch — otherwise prosemirror-tables' fixTables repairs it
 * at the row start. Plain-text paste keeps today's behaviour: paragraphs, no table.
 *
 * Paste is driven the way prosemirror-view's doPaste does it: parseFromClipboard
 * (transformPastedHTML → DOM parser → transformPasted), then handlePaste, then
 * replaceSelection(With). Real Milkdown commonmark + gfm + the parity list.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";
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

function paste(e: Editor, text: string, html: string | null, preferPlain: boolean): void {
  const view = viewOf(e);
  const slice = __parseFromClipboard(view, text, html, preferPlain, view.state.selection.$from);
  const event = new Event("paste") as ClipboardEvent;
  if (view.someProp("handlePaste", (f) => f(view, event, slice ?? Slice.empty))) return;
  if (!slice) return;
  const single =
    slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
      ? slice.content.firstChild
      : null;
  const tr = single
    ? view.state.tr.replaceSelectionWith(single, preferPlain)
    : view.state.tr.replaceSelection(slice);
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
}

const pasteHtml = (e: Editor, html: string) => paste(e, "", html, false);

const row = (tag: "th" | "td", cells: string[]) =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;

/** Header h1,h2; body rows of 3 and 4 cells — overflow past the header. */
const RAGGED_OVERFLOW =
  `<table><thead>${row("th", ["h1", "h2"])}</thead>` +
  `<tbody>${row("td", ["a", "b", "c"])}${row("td", ["d", "e", "f", "g"])}</tbody></table>`;

const BASE = "Intro.\n\nAnchor\n";

describe("WI-3 — HTML paste end-pads ragged tables", () => {
  it("P-1: overflow rows pad at the row end; the header widens with blank cells", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, RAGGED_OVERFLOW);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].problems).toBeNull();
    expect(shapes[0].cells).toEqual([
      ["h1", "h2", "", ""],
      ["a", "b", "c", ""],
      ["d", "e", "f", "g"],
    ]);
  });

  it("P-2: added header cells carry explicit null alignment and serialize as ---", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, RAGGED_OVERFLOW);
    const [shape] = tableShapes(docOf(e));
    expect(shape.align[0].slice(2)).toEqual([null, null]);
    const md = serialize(e);
    expect(md).not.toContain("<br");
    const delimiter = md.split("\n").find((l) => /^\|\s*:?-+/.test(l));
    // Changed assertion with a stated reason (D64 WI-3, after red): the recorded
    // form expected literal `---`, but markdown-table sizes a delimiter to its
    // column, so a 1-character column writes `-`. The intent was "no colon", i.e.
    // the explicit null alignment; assert that shape instead.
    for (const cell of delimiter?.split("|").slice(3, 5) ?? []) expect(cell.trim()).toMatch(/^-+$/);
  });

  it("P-3: a short body row pads at its end", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(
      e,
      `<table><thead>${row("th", ["h1", "h2", "h3"])}</thead>` +
        `<tbody>${row("td", ["only"])}${row("td", ["x", "y", "z"])}</tbody></table>`,
    );
    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.cells).toEqual([
      ["h1", "h2", "h3"],
      ["only", "", ""],
      ["x", "y", "z"],
    ]);
  });

  it("P-4: a ragged table inside a pasted blockquote pads at the row end", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(e, `<p>before</p><blockquote>${RAGGED_OVERFLOW}</blockquote><p>after</p>`);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].problems).toBeNull();
    expect(shapes[0].cells[0]).toEqual(["h1", "h2", "", ""]);
    expect(shapes[0].cells[1]).toEqual(["a", "b", "c", ""]);
  });

  it("P-5: a rectangular pasted table keeps its cells and alignment", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    pasteHtml(
      e,
      `<table><thead>${row("th", ["h1", "h2"])}</thead><tbody>${row("td", ["a", "b"])}</tbody></table>`,
    );
    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.cells).toEqual([
      ["h1", "h2"],
      ["a", "b"],
    ]);
    // Changed assertion with a stated reason (D99): this pinned preset-gfm's
    // reading of an un-styled <th>/<td> as `left`, which is the D99 defect (an
    // unaligned table pasted back as `| :- |`). "Keeps its alignment" for cells
    // that carry none is `null`; tests/d99-html-paste-alignment.test.ts owns the rule.
    expect(shape.align).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("P-6: pasting a ragged table into a table cell leaves a rectangular table", async () => {
    const e = await mountParityEditor("| A | B |\n| - | - |\n| c | d |\n");
    caretAfter(e, "c");
    pasteHtml(e, RAGGED_OVERFLOW);
    for (const shape of tableShapes(docOf(e))) expect(shape.problems).toBeNull();
  });
});

describe("WI-3 — plain-text paste is unchanged (pinned)", () => {
  const PIPES = "| h1 | h2 |\n| -- | -- |\n| a | b | c |";

  it("P-7: ragged pipe text pasted as plain text becomes paragraphs, not a table", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    paste(e, PIPES, null, true);
    expect(tableShapes(docOf(e))).toHaveLength(0);
    const texts: string[] = [];
    docOf(e).forEach((n) => texts.push(n.textContent));
    expect(texts).toEqual(["Intro.", "Anchor| h1 | h2 |", "| -- | -- |", "| a | b | c |"]);
  });

  it("P-8: plain text with an HTML flavour still takes the plain path when preferred", async () => {
    const e = await mountParityEditor(BASE);
    caretAfter(e, "Anchor");
    paste(e, PIPES, RAGGED_OVERFLOW, true);
    expect(tableShapes(docOf(e))).toHaveLength(0);
  });
});
