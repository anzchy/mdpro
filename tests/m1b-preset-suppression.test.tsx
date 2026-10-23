import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { TextSelection } from "@milkdown/kit/prose/state";
import { serializerCtx } from "@milkdown/kit/core";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; });

it("an unassigned Bold key cannot fall through to the commonmark preset", async () => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.formatStrong = { state: "unassigned" };
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  const view = rig.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))).toBe("alpha\n");
});
