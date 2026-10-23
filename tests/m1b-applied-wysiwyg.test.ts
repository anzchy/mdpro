import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { TextSelection } from "@milkdown/kit/prose/state";
import { serializerCtx } from "@milkdown/kit/core";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; });

it("custom Bold acts on the WYSIWYG document while unassignment removes the preset fallback", async () => {
  const custom = defaultAppliedShortcuts("macos");
  custom.bindings.formatStrong = { state: "bound", chord: "Cmd+J" };
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: custom });
  rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  rig.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true, cancelable: true }));
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("**alpha**\n");
  await rig.destroy();
  rig = null;
  const unassigned = defaultAppliedShortcuts("macos");
  unassigned.bindings.formatStrong = { state: "unassigned" };
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: unassigned });
  rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  rig.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("alpha\n");
});

