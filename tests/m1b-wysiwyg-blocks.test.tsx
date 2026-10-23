import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { serializerCtx } from "@milkdown/kit/core";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; });

it.each([
  ["c", "```"] , ["o", "1. alpha"], ["u", "- alpha"],
])("WYSIWYG Cmd+Option+%s runs its applied block command", async (key, expected) => {
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30] });
  const event = new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), metaKey: true, altKey: true, bubbles: true, cancelable: true });
  rig.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toContain(expected);
});
