import { afterEach, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { runSourceEditorMenuCommand } from "../src/utils/editorMenuSourceCommands";

let view: EditorView | null = null;
let root: HTMLElement | null = null;

function mount(doc: string, selection?: EditorSelection | { anchor: number; head?: number }): EditorView {
  root = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({ doc, selection, extensions: [history(), EditorState.allowMultipleSelections.of(true)] }),
    parent: root,
  });
  return view;
}

function run(id: string): string {
  const result = runSourceEditorMenuCommand(id, view!, {} as never, "d255-test");
  expect(result).toEqual({ status: "applied" });
  return view!.state.doc.toString();
}

afterEach(() => {
  view?.destroy();
  root?.remove();
  view = null;
  root = null;
});

it.each([
  ["format.strong", "**"],
  ["format.emphasis", "*"],
  ["format.code", "`"],
  ["format.strike", "~~"],
])("WI-1 wraps, unwraps and inserts an empty %s pair", (id, marker) => {
  const editor = mount("汉字", EditorSelection.single(0, 2));
  expect(run(id)).toBe(`${marker}汉字${marker}`);
  expect(editor.state.selection.main.from).toBe(marker.length);
  expect(editor.state.selection.main.to).toBe(marker.length + 2);
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run(id)).toBe("汉字");
  editor.dispatch({ selection: EditorSelection.cursor(2) });
  expect(run(id)).toBe(`汉字${marker}${marker}`);
  expect(editor.state.selection.main.head).toBe(2 + marker.length);
});

it("WI-1 transforms two selections once and refuses a newline span atomically", () => {
  const editor = mount("汉字 alpha", EditorSelection.create([
    EditorSelection.range(0, 2), EditorSelection.range(3, 8),
  ]));
  expect(run("format.strong")).toBe("**汉字** **alpha**");
  expect(editor.state.selection.ranges).toHaveLength(2);
  expect(editor.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([[2, 4], [9, 14]]);
  const before = editor.state.doc.toString();
  editor.dispatch({ selection: EditorSelection.single(0, 8) });
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "a\nb" } });
  editor.dispatch({ selection: EditorSelection.single(0, 3) });
  const result = runSourceEditorMenuCommand("format.strong", editor, {} as never, "d255-test");
  expect(result).toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe("a\nb");
  expect(before).toBe("**汉字** **alpha**");
});

it("WI-1 refuses every range atomically when one range spans a newline", () => {
  const editor = mount("alpha beta\nc", EditorSelection.create([
    EditorSelection.range(0, 5), EditorSelection.range(6, 12),
  ]));
  const prior = editor.state.selection;
  expect(runSourceEditorMenuCommand("format.strong", editor, {} as never, "d255-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe("alpha beta\nc");
  expect(editor.state.selection.eq(prior)).toBe(true);
});

it("WI-1 is one undo step restoring content and selection", () => {
  const editor = mount("alpha", EditorSelection.single(0, 5));
  expect(run("format.strong")).toBe("**alpha**");
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(editor.state.selection.main.from).toBe(0);
  expect(editor.state.selection.main.to).toBe(5);
});

it("WI-2 fences whole selected lines and undoes as one step", () => {
  const editor = mount("first\nsecond\nthird", EditorSelection.single(2, 9));
  expect(run("paragraph.codeFences")).toBe("```\nfirst\nsecond\n```\nthird");
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("first\nsecond\nthird");
  expect(editor.state.selection.main.from).toBe(2);
  expect(editor.state.selection.main.to).toBe(9);
});

it("WI-2 creates an empty fence with caret inside and refuses an existing fence", () => {
  const editor = mount("", EditorSelection.cursor(0));
  expect(run("paragraph.codeFences")).toBe("```\n\n```");
  expect(editor.state.selection.main.head).toBe(4);
  const prior = editor.state.doc.toString();
  expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "d255-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe(prior);
});

it.each([
  "````\n```\nx\n````",
  "~~~\nx\n~~~",
  "> ```\n> x\n> ```",
])("WI-2 refuses inside an existing long or tilde fence: %s", (doc) => {
  const editor = mount(doc, EditorSelection.cursor(doc.indexOf("x")));
  const prior = editor.state.selection;
  expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "d255-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe(doc);
  expect(editor.state.selection.eq(prior)).toBe(true);
});

it("WI-3 numbers selected indented lines, toggles off, and switches list kind", () => {
  const editor = mount("  a\n  b", EditorSelection.single(0, 7));
  expect(run("paragraph.orderedList")).toBe("  1. a\n  2. b");
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run("paragraph.unorderedList")).toBe("  - a\n  - b");
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run("paragraph.unorderedList")).toBe("  a\n  b");
});

it("WI-3 uses one batch decision for mixed prefixes and Quote toggles", () => {
  const editor = mount("  - a\n  b", EditorSelection.single(0, 9));
  expect(run("paragraph.unorderedList")).toBe("  - a\n  - b");
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run("paragraph.unorderedList")).toBe("  a\n  b");
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run("paragraph.quote")).toBe("  > a\n  > b");
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run("paragraph.quote")).toBe("  a\n  b");
});

it("WI-4 inserts an empty math block and places the caret on its body line", () => {
  const editor = mount("", EditorSelection.cursor(0));
  expect(run("paragraph.mathBlock")).toBe("$$\n\n$$");
  expect(editor.state.selection.main.head).toBe(3);
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("");
});

it("WI-4 moves selected text into the math block body", () => {
  const editor = mount("alpha", EditorSelection.single(0, 5));
  expect(run("paragraph.mathBlock")).toBe("$$\nalpha\n$$");
  expect(editor.state.selection.main.from).toBe(3);
  expect(editor.state.selection.main.to).toBe(8);
});

it("WI-5 Select Line uses CodeMirror's whole-line selection", () => {
  const editor = mount("a\nbeta\nc", EditorSelection.cursor(4));
  expect(run("edit.selectLine")).toBe("a\nbeta\nc");
  expect(editor.state.selection.main.from).toBe(2);
  expect(editor.state.selection.main.to).toBe(7);
});

it("WI-5 Delete Word removes a group and is one undo step", () => {
  const editor = mount("alpha beta", EditorSelection.cursor(10));
  expect(run("edit.deleteWord")).toBe("alpha ");
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha beta");
  expect(editor.state.selection.main.head).toBe(10);
});

it.each([
  ["paragraph.orderedList", "  1. a\n  b", "  1. a\n  2. b"],
  ["paragraph.quote", "  > a\n  b", "  > a\n  > b"],
])("WI-3 %s uses one batch decision for mixed target prefixes", (id, before, want) => {
  const editor = mount(before, EditorSelection.single(0, before.length));
  expect(run(id)).toBe(want);
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(run(id)).toBe("  a\n  b");
});

it.each([
  "format.emphasis", "format.code", "format.strike",
  "paragraph.orderedList", "paragraph.unorderedList", "paragraph.quote",
])("WI-1/3 %s is one undo step with exact prior content and selection", (id) => {
  const editor = mount("alpha", EditorSelection.single(0, 5));
  const prior = editor.state.selection;
  run(id);
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(editor.state.selection.eq(prior)).toBe(true);
});
