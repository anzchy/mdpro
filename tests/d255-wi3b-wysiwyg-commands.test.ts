/** D255-WI-3b: behavior of composed WYSIWYG command adapters. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultValueCtx, Editor, editorViewCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorState } from "@milkdown/kit/prose/state";
import { Schema } from "@milkdown/kit/prose/model";
import { undo } from "@milkdown/kit/prose/history";
import { runEditorMenuCommand } from "../src/utils/editorMenuCommands";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { seedStores } from "./support/editorGenerationDomain";
import type { MilkdownMenuRig } from "./support/editorMenuRig";
import { mdproCommonmark } from "../src/plugins/milkdown/commonmarkPreset";
import { highlightMarkPlugin } from "../src/plugins/milkdown/highlightMarkPlugin";
import { typoraKeymapMilkdownPlugin } from "../src/plugins/milkdown/typoraKeymapPlugin";
import { makeHeadingLevelCommand } from "../src/plugins/milkdown/wysiwygFormatCommands";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

let rig: MilkdownMenuRig | null = null;
let unregister: (() => void) | null = null;

beforeEach(() => {
  seedStores();
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

afterEach(async () => {
  unregister?.();
  unregister = null;
  await rig?.destroy();
  rig = null;
});

async function mount(markdown: string): Promise<MilkdownMenuRig> {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(mdproCommonmark)
    .use(gfm)
    .use(history)
    .use(typoraKeymapMilkdownPlugin)
    .use(highlightMarkPlugin)
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  rig = { editor, view, async destroy() { await editor.destroy(); root.remove(); } };
  unregister = useMilkdownEditorStore.getState().registerEditor(() => rig?.editor ?? null);
  return rig;
}

function markdown(): string {
  return rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
}

function run(id: string) {
  return runEditorMenuCommand(id, { windowLabel: "main", documentId: "d1", generation: 0 }, "wi3b-test");
}

it.each([
  ["paragraph.increaseHeading", "plain", "###### plain"],
  ["paragraph.increaseHeading", "###### plain", "##### plain"],
  ["paragraph.increaseHeading", "##### plain", "#### plain"],
  ["paragraph.increaseHeading", "#### plain", "### plain"],
  ["paragraph.increaseHeading", "### plain", "## plain"],
  ["paragraph.increaseHeading", "## plain", "# plain"],
  ["paragraph.decreaseHeading", "# plain", "## plain"],
  ["paragraph.decreaseHeading", "## plain", "### plain"],
  ["paragraph.decreaseHeading", "### plain", "#### plain"],
  ["paragraph.decreaseHeading", "#### plain", "##### plain"],
  ["paragraph.decreaseHeading", "##### plain", "###### plain"],
  ["paragraph.decreaseHeading", "###### plain", "plain"],
])("AC-1 %s maps %s to %s in one undo step", async (id, input, expected) => {
  await mount(input);
  const priorSelection = rig!.view.state.selection;
  expect(run(id)).toEqual({ status: "applied" });
  expect(markdown()).toBe(`${expected}\n`);
  expect(undo(rig!.view.state, rig!.view.dispatch, rig!.view)).toBe(true);
  expect(markdown()).toBe(`${input}\n`);
  expect(rig!.view.state.selection.eq(priorSelection)).toBe(true);
});

it.each([
  ["paragraph.increaseHeading", "# edge"],
  ["paragraph.decreaseHeading", "edge"],
  ["paragraph.increaseHeading", "```\nedge\n```"],
  ["paragraph.decreaseHeading", "```\nedge\n```"],
])("AC-1 %s refuses without a history entry on %s", async (id, input) => {
  await mount(input);
  expect(run(id)).toEqual({ status: "refused", reason: "no_change" });
  expect(markdown()).toBe(`${input}\n`);
  expect(undo(rig!.view.state, rig!.view.dispatch, rig!.view)).toBe(false);
});

it("AC-1 preserves marked CJK text and changes the list item's inner block", async () => {
  await mount("- intro\n\n  **汉字** text");
  const view = rig!.view;
  let nestedPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.textContent.startsWith("汉字")) nestedPos = pos + 1;
  });
  expect(nestedPos).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, nestedPos)));
  expect(run("paragraph.increaseHeading")).toEqual({ status: "applied" });
  expect(markdown()).toContain("**汉字** text");
  expect(rig!.view.state.doc.firstChild?.type.name).toBe("bullet_list");
  expect(rig!.view.state.doc.firstChild?.firstChild?.child(1).type.name).toBe("heading");
});

it("AC-1 refuses a heading in the first and only list paragraph without changing the document", async () => {
  await mount("- alpha");
  const view = rig!.view;
  const before = view.state.doc;
  let textPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && textPos < 0) textPos = pos + 1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPos)));
  expect(run("paragraph.increaseHeading")).toEqual({ status: "refused", reason: "no_change" });
  expect(view.state.doc.eq(before)).toBe(true);
  expect(markdown()).toBe("- alpha\n");
  expect(undo(view.state, view.dispatch, view)).toBe(false);
});

it("AC-1 changes the inner blockquote paragraph and undo restores the selection", async () => {
  await mount("> alpha");
  const view = rig!.view;
  const prior = view.state.selection;
  expect(run("paragraph.increaseHeading")).toEqual({ status: "applied" });
  expect(markdown()).toBe("> ###### alpha\n");
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(markdown()).toBe("> alpha\n");
  expect(view.state.selection.eq(prior)).toBe(true);
});

it("AC-1 refuses when the heading node is absent from the schema", async () => {
  await mount("alpha");
  const base = rig!.view.state.schema;
  const schema = new Schema({ nodes: base.spec.nodes.remove("heading"), marks: base.spec.marks });
  const state = EditorState.create({ schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("alpha"))) });
  expect(makeHeadingLevelCommand("increase")(state, () => { throw new Error("unexpected dispatch"); })).toBe(false);
  expect(state.doc.textContent).toBe("alpha");
});

it("AC-2 Select Word uses document positions across an inline image on both invocations", async () => {
  await mount("one ![](x.png) two two");
  const view = rig!.view;
  const before = view.state.doc;
  const words: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.isText) {
      for (const match of node.text!.matchAll(/two/g)) words.push(pos + match.index!);
    }
  });
  expect(words).toHaveLength(2);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, words[0] + 1)));
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.selection.from).toBe(words[0]);
  expect(view.state.selection.to).toBe(words[0] + 3);
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.selection.from).toBe(words[1]);
  expect(view.state.selection.to).toBe(words[1] + 3);
  expect(view.state.doc.eq(before)).toBe(true);
  expect(undo(view.state, view.dispatch, view)).toBe(false);
});

it("AC-2 Select Word keeps hard-break positions on repeated selection", async () => {
  await mount("one  \ntwo two");
  const view = rig!.view;
  const words: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.isText) for (const match of node.text!.matchAll(/two/g)) words.push(pos + match.index!);
  });
  expect(words).toHaveLength(2);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, words[0] + 1)));
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.selection.from).toBe(words[0]);
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.selection.from).toBe(words[1]);
  expect(undo(view.state, view.dispatch, view)).toBe(false);
});

it("AC-1 refuses inside a table cell without changing its content", async () => {
  await mount("| a |\n| --- |\n| b |");
  const view = rig!.view;
  let cellPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (cellPos < 0 && node.type.name === "table_cell") cellPos = pos;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos + 2)));
  const before = markdown();
  expect(run("paragraph.increaseHeading")).toEqual({ status: "refused", reason: "no_change" });
  expect(markdown()).toBe(before);
});

it.each([1, 3, 6])("AC-2 selects the whole word at caret offset %i", async (offset) => {
  await mount("alpha beta");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, offset)));
  const before = markdown();
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("alpha");
  expect(markdown()).toBe(before);
});

it("AC-2 selects across a strong-mark boundary without changing marks", async () => {
  await mount("**ab**cd tail");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("abcd");
  expect(markdown()).toBe("**ab**cd tail\n");
});

it("AC-2 selects a nonempty CJK run, not the whole paragraph", async () => {
  await mount("你好 世界 后文");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  const selected = view.state.doc.textBetween(view.state.selection.from, view.state.selection.to);
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.length).toBeLessThan(view.state.doc.firstChild!.textContent.length);
  expect(markdown()).toBe("你好 世界 后文\n");
});

it.each(["alpha  beta", "alpha,,beta", ""])('AC-2 refuses whitespace, punctuation or empty content in "%s"', async (input) => {
  await mount(input);
  const view = rig!.view;
  const offset = input === "" ? 1 : 7;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, offset)));
  const before = view.state.selection;
  expect(run("edit.selectWord")).toEqual({ status: "refused", reason: "no_change" });
  expect(view.state.selection.eq(before)).toBe(true);
});

it("AC-2 finds the next occurrence from an existing selection", async () => {
  await mount("alpha beta alpha");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(run("edit.selectWord")).toEqual({ status: "applied" });
  expect(view.state.selection.from).toBe(12);
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("alpha");
  expect(run("edit.selectWord")).toEqual({ status: "refused", reason: "no_change" });
});

it.each([
  ["alpha beta", "alpha beta"],
  ["## alpha beta", "alpha beta"],
  ["```\nalpha\nbeta\n```", "alpha\nbeta"],
])("AC-3 selects only the enclosing textblock in %s", async (input, expected) => {
  await mount(input);
  const view = rig!.view;
  const before = markdown();
  expect(run("edit.selectLine")).toEqual({ status: "applied" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe(expected);
  expect(markdown()).toBe(before);
  expect(run("edit.selectLine")).toEqual({ status: "refused", reason: "no_change" });
});

it("AC-3 keeps a table-cell selection inside that cell", async () => {
  await mount("| left | right |\n| --- | --- |\n| one | two |");
  const view = rig!.view;
  let pos = -1;
  view.state.doc.descendants((node, at) => {
    if (node.type.name === "table_cell" && node.textContent === "one") pos = at + 2;
  });
  expect(pos).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  const before = markdown();
  expect(run("edit.selectLine")).toEqual({ status: "applied" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("one");
  expect(markdown()).toBe(before);
});

it("AC-3 selects the list item's active inner paragraph only", async () => {
  await mount("- intro\n\n  second line");
  const view = rig!.view;
  let pos = -1;
  view.state.doc.descendants((node, at) => {
    if (node.type.name === "paragraph" && node.textContent === "second line") pos = at + 1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  expect(run("edit.selectLine")).toEqual({ status: "applied" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("second line");
});

it("AC-3 refuses an empty paragraph without document changes", async () => {
  await mount("");
  const before = markdown();
  expect(run("edit.selectLine")).toEqual({ status: "refused", reason: "no_change" });
  expect(markdown()).toBe(before);
});

it("AC-3 Select Line changes only selection and creates no undo entry", async () => {
  await mount("alpha beta");
  const view = rig!.view;
  const before = markdown();
  expect(run("edit.selectLine")).toEqual({ status: "applied" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("alpha beta");
  expect(markdown()).toBe(before);
  expect(undo(view.state, view.dispatch, view)).toBe(false);
});

it("AC-4 clears removable marks on selected text but keeps the link and href", async () => {
  await mount("[**linked**](https://example.com) tail");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 7)));
  const before = markdown();
  expect(run("format.clearFormat")).toEqual({ status: "applied" });
  const linked = view.state.doc.firstChild?.firstChild;
  expect(linked?.marks.map((mark) => mark.type.name)).toEqual(["link"]);
  expect(linked?.marks[0].attrs.href).toBe("https://example.com");
  expect(markdown()).toBe("[linked](https://example.com) tail\n");
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(markdown()).toBe(before);
});

it("AC-4 clears only the selected half of bold text", async () => {
  await mount("**alpha beta**");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(run("format.clearFormat")).toEqual({ status: "applied" });
  expect(markdown()).toBe("alpha **beta**\n");
});

it("AC-4 removes emphasis, code, strike and highlight marks in one transaction", async () => {
  await mount("*em* `code` ~~strike~~ ==hi==");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.firstChild!.content.size + 1)));
  expect(run("format.clearFormat")).toEqual({ status: "applied" });
  expect(view.state.doc.firstChild?.textContent).toBe("em code strike hi");
  view.state.doc.firstChild?.descendants((node) => {
    if (node.isText) expect(node.marks).toHaveLength(0);
  });
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(markdown()).toBe("*em* `code` ~~strike~~ ==hi==\n");
});

it("AC-4 refuses an empty selection without a document or undo change", async () => {
  await mount("**alpha**");
  const view = rig!.view;
  const before = markdown();
  expect(run("format.clearFormat")).toEqual({ status: "refused", reason: "no_change" });
  expect(markdown()).toBe(before);
  expect(undo(view.state, view.dispatch, view)).toBe(false);
});
