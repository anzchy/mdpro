import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true }));
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { resolveBindings } from "../src/commands/bindingConflicts";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import { resolvedAppliedSnapshot } from "./support/resolvedAppliedSnapshot";

afterEach(teardownEditor);

it("released Ctrl+U lets custom Save run once on off-Mac Source", () => {
  const stored = { fileSave: "Cmd+U", formatUnderline: "Cmd+J" };
  expect(resolveBindings("windows", 2, stored).fileSave).toEqual({ kind: "bound", chord: "Cmd+U" });
  const applied = resolvedAppliedSnapshot("windows", stored);
  expect(applied.bindings.fileSave).toEqual({ state: "bound", chord: "Cmd+U" });
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  const event = new KeyboardEvent("keydown", { key: "u", code: "KeyU", keyCode: 85, ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(view.state.doc.toString()).toBe("alpha");
  hook.unmount();
});

it.each([["Home", 36], ["End", 35]] as const)("retained Ctrl+%s navigation refuses custom Save on off-Mac Source", (key, keyCode) => {
  const chord = `Cmd+${key}`;
  const stored = { fileSave: chord, formatUnderline: "Cmd+J" };
  expect(resolveBindings("windows", 2, stored).fileSave).toMatchObject({ kind: "suppressed", reason: "editorOwned" });
  const applied = resolvedAppliedSnapshot("windows", stored);
  expect(applied.bindings.fileSave).toEqual({ state: "suppressed", reason: "editorOwned" });
  const view = mountEditor("alpha\nbeta", { appliedShortcuts: applied });
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  const event = new KeyboardEvent("keydown", { key, code: key, keyCode, ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(onSave).toHaveBeenCalledTimes(0);
  expect(view.state.doc.toString()).toBe("alpha\nbeta");
  hook.unmount();
});
