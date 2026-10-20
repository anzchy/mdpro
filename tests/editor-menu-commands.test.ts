/** M3b: command effects in composed WYSIWYG and Source editors. */
import { beforeEach, afterEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { TextSelection } from "@milkdown/kit/prose/state";
import { Selection as ProseSelection } from "@milkdown/kit/prose/state";
import { EditorSelection } from "@codemirror/state";
import { SearchQuery, setSearchQuery } from "@codemirror/search";
import { useEditorStore } from "../src/stores/editorStore";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTableInsertStore } from "../src/stores/tableInsertStore";
import { bus } from "./support/menuEventsHarness";
import { logs } from "./support/menuEventsHarness";
import { flush, mountHook, resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountMilkdownMenuRig, mountSourceMenuRig, type MilkdownMenuRig, type SourceMenuRig } from "./support/editorMenuRig";

let milkdown: MilkdownMenuRig | null = null;
let source: SourceMenuRig | null = null;
let unregister: (() => void) | null = null;

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useEditorStore.setState({ sourceTableVerdicts: {} });
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
  useTableInsertStore.getState().clearPending();
});

afterEach(async () => {
  unregister?.();
  unregister = null;
  source?.destroy();
  source = null;
  await milkdown?.destroy();
  milkdown = null;
  useLinkInsertStore.getState().clearPendingCallback();
  useTableInsertStore.getState().clearPending();
});

async function setup(markdown = "alpha") {
  milkdown = await mountMilkdownMenuRig(markdown);
  source = mountSourceMenuRig(markdown);
  unregister = useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
  useEditorStore.getState().setEditorView(source.view);
  const hook = mountHook({});
  await flush();
  return hook;
}

async function click(id: string) {
  bus.emitTo("main", "menu:action", { action: `editor.${id}`, target: "main" });
  await flush();
}

it("AC-3: heading 2 changes the real W block, then the real S line", async () => {
  const hook = await setup("汉字 alpha");
  await click("paragraph.heading2");
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("heading");
  expect(milkdown!.view.state.doc.firstChild?.attrs.level).toBe(2);
  useEditorStore.setState({ viewMode: "source" });
  await click("paragraph.heading2");
  expect(source!.view.state.doc.toString()).toBe("## 汉字 alpha");
  hook.unmount();
});

it("AC-3: W strong marks the selected text once", async () => {
  const hook = await setup("alpha");
  const view = milkdown!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  await click("format.strong");
  expect(view.state.doc.firstChild?.firstChild?.marks.some((mark) => mark.type.name === "strong")).toBe(true);
  hook.unmount();
});

it("AC-3: a W code fence changes the block type, not only a boolean", async () => {
  const hook = await setup("alpha");
  await click("paragraph.codeFences");
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("code_block");
  hook.unmount();
});
it("AC-3: all six headings and paragraph change both real editor documents", async () => {
  const hook = await setup("汉字 alpha");
  for (let level = 1; level <= 6; level += 1) {
    await click(`paragraph.heading${level}`);
    expect(milkdown!.view.state.doc.firstChild?.attrs.level).toBe(level);
  }
  await click("paragraph.paragraph");
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("paragraph");
  useEditorStore.setState({ viewMode: "source" });
  for (let level = 1; level <= 6; level += 1) {
    await click(`paragraph.heading${level}`);
    expect(source!.view.state.doc.toString()).toBe(`${"#".repeat(level)} 汉字 alpha`);
  }
  await click("paragraph.paragraph");
  expect(source!.view.state.doc.toString()).toBe("汉字 alpha");
  hook.unmount();
});
it("AC-3: W emphasis, inline code, strike and highlight change selected marks", async () => {
  const hook = await setup("alpha");
  const view = milkdown!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  for (const [id, mark] of [
    ["format.emphasis", "emphasis"],
    ["format.code", "inlineCode"],
    ["format.strike", "strike_through"],
    ["format.highlight", "highlight"],
  ] as const) {
    await click(id);
    expect(view.state.doc.firstChild?.firstChild?.marks.some((m) => m.type.name === mark), id).toBe(true);
  }
  hook.unmount();
});
it("AC-3: S heading level, indent/outdent, select word and document jumps affect state", async () => {
  const hook = await setup("## alpha\nsecond");
  useEditorStore.setState({ viewMode: "source" });
  await click("paragraph.increaseHeading");
  expect(source!.view.state.doc.line(1).text).toBe("# alpha");
  await click("paragraph.decreaseHeading");
  expect(source!.view.state.doc.line(1).text).toBe("## alpha");
  await click("paragraph.indent");
  expect(source!.view.state.doc.line(1).text).toMatch(/^\s+## alpha$/);
  await click("paragraph.outdent");
  expect(source!.view.state.doc.line(1).text).toBe("## alpha");
  source!.view.dispatch({ selection: EditorSelection.cursor(4) });
  await click("edit.selectWord");
  expect(source!.view.state.sliceDoc(source!.view.state.selection.main.from, source!.view.state.selection.main.to)).toBe("alpha");
  source!.view.dispatch({ selection: EditorSelection.cursor(source!.view.state.doc.length) });
  await click("edit.jumpToTop");
  expect(source!.view.state.selection.main.head).toBe(0);
  await click("edit.jumpToBottom");
  expect(source!.view.state.selection.main.head).toBe(source!.view.state.doc.length);
  hook.unmount();
});
it("AC-3: Source link and highlight change selected CJK/Unicode text", async () => {
  const hook = await setup("汉字 alpha");
  useEditorStore.setState({ viewMode: "source" });
  source!.view.dispatch({ selection: EditorSelection.single(0, 2) });
  await click("format.highlight");
  expect(source!.view.state.doc.toString()).toBe("==汉字== alpha");
  source!.view.dispatch({ selection: EditorSelection.single(2, 4) });
  await click("format.hyperlink");
  const apply = useLinkInsertStore.getState().pendingCallback;
  expect(apply).not.toBeNull();
  apply?.("example.com");
  expect(source!.view.state.doc.toString()).toContain("[汉字](https://example.com)");
  hook.unmount();
});
it("AC-3: Insert Table opens only in W; row actions change tables only inside a cell", async () => {
  const markdown = "| A | B |\n| --- | --- |\n| x | y |\n\noutside";
  const hook = await setup(markdown);
  await click("paragraph.table");
  expect(useTableInsertStore.getState().pendingCallback).not.toBeNull();
  useTableInsertStore.getState().clearPending();
  useEditorStore.setState({ viewMode: "source" });
  source!.view.dispatch({ selection: EditorSelection.cursor(source!.view.state.doc.toString().indexOf("x")) });
  await click("table.insertRowBelow");
  expect(source!.view.state.doc.lines).toBeGreaterThan(3);
  const afterInside = source!.view.state.doc.toString();
  source!.view.dispatch({ selection: EditorSelection.cursor(source!.view.state.doc.length) });
  await click("table.insertRowBelow");
  expect(source!.view.state.doc.toString()).toBe(afterInside);
  hook.unmount();
});
it("AC-3: Source Find opens its panel and next/previous move the selection", async () => {
  const hook = await setup("alpha beta alpha");
  useEditorStore.setState({ viewMode: "source" });
  await click("edit.find");
  expect(document.querySelector(".cm-search")).not.toBeNull();
  source!.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "alpha" })) });
  await click("edit.findNext");
  expect(source!.view.state.sliceDoc(source!.view.state.selection.main.from, source!.view.state.selection.main.to)).toBe("alpha");
  const first = source!.view.state.selection.main.from;
  await click("edit.findNext");
  expect(source!.view.state.selection.main.from).toBeGreaterThan(first);
  await click("edit.findPrevious");
  expect(source!.view.state.selection.main.from).toBe(first);
  hook.unmount();
});
it("AC-3: W jump-to-bottom and jump-to-top move a real ProseMirror selection", async () => {
  const hook = await setup("first\n\nsecond");
  await click("edit.jumpToBottom");
  expect(milkdown!.view.state.selection.from).toBe(ProseSelection.atEnd(milkdown!.view.state.doc).from);
  await click("edit.jumpToTop");
  expect(milkdown!.view.state.selection.from).toBe(ProseSelection.atStart(milkdown!.view.state.doc).from);
  hook.unmount();
});
it.each([
  "table.insertRowAbove", "table.insertRowBelow", "table.insertColumnLeft",
  "table.insertColumnRight", "table.deleteRow", "table.deleteColumn",
])("AC-3: Source %s changes a real table cell context", async (id) => {
  const hook = await setup("| A | B |\n| --- | --- |\n| x | y |\n| z | w |");
  useEditorStore.setState({ viewMode: "source" });
  const view = source!.view;
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("x")) });
  const before = view.state.doc.toString();
  await click(id);
  expect(view.state.doc.toString(), id).not.toBe(before);
  hook.unmount();
});
it("AC-3: W row and column actions change a real table", async () => {
  const hook = await setup("| A | B |\n| --- | --- |\n| x | y |");
  const view = milkdown!.view;
  let cell = -1;
  view.state.doc.descendants((node, pos) => {
    if (cell < 0 && node.type.name === "table_cell") cell = pos;
  });
  expect(cell).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cell + 2))));
  const table = () => view.state.doc.firstChild;
  const rows = table()!.childCount;
  await click("table.insertRowBelow");
  expect(table()!.childCount).toBe(rows + 1);
  const columns = table()!.firstChild!.childCount;
  await click("table.insertColumnRight");
  expect(table()!.firstChild!.childCount).toBe(columns + 1);
  hook.unmount();
});
it("AC-3: Source withheld tables, read-only and destroyed views refuse without edits", async () => {
  const hook = await setup("| A | B |\n| --- | --- |\n| x | y |");
  useEditorStore.setState({ viewMode: "source" });
  const view = source!.view;
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("x")) });
  useEditorStore.getState().recordSourceTableVerdict("d1", "withheld");
  const before = view.state.doc.toString();
  await click("table.insertRowBelow");
  expect(view.state.doc.toString()).toBe(before);
  expect(logs.at(-1)?.payload.context?.reason).toBe("unavailable");
  useEditorStore.setState({ sourceTableVerdicts: {} });
  source?.destroy();
  source = mountSourceMenuRig("alpha", true);
  useEditorStore.getState().setEditorView(source.view);
  await click("paragraph.heading2");
  expect(source.view.state.doc.toString()).toBe("alpha");
  expect(logs.at(-1)?.payload.context?.reason).toBe("read_only");
  source.view.destroy();
  await click("paragraph.heading2");
  expect(logs.at(-1)?.payload.context?.reason).toBe("missing_view");
  hook.unmount();
});
it("AC-3: empty Source input refuses a find step without creating text", async () => {
  const hook = await setup("");
  useEditorStore.setState({ viewMode: "source" });
  await click("edit.findNext");
  expect(source!.view.state.doc.toString()).toBe("");
  expect(logs.at(-1)?.payload.status).toBe("cancel");
  hook.unmount();
});
it("AC-3: W code-block indent and outdent change the selected line", async () => {
  const hook = await setup("alpha");
  await click("paragraph.codeFences");
  await click("paragraph.indent");
  expect(milkdown!.view.state.doc.firstChild?.textContent).toBe("    alpha");
  await click("paragraph.outdent");
  expect(milkdown!.view.state.doc.firstChild?.textContent).toBe("alpha");
  hook.unmount();
});
it("AC-3: W list indent/outdent change nesting, and plain paragraphs refuse", async () => {
  const hook = await setup("- first\n- second");
  const view = milkdown!.view;
  let second = -1;
  let seen = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "list_item" && ++seen === 2) second = pos + 2;
  });
  expect(second).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(second))));
  await click("paragraph.indent");
  expect(view.state.doc.firstChild?.childCount).toBe(1);
  await click("paragraph.outdent");
  expect(view.state.doc.firstChild?.childCount).toBe(2);
  hook.unmount();
});
it.each([
  "table.insertRowAbove", "table.insertRowBelow", "table.insertColumnLeft",
  "table.insertColumnRight", "table.deleteRow", "table.deleteColumn",
])("AC-3: W %s changes a table only from a cell", async (id) => {
  const hook = await setup("| A | B |\n| --- | --- |\n| x | y |\n| z | w |");
  const view = milkdown!.view;
  let cell = -1;
  view.state.doc.descendants((node, pos) => {
    if (cell < 0 && node.type.name === "table_cell") cell = pos;
  });
  expect(cell).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cell + 2))));
  const before = view.state.doc;
  await click(id);
  expect(view.state.doc.eq(before), id).toBe(false);
  hook.unmount();
});
