import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import type { KeyboardShortcuts } from "../src/types/preferences";
import { useEditorStore, userViewModeCommands } from "../src/stores/editorStore";
import { TextSelection } from "@milkdown/kit/prose/state";
import { serializerCtx } from "@milkdown/kit/core";
import { mountScriptedMilkdownRig } from "./helpers/scriptedMilkdownRig";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../src/commands/appliedKeymap";

afterEach(() => { document.body.innerHTML = ""; });

it("F6 cycles view mode from WYSIWYG through the fixed secondary", () => {
  useEditorStore.setState({ viewMode: "wysiwyg" });
  const before = useEditorStore.getState().userViewModeChoice.seq;
  const { unmount } = renderHook(() => useKeyboardShortcuts({
    onCycleViewMode: userViewModeCommands.cycle, shortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  }));
  const editor = document.createElement("div");
  editor.className = "ProseMirror";
  document.body.appendChild(editor);
  act(() => { editor.dispatchEvent(new KeyboardEvent("keydown", {
    key: "F6", bubbles: true, cancelable: true,
  })); });
  expect(useEditorStore.getState().viewMode).toBe("source");
  expect(useEditorStore.getState().userViewModeChoice.seq).toBe(before + 1);
  unmount();
});

it.each(["custom", "unassigned"] as const)("F6 keeps cycling in WYSIWYG with a %s primary", (state) => {
  useEditorStore.setState({ viewMode: "wysiwyg" });
  const before = useEditorStore.getState().userViewModeChoice.seq;
  const shortcuts = { ...DEFAULT_KEYBOARD_SHORTCUTS,
    viewCycleViewMode: state === "custom" ? "Cmd+Option+J" : "<unassigned>" };
  const { unmount } = renderHook(() => useKeyboardShortcuts({ onCycleViewMode: userViewModeCommands.cycle, shortcuts }));
  const editor = document.body.appendChild(document.createElement("div"));
  editor.className = "ProseMirror";
  act(() => { editor.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true, cancelable: true })); });
  expect(useEditorStore.getState().viewMode).toBe("source");
  expect(useEditorStore.getState().userViewModeChoice.seq).toBe(before + 1);
  unmount();
});

const HOOK_FIELDS: Array<keyof KeyboardShortcuts> = [
  "formatHyperlink", "paragraphParagraph", "paragraphHeading1", "paragraphHeading2",
  "paragraphHeading3", "paragraphHeading4", "paragraphHeading5", "paragraphHeading6",
  "fileNew", "fileNewWindow", "formatHighlight", "fileExportHtml", "viewToggleSidebar",
  "fileOpen", "fileSave", "fileClose", "viewCycleViewMode", "filePreferences",
  "paragraphTable", "tableInsertRowAbove", "tableInsertRowBelow", "tableInsertColumnLeft",
  "tableInsertColumnRight", "tableDeleteRow", "tableDeleteColumn",
];

it.each(["wysiwyg", "source"] as const)("M1b WI-15 every hook field yields to a composed Bold key in %s", async (mode) => {
  for (const field of HOOK_FIELDS) {
    const calls = vi.fn();
    const callbacks = {
      onOpen: calls, onSave: calls, onClose: calls, onNew: calls, onNewWindow: calls,
      onHighlight: calls, onExportHtml: calls, onToggleSidebar: calls, onCycleViewMode: calls,
      onOpenPreferences: calls, onInsertTable: calls, onTableAction: calls,
    };
    const applied = defaultAppliedShortcuts("macos");
    const shortcuts = { ...appliedStoredShortcuts(applied), [field]: "Cmd+B" };
    let editor: HTMLElement;
    let documentText: () => string;
    let dispose: () => Promise<void>;
    if (mode === "wysiwyg") {
      const rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
      rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
      editor = rig.view.dom;
      documentText = () => rig.editor.action((ctx) => ctx.get(serializerCtx)(rig.view.state.doc));
      dispose = () => rig.destroy();
    } else {
      const view = mountEditor("alpha", { appliedShortcuts: applied });
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      editor = view.contentDOM;
      documentText = () => view.state.doc.toString();
      dispose = async () => teardownEditor();
    }
    const { unmount } = renderHook(() => useKeyboardShortcuts({ ...callbacks, shortcuts }));
    const event = new KeyboardEvent("keydown", { key: "b", code: "KeyB", keyCode: 66,
      metaKey: true, bubbles: true, cancelable: true });
    act(() => { editor.dispatchEvent(event); });
    expect(event.defaultPrevented, field).toBe(true);
    expect(documentText(), field).toBe(mode === "source" ? "**alpha**" : "**alpha**\n");
    expect(calls, field).not.toHaveBeenCalled();
    unmount();
    await dispose();
  }
});
