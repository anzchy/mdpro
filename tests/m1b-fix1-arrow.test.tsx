import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true }));
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { defaultAppliedShortcuts, appliedKey, appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; teardownEditor(); });

it.each(["macos", "windows", "linux"] as const)("normalizes %s custom arrow to editor key syntax", (platform) => {
  const applied = defaultAppliedShortcuts(platform);
  applied.bindings.formatStrong = { state: "bound", chord: "Cmd+Option+Shift+Up" };
  expect(appliedKey(applied, "formatStrong", platform)).toBe(platform === "macos" ? "Mod-Alt-Shift-ArrowUp" : "Ctrl-Alt-Shift-ArrowUp");
});

it.each([
  ["wysiwyg", "Up", 38], ["wysiwyg", "Down", 40], ["wysiwyg", "Left", 37], ["wysiwyg", "Right", 39],
  ["source", "Up", 38], ["source", "Down", 40], ["source", "Left", 37], ["source", "Right", 39],
] as const)("custom %s Bold changes composed macOS %s once", async (mode, direction, keyCode) => {
  const applied = defaultAppliedShortcuts("macos");
  applied.bindings.formatStrong = { state: "bound", chord: `Cmd+Option+Shift+${direction}` };
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  let target: HTMLElement;
  let content: () => string;
  let dispatch: ReturnType<typeof vi.spyOn>;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
    target = rig.view.dom;
    content = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
    dispatch = vi.spyOn(rig.view, "dispatch");
  } else {
    const view = mountEditor("alpha", { appliedShortcuts: applied });
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    target = view.contentDOM;
    content = () => view.state.doc.toString();
    dispatch = vi.spyOn(view, "dispatch");
  }
  const event = new KeyboardEvent("keydown", { key: `Arrow${direction}`, code: `Arrow${direction}`, keyCode, metaKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(content()).toBe(mode === "wysiwyg" ? "**alpha**\n" : "**alpha**");
  expect(dispatch).toHaveBeenCalledTimes(1);
  hook.unmount();
});
