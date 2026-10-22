import { afterEach, expect, it } from "vitest";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { runSourceEditorMenuCommand } from "../src/utils/editorMenuSourceCommands";

let view: EditorView | null = null;
let root: HTMLElement | null = null;

function mount(doc: string, selection: EditorSelection | SelectionRange) {
  root = document.body.appendChild(document.createElement("div"));
  view = new EditorView({ state: EditorState.create({ doc, selection: selection instanceof EditorSelection ? selection : EditorSelection.create([selection]), extensions: [EditorState.allowMultipleSelections.of(true)] }), parent: root });
  return view;
}

afterEach(() => {
  view?.destroy();
  root?.remove();
  view = null;
  root = null;
});

const fences = [
  "```js\nbody\n```",
  "~~~~\nbody\n~~~~",
  "  ````\nbody\n  ````",
  "> ```\n> body\n> ```",
];

it.each(fences)("AC-9 refuses opener, body and closer selections inside %s", (doc) => {
  for (const needle of [doc.split("\n")[0], "body", doc.split("\n")[2]]) {
    const at = doc.indexOf(needle);
    const editor = mount(doc, EditorSelection.cursor(at));
    const prior = editor.state.selection;
    expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "fence-test"))
      .toEqual({ status: "refused", reason: "no_change" });
    expect(editor.state.doc.toString()).toBe(doc);
    expect(editor.state.selection.eq(prior)).toBe(true);
    editor.destroy();
    root?.remove();
    view = null;
    root = null;
  }
});

it.each(fences)("AC-9 refuses a cursor on the actual closing fence in %s", (doc) => {
  const closer = doc.lastIndexOf("\n") + 1;
  const editor = mount(doc, EditorSelection.cursor(closer));
  const prior = editor.state.selection;
  expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "fence-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe(doc);
  expect(editor.state.selection.eq(prior)).toBe(true);
});

it("AC-9 refuses the whole operation when only the second range touches a fence", () => {
  const doc = "before\n```\ninside\n```\nafter";
  const editor = mount(doc, EditorSelection.create([
    EditorSelection.range(0, 6),
    EditorSelection.range(doc.indexOf("inside"), doc.indexOf("inside") + 6),
  ]));
  const prior = editor.state.selection;
  expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "fence-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe(doc);
  expect(editor.state.selection.eq(prior)).toBe(true);
});

it.each(["before\n```\nbody\n```", "```\nbody\n```\nafter"])(
  "AC-9 wraps a line only outside the existing fence in %s", (doc) => {
    const at = doc.startsWith("before") ? 0 : doc.indexOf("after");
    const editor = mount(doc, EditorSelection.cursor(at));
    expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "fence-test"))
      .toEqual({ status: "applied" });
    expect(editor.state.doc.toString()).toContain("```\n" + (at === 0 ? "before" : "after") + "\n```");
  },
);

it.each([
  ["before\n```\nbody\n```", 0, "```\nbefore\n```\n```\nbody\n```"],
  ["```\nbody\n```\nafter", 13, "```\nbody\n```\n```\nafter\n```"],
])("AC-9 exact outside fence output and selection for %s", (doc, at, expected) => {
  const editor = mount(doc, EditorSelection.cursor(at));
  expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "fence-test"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe(expected);
  expect(editor.state.selection.main.head).toBe(at + 4);
});

it("AC-9 unmatched opener owns every line through EOF", () => {
  const doc = "before\n```\nbody\nafter";
  const editor = mount(doc, EditorSelection.cursor(doc.indexOf("after")));
  const prior = editor.state.selection;
  expect(runSourceEditorMenuCommand("paragraph.codeFences", editor, {} as never, "fence-test"))
    .toEqual({ status: "refused", reason: "no_change" });
  expect(editor.state.doc.toString()).toBe(doc);
  expect(editor.state.selection.eq(prior)).toBe(true);
});
