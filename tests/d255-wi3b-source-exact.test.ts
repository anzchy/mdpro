import { afterEach, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { runSourceEditorMenuCommand } from "../src/utils/editorMenuSourceCommands";

let view: EditorView | null = null;
let root: HTMLElement | null = null;

function mount(input: string) {
  root = document.body.appendChild(document.createElement("div"));
  view = new EditorView({ state: EditorState.create({ doc: input, selection: EditorSelection.single(0, input.length) }), parent: root });
  return view;
}

afterEach(() => {
  view?.destroy();
  root?.remove();
  view = null;
  root = null;
});

it.each([
  ["*a*", "format.emphasis", "a", "a"],
  ["*a*", "format.strong", "***a***", "*a*"],
  ["**b**", "format.emphasis", "***b***", "**b**"],
  ["**b**", "format.strong", "b", "b"],
  ["***a***", "format.emphasis", "**a**", "**a**"],
  ["***a***", "format.strong", "*a*", "*a*"],
  ["****a****", "format.emphasis", "*****a*****", "****a****"],
  ["****a****", "format.strong", "******a******", "****a****"],
  ["**a*", "format.emphasis", "***a**", "**a*"],
  ["**a*", "format.strong", "****a***", "**a*"],
  ["~~x~~", "format.strike", "x", "x"],
  ["~~~x~~~", "format.strike", "~~~~~x~~~~~", "~~~x~~~"],
])("AC-8 %s + %s → %s with exact selection", (input, id, expected, selected) => {
  const editor = mount(input);
  expect(runSourceEditorMenuCommand(id, editor, {} as never, "exact-test"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe(expected);
  expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe(selected);
});

it.each([
  ["`", "format.code"],
  ["**", "format.strong"],
])("AC-8 refuses ambiguous marker-only input %s", (input, id) => {
  const editor = mount(input);
  const before = editor.state.selection;
  expect(runSourceEditorMenuCommand(id, editor, {} as never, "exact-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe(input);
  expect(editor.state.selection.eq(before)).toBe(true);
});
