import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { runSourceEditorMenuCommand } from "../src/utils/editorMenuSourceCommands";
import { CODEMIRROR_ROWS } from "../src/commands/inventory/codemirrorRows";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

let view: EditorView | null = null;
let root: HTMLElement | null = null;
let unmount: (() => void) | null = null;

function mount(doc: string, selection?: EditorSelection | ReturnType<typeof EditorSelection.cursor>): EditorView {
  root = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({ doc, selection: selection && !(selection instanceof EditorSelection) ? EditorSelection.create([selection]) : selection, extensions: [history(), EditorState.allowMultipleSelections.of(true)] }),
    parent: root,
  });
  return view;
}

afterEach(() => {
  unmount?.();
  unmount = null;
  view?.destroy();
  root?.remove();
  view = null;
  root = null;
  cleanup();
  useEditorStore.setState({ editorView: null, viewMode: "wysiwyg" });
  useDocumentStore.setState({ activeDocumentId: null });
});

it("AC-6 wraps and unwraps each selected range in one undo step", () => {
  const editor = mount("alpha beta", EditorSelection.create([
    EditorSelection.range(0, 5), EditorSelection.range(6, 10),
  ]));
  expect(runSourceEditorMenuCommand("format.underline", editor, {} as never, "wi3b"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe("<u>alpha</u> <u>beta</u>");
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha beta");
  editor.dispatch({ selection: EditorSelection.single(0, 10) });
  expect(runSourceEditorMenuCommand("format.underline", editor, {} as never, "wi3b"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe("<u>alpha beta</u>");
  editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
  expect(runSourceEditorMenuCommand("format.underline", editor, {} as never, "wi3b"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe("alpha beta");
});

it("AC-6 undo restores exact multirange anchors and heads", () => {
  const editor = mount("alpha beta", EditorSelection.create([
    EditorSelection.range(5, 0), EditorSelection.range(10, 6),
  ]));
  const before = editor.state.selection.ranges.map(({ anchor, head }) => [anchor, head]);
  expect(runSourceEditorMenuCommand("format.underline", editor, {} as never, "wi3b"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe("<u>alpha</u> <u>beta</u>");
  expect(undo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha beta");
  expect(editor.state.selection.ranges.map(({ anchor, head }) => [anchor, head])).toEqual(before);
});

it("AC-6 inserts an empty underline pair with caret between", () => {
  const editor = mount("alpha", EditorSelection.cursor(2));
  expect(runSourceEditorMenuCommand("format.underline", editor, {} as never, "wi3b"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe("al<u></u>pha");
  expect(editor.state.selection.main.head).toBe(5);
});

it.each([
  ["<u>a</u><u>b</u>", "<u><u>a</u><u>b</u></u>"],
  ["<u><u>a</u></u>", "<u><u><u>a</u></u></u>"],
  ["<u>a</u><u>", "<u><u>a</u><u></u>"],
])("AC-6 does not unwrap an unrelated or nested tag span %s", (input, expected) => {
  const editor = mount(input, EditorSelection.range(0, input.length));
  expect(runSourceEditorMenuCommand("format.underline", editor, {} as never, "wi3b"))
    .toEqual({ status: "applied" });
  expect(editor.state.doc.toString()).toBe(expected);
});

it("AC-6 composed Source Cmd+U owns the chord ahead of history undoSelection", () => {
  useDocumentStore.setState({ activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: "source", editorView: null });
  const rendered = render(<Editor value="alpha" onChange={vi.fn()} />);
  unmount = rendered.unmount;
  const editor = useEditorStore.getState().editorView!;
  editor.dispatch({ selection: EditorSelection.single(0, 5) });
  const event = new KeyboardEvent("keydown", { key: "u", metaKey: true, bubbles: true, cancelable: true });
  act(() => { editor.contentDOM.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(editor.state.doc.toString()).toBe("<u>alpha</u>");
});

it("AC-6 classifies D270 as a deliberate shadow while preserving the alternate undo keys", () => {
  const historyRows = CODEMIRROR_ROWS.filter((row) => row.source === "codemirror:historyKeymap");
  expect(historyRows.find((row) => row.key === "Mod-u")?.disposition).toEqual({ kind: "shadowed", by: "mdpro:sourceFormatPlugin" });
  expect(historyRows.find((row) => row.key === "Mod-u")?.latent).toBeUndefined();
  expect(historyRows.some((row) => row.key === "Alt-u")).toBe(true);
  expect(historyRows.some((row) => row.key === "Mod-Shift-u")).toBe(true);
});
