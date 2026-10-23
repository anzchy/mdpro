import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { TextSelection } from "@milkdown/kit/prose/state";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { serializerCtx } from "@milkdown/kit/core";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; });

it("D271: Cmd+] inside a WYSIWYG table cannot navigate to the next cell", async () => {
  rig = await mountScriptedMilkdownRig("| a | b |\n| --- | --- |\n| one | two |", { heights: [30] });
  const view = rig.view;
  let firstCellText = -1;
  view.state.doc.descendants((node, pos) => {
    if (firstCellText < 0 && node.isText && node.text === "one") firstCellText = pos;
  });
  expect(firstCellText).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, firstCellText + 1)));
  const before = view.state.selection.from;
  view.dom.dispatchEvent(new KeyboardEvent("keydown", {
    key: "]", code: "BracketRight", keyCode: 221, metaKey: true, bubbles: true, cancelable: true,
  }));
  expect(view.state.selection.from).toBe(before);
});

it("keeps Tab table-cell navigation after releasing Cmd+]", async () => {
  rig = await mountScriptedMilkdownRig("| a | b |\n| --- | --- |\n| one | two |", { heights: [30] });
  const view = rig.view;
  let firstCellText = -1;
  view.state.doc.descendants((node, pos) => {
    if (firstCellText < 0 && node.isText && node.text === "one") firstCellText = pos;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, firstCellText + 1)));
  const before = view.state.selection.from;
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true }));
  expect(view.state.selection.from).toBeGreaterThan(before);
});

it("an unassigned Indent key cannot fall through to the commonmark list preset", async () => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.paragraphIndent = { state: "unassigned" };
  rig = await mountScriptedMilkdownRig("- one\n- two", { heights: [30], appliedShortcuts: applied });
  const view = rig.view;
  let two = -1;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "two") two = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, two + 1)));
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "]", code: "BracketRight", keyCode: 221, metaKey: true, bubbles: true, cancelable: true }));
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))).toBe("- one\n- two\n");
});

it("the applied Indent key sinks one list item outside a table", async () => {
  rig = await mountScriptedMilkdownRig("- one\n- two", { heights: [30] });
  const view = rig.view;
  let two = -1;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "two") two = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, two + 1)));
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "]", code: "BracketRight", keyCode: 221, metaKey: true, bubbles: true, cancelable: true }));
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))).toBe("- one\n  - two\n");
});
