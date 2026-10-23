import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true }));
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { resolveBindings } from "../src/commands/bindingConflicts";
import { appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import { resolvedAppliedSnapshot } from "./support/resolvedAppliedSnapshot";

afterEach(teardownEditor);

it("released Cmd+U resolves from the real inventory and Save runs once in mounted Source", () => {
  const resolution = resolveBindings("macos", 2, { fileSave: "Cmd+U", formatUnderline: "Cmd+J" }).fileSave;
  expect(resolution).toEqual({ kind: "bound", chord: "Cmd+U" });
  const applied = resolvedAppliedSnapshot("macos", { fileSave: "Cmd+U", formatUnderline: "Cmd+J" });
  expect(applied.bindings.fileSave).toEqual({ state: "bound", chord: "Cmd+U" });
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  const event = new KeyboardEvent("keydown", { key: "u", code: "KeyU", keyCode: 85, metaKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(view.state.doc.toString()).toBe("alpha");
  hook.unmount();
});
