/**
 * D64 WI-1 (ADR-0067 Decision 3): a GFM table cell whose only content is an
 * empty paragraph serializes as an empty cell, never `<br />`.
 *
 * Real Milkdown editor with the presets MilkdownEditor.tsx uses (commonmark +
 * gfm) plus the exported `tableEmptyCellSerializerPlugin` it registers. No
 * mocks: nothing here reaches Tauri.
 *
 * Expected strings were derived before the fix: unchanged cases (E-4, E-5) are
 * the measured HEAD output, and the blank-cell cases are what Milkdown's own
 * remark stringifier writes for an mdast `tableCell` with no children.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defaultValueCtx, Editor, editorViewCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { addColumnAfter, addRowAfter } from "@milkdown/kit/prose/tables";
import { tableEmptyCellSerializerPlugin } from "../src/plugins/milkdown/table/emptyCellSerializer";

const editors: Editor[] = [];
afterEach(async () => {
  for (const e of editors.splice(0)) await e.destroy();
  document.body.innerHTML = "";
});

async function mount(md: string): Promise<Editor> {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, md);
    })
    .use(commonmark)
    .use(gfm)
    .use(tableEmptyCellSerializerPlugin)
    .create();
  editors.push(editor);
  return editor;
}

const viewOf = (e: Editor): EditorView => e.action((ctx) => ctx.get(editorViewCtx));
const serialize = (e: Editor): string =>
  e.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));

/** Position of the first occurrence of `needle` inside a text node. */
function textPos(view: EditorView, needle: string): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text?.includes(needle)) found = pos + node.text.indexOf(needle);
    return true;
  });
  if (found < 0) throw new Error(`text not found: ${needle}`);
  return found;
}

/** A typed edit in the last paragraph, outside any table. */
function typeAtDocEnd(e: Editor, text: string): void {
  const view = viewOf(e);
  view.dispatch(view.state.tr.insertText(text, view.state.doc.content.size - 1));
}

describe("D64 WI-1: empty table cells serialize as empty cells", () => {
  it("E-1: an empty cell already in the file comes back blank after an edit outside the table", async () => {
    const e = await mount("| a | b |\n|---|---|\n| x |  |\n\nend\n");
    typeAtDocEnd(e, "Z");
    const out = serialize(e);
    expect(out).toBe("| a | b |\n| - | - |\n| x |   |\n\nendZ\n");
    expect(out).not.toContain("<br />");
  });

  it("E-2: a cell emptied by deleting its text in the editor serializes blank", async () => {
    const e = await mount("| a | b |\n|---|---|\n| x | y |\n\nend\n");
    const view = viewOf(e);
    const y = textPos(view, "y");
    view.dispatch(view.state.tr.delete(y, y + 1));
    expect(serialize(e)).toBe("| a | b |\n| - | - |\n| x |   |\n\nend\n");
  });

  it("E-3: cells created by prosemirror-tables addColumnAfter / addRowAfter serialize blank", async () => {
    const e = await mount("| a | b |\n|---|---|\n| x | y |\n\nend\n");
    const view = viewOf(e);
    // Empty the "y" cell too, so the new row and column sit beside an emptied cell.
    const y = textPos(view, "y");
    view.dispatch(view.state.tr.delete(y, y + 1));
    const x = textPos(view, "x");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, x)));
    expect(addColumnAfter(view.state, view.dispatch)).toBe(true);
    expect(addRowAfter(view.state, view.dispatch)).toBe(true);
    const out = serialize(e);
    expect(out).toBe(
      "| a |    | b |\n| - | :- | - |\n| x |    |   |\n|   |    |   |\n\nend\n",
    );
    expect(out).not.toContain("<br />");
  });

  it("E-4: non-empty cells and cells with inline marks serialize unchanged", async () => {
    const e = await mount("| **a** | `c` |\n|---|---|\n| x | p *q* |\n\nend\n");
    typeAtDocEnd(e, "Z");
    expect(serialize(e)).toBe(
      "| **a** | `c`   |\n| ----- | ----- |\n| x     | p *q* |\n\nendZ\n",
    );
  });

  it("E-4: a cell containing a hard break serializes unchanged (not treated as empty)", async () => {
    const e = await mount("| a | b |\n|---|---|\n| x | y |\n\nend\n");
    const view = viewOf(e);
    const afterX = textPos(view, "x") + 1;
    const hardbreak = view.state.schema.nodes.hardbreak.create();
    view.dispatch(view.state.tr.insert(afterX, hardbreak).insertText("w", afterX + 1));
    expect(serialize(e)).toBe("| a   | b |\n| --- | - |\n| x w | y |\n\nend\n");
  });

  it("E-4: a cell containing only a hard break serializes unchanged (HEAD already writes it blank)", async () => {
    const e = await mount("| a | b |\n|---|---|\n| x | y |\n\nend\n");
    const view = viewOf(e);
    const y = textPos(view, "y");
    view.dispatch(view.state.tr.replaceWith(y, y + 1, view.state.schema.nodes.hardbreak.create()));
    const cell = view.state.doc.resolve(y).node(-1);
    expect(cell.type.name).toBe("table_cell");
    expect(cell.firstChild?.content.size).toBeGreaterThan(0);
    // The paragraph is not empty, so the new rule does not apply; this is the
    // measured HEAD output (gfm writes a lone hard break in a cell as nothing).
    expect(serialize(e)).toBe("| a | b |\n| - | - |\n| x |   |\n\nend\n");
  });

  it("E-5: an empty paragraph outside a table still serializes as <br /> (rule is table-scoped)", async () => {
    const e = await mount("| a | b |\n|---|---|\n| x | y |\n\nend\n");
    const view = viewOf(e);
    const endPara = textPos(view, "end") - 1;
    view.dispatch(view.state.tr.insert(endPara, view.state.schema.nodes.paragraph.create()));
    expect(serialize(e)).toBe("| a | b |\n| - | - |\n| x | y |\n\n<br />\n\nend\n");
  });

  it("E-6: parse → serialize of the output is idempotent (round-trip law)", async () => {
    const inputs = [
      "| a | b |\n|---|---|\n| x |  |\n\nend\n",
      "|  | b |\n|---|---|\n|  |  |\n\nend\n",
      "| **a** | `c` |\n|---|---|\n|  | p *q* |\n",
    ];
    for (const input of inputs) {
      const first = await mount(input);
      typeAtDocEnd(first, "Z");
      const once = serialize(first);
      expect(once).not.toContain("<br />");
      const second = await mount(once);
      const twice = serialize(second);
      expect(twice).toBe(once);
      const third = await mount(twice);
      expect(serialize(third)).toBe(once);
    }
  });

  it("E-7: an empty header cell (table_header) also serializes blank", async () => {
    const e = await mount("|  | b |\n|---|---|\n| x | y |\n\nend\n");
    typeAtDocEnd(e, "Z");
    const out = serialize(e);
    expect(out).toBe("|   | b |\n| - | - |\n| x | y |\n\nendZ\n");
    expect(out).not.toContain("<br />");
  });
});
