import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { serializerCtx } from "@milkdown/kit/core";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; });

it("the v2 WYSIWYG Quote key wraps one paragraph once", async () => {
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30] });
  const event = new KeyboardEvent("keydown", { key: "B", code: "KeyB", keyCode: 66, metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
  rig.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("> alpha\n");
});
