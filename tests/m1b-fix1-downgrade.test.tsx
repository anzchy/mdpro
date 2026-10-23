import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true }));
import { serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; });

it.each(["Backspace", "Delete"])("%s at the start of loaded H2 downgrades to H1 and paragraph", async (key) => {
  rig = await mountScriptedMilkdownRig("before\n\n## x", { heights: [30, 30] });
  const view = rig.view;
  const markdown = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc));
  const press = () => {
    const start = view.state.doc.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start)));
    const event = new KeyboardEvent("keydown", { key, code: key, keyCode: key === "Backspace" ? 8 : 46, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    return event;
  };
  expect(markdown()).toBe("before\n\n## x\n");
  expect(press().defaultPrevented).toBe(true);
  expect(markdown()).toBe("before\n\n# x\n");
  expect(press().defaultPrevented).toBe(true);
  expect(markdown()).toBe("before\n\nx\n");
  expect(view.state.doc.childCount).toBe(2);
});

it.each(["Backspace", "Delete"])("%s downgrades an H2 that is the first block to paragraph", async (key) => {
  rig = await mountScriptedMilkdownRig("## x", { heights: [30] });
  const view = rig.view;
  const press = () => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const event = new KeyboardEvent("keydown", { key, code: key, keyCode: key === "Backspace" ? 8 : 46, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  press();
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))).toBe("# x\n");
  press();
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))).toBe("x\n");
});

it.each([1, 2, 3, 4, 5, 6])("unassigned H%s chord cannot revive the preset heading binding", async (level) => {
  const applied = defaultAppliedShortcuts("macos");
  const field = `paragraphHeading${level}` as keyof typeof applied.bindings;
  applied.bindings[field] = { state: "unassigned" };
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  const event = new KeyboardEvent("keydown", { key: String(level), code: `Digit${level}`, metaKey: true, altKey: true, bubbles: true, cancelable: true });
  rig.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(rig.view.state.doc.firstChild?.type.name).toBe("paragraph");
});

it("custom H1 chord runs while the old preset chord stays released", async () => {
  const applied = defaultAppliedShortcuts("macos");
  applied.bindings.paragraphHeading1 = { state: "bound", chord: "Cmd+J" };
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  const oldKey = new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true, altKey: true, bubbles: true, cancelable: true });
  rig.view.dom.dispatchEvent(oldKey);
  expect(oldKey.defaultPrevented).toBe(false);
  expect(rig.view.state.doc.firstChild?.type.name).toBe("paragraph");
  const custom = new KeyboardEvent("keydown", { key: "j", code: "KeyJ", metaKey: true, bubbles: true, cancelable: true });
  rig.view.dom.dispatchEvent(custom);
  expect(custom.defaultPrevented).toBe(true);
  expect(rig.view.state.doc.firstChild?.type.name).toBe("heading");
});
