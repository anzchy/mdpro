import { renderHook, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true }));
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { resolveBindings } from "../src/commands/bindingConflicts";
import { appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import { resolvedAppliedSnapshot } from "./support/resolvedAppliedSnapshot";

afterEach(teardownEditor);

it.each([["Cmd+Up", "ArrowUp", "ArrowUp", true]])(
  "resolver retains the installed Source owner before custom Save %s reaches the hook",
  (chord, key, code, arrow) => {
    const resolution = resolveBindings("macos", 2, { fileSave: chord, formatUnderline: "Cmd+J" }).fileSave;
    expect(resolution).toMatchObject({ kind: "suppressed", reason: "editorOwned" });
    const applied = resolvedAppliedSnapshot("macos", { fileSave: chord, formatUnderline: "Cmd+J" });
    expect(applied.bindings.fileSave).toEqual({ state: "suppressed", reason: "editorOwned" });
    const view = mountEditor("alpha\nbeta", { appliedShortcuts: applied });
    const onSave = vi.fn();
    const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
    const event = new KeyboardEvent("keydown", { key, code, keyCode: arrow ? 38 : 85, metaKey: true, bubbles: true, cancelable: true });
    act(() => { view.contentDOM.dispatchEvent(event); });
    expect(onSave).toHaveBeenCalledTimes(0);
    expect(view.state.doc.toString()).toBe("alpha\nbeta");
    hook.unmount();
  },
);
