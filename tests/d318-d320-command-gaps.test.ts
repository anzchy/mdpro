import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { TextSelection } from "@milkdown/kit/prose/state";
import { history, undo } from "@milkdown/kit/prose/history";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { captureToken } from "../src/utils/menuTargetToken";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { logs } from "./support/menuEventsHarness";
import { resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountMilkdownMenuRig, type MilkdownMenuRig } from "./support/editorMenuRig";

let rig: MilkdownMenuRig | null = null;

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

afterEach(async () => {
  useMilkdownEditorStore.getState().unregisterEditor();
  await rig?.destroy();
  rig = null;
});

async function mount(markdown: string, selectedItem = 0) {
  rig = await mountMilkdownMenuRig(markdown);
  useMilkdownEditorStore.getState().registerEditor(() => rig?.editor ?? null);
  const view = rig.view;
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, history()] }));
  let item = -1;
  let index = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "list_item" && index++ === selectedItem) item = pos;
  });
  if (item < 0 && selectedItem !== 0) throw new Error(`Missing list item ${selectedItem}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(item < 0 ? 1 : item + 2))));
  return view;
}

function listShape() {
  const list = rig!.view.state.doc.firstChild!;
  return { kind: list.type.name, items: list.childCount, content: list.textContent };
}

it.each([
  ["1. 汉字\n2. second\n   1. nested", "paragraph.unorderedList", "bullet_list", 0],
  ["- 汉字\n- second\n  - nested", "paragraph.orderedList", "ordered_list", 1],
] as const)("D318 menu converts %s as one undoable list change", async (markdown, id, want, selectedItem) => {
  const view = await mount(markdown, selectedItem);
  const beforeDoc = view.state.doc.toJSON();
  const beforeItems = view.state.doc.firstChild!.content.toJSON();
  expect(view.state.doc.firstChild!.childCount).toBe(2);
  expect(dispatchEditorMenuAction(`editor.${id}`, captureToken("main"))).toBe(true);
  expect(view.state.doc.firstChild!.type.name).toBe(want);
  expect(view.state.doc.firstChild!.content.toJSON()).toEqual(beforeItems);
  expect(logs.filter((line) => line.payload.event === "ui.menu.select").at(-1)?.payload.status).toBe("success");
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.state.doc.toJSON()).toEqual(beforeDoc);
});

it.each([
  ["paragraph.unorderedList", "bullet_list", "- first"],
  ["paragraph.orderedList", "ordered_list", "1. first"],
] as const)("D318 %s wraps plain text and leaves the same list kind alone", async (id, kind, markdown) => {
  const view = await mount("first");
  expect(dispatchEditorMenuAction(`editor.${id}`, captureToken("main"))).toBe(true);
  expect(listShape()).toEqual({ kind, items: 1, content: "first" });
  const after = view.state.doc;
  expect(dispatchEditorMenuAction(`editor.${id}`, captureToken("main"))).toBe(true);
  expect(view.state.doc.eq(after)).toBe(true);
  expect(logs.filter((line) => line.payload.event === "ui.menu.select").at(-1)?.payload.context?.reason).toBe("no_change");
  expect(markdown).toContain("first");
});

it("D318 conversion Undo keeps text typed immediately before the menu action", async () => {
  const view = await mount("1. first\n2. second");
  const at = view.state.selection.from;
  view.dispatch(view.state.tr.insertText("新", at));
  const afterTyping = view.state.doc.toJSON();
  expect(dispatchEditorMenuAction("editor.paragraph.unorderedList", captureToken("main"))).toBe(true);
  expect(listShape().kind).toBe("bullet_list");
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.state.doc.toJSON()).toEqual(afterTyping);
});

it.each([
  ["1. 汉字\n2. second\n   1. nested", "u", "bullet_list"],
  ["- 汉字\n- second\n  - nested", "o", "ordered_list"],
] as const)("D318 shortcut converts %s and one Undo restores it", async (markdown, key, want) => {
  const view = await mount(markdown);
  const beforeDoc = view.state.doc.toJSON();
  const beforeItems = view.state.doc.firstChild!.content.toJSON();
  const event = new KeyboardEvent("keydown", { key, metaKey: true, altKey: true, bubbles: true, cancelable: true });
  view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.firstChild!.type.name).toBe(want);
  expect(view.state.doc.firstChild!.content.toJSON()).toEqual(beforeItems);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.state.doc.toJSON()).toEqual(beforeDoc);
});

it.each(["menu", "key"] as const)("D318 %s converts the selected nested list only", async (route) => {
  const view = await mount("- outer\n  1. nested one\n  2. nested two\n- sibling", 1);
  const beforeDoc = view.state.doc.toJSON();
  expect(view.state.doc.firstChild!.type.name).toBe("bullet_list");
  expect(view.state.doc.firstChild!.firstChild!.lastChild!.type.name).toBe("ordered_list");
  if (route === "menu") {
    expect(dispatchEditorMenuAction("editor.paragraph.unorderedList", captureToken("main"))).toBe(true);
  } else {
    const event = new KeyboardEvent("keydown", { key: "u", metaKey: true, altKey: true, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  const afterDoc = view.state.doc.toJSON();
  const expected = structuredClone(beforeDoc);
  const outer = expected.content[0];
  outer.content[0].content[1].type = "bullet_list";
  outer.content[0].content[1].attrs = { marker: null, spread: false };
  expect(afterDoc).toEqual(expected);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.state.doc.toJSON()).toEqual(beforeDoc);
});
