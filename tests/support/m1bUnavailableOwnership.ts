import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { serializerCtx } from "@milkdown/kit/core";
import { mountScriptedMilkdownRig, type MilkdownRig } from "../helpers/scriptedMilkdownRig";
import { mountEditor, teardownEditor } from "./mountSourceEditor";
import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../../src/hooks/useKeyboardShortcuts";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { doc, seedStores } from "./editorGenerationDomain";

export function registerUnavailableOwnershipCases(platform: "macos" | "linux"): void {
  let rig: MilkdownRig | null = null;
  afterEach(async () => {
    await rig?.destroy();
    rig = null;
    teardownEditor();
  });

  async function setup(mode: "wysiwyg" | "source", content = "alpha\nbeta\ngamma") {
    seedStores();
    useDocumentStore.setState({
      documents: [doc("d1", content), doc("d2", "other")],
      activeDocumentId: "d1",
    });
    useEditorStore.setState({ viewMode: mode });
    const applied = defaultAppliedShortcuts(platform);
    const appAction = vi.fn();
    const hook = renderHook(() => useKeyboardShortcuts({
      onOpen: appAction, onSave: appAction, onCycleViewMode: appAction,
      shortcuts: appliedStoredShortcuts(applied),
    }));
    if (mode === "wysiwyg") {
      rig = await mountScriptedMilkdownRig(content, { heights: [30], appliedShortcuts: applied });
      return {
        target: rig.view.dom,
        select: () => rig!.view.dispatch(rig!.view.state.tr.setSelection(TextSelection.create(rig!.view.state.doc, 2, 12))),
        position: () => [rig!.view.state.selection.from, rig!.view.state.selection.to],
        content: () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc)),
        hook, appAction,
      };
    }
    const view = mountEditor(content, { docId: "d1", appliedShortcuts: applied });
    return {
      target: view.contentDOM,
      select: () => view.dispatch({ selection: { anchor: 2, head: 12 } }),
      position: () => [view.state.selection.main.from, view.state.selection.main.to],
      content: () => view.state.doc.toString(),
      hook, appAction,
    };
  }

  function press(target: HTMLElement, key: string, mods: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, ...mods, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event;
  }

  it.each(["wysiwyg", "source"] as const)(`${platform} %s Jump leaves a meaningful selection to the native owner`, async (mode) => {
    const state = await setup(mode);
    state.select();
    const before = state.position();
    expect(before[0]).toBeLessThan(before[1]);
    for (const key of ["ArrowUp", "ArrowDown"]) {
      state.select();
      const event = press(state.target, key, platform === "macos" ? { metaKey: true } : { ctrlKey: true });
      expect(event.defaultPrevented, key).toBe(platform === "macos" && mode === "source");
      const expected = platform === "macos" && mode === "source"
        ? [key === "ArrowUp" ? 0 : "alpha\nbeta\ngamma".length, key === "ArrowUp" ? 0 : "alpha\nbeta\ngamma".length]
        : before;
      expect(state.position(), key).toEqual(expected);
      expect(state.appAction).toHaveBeenCalledTimes(0);
    }
    state.hook.unmount();
  });

  it(`${platform} Source Delete Word after a word does not delete it`, async () => {
    const state = await setup("source", "alpha beta");
    const view = useEditorStore.getState().editorView!;
    view.dispatch({ selection: { anchor: 5 } });
    const event = press(state.target, "d", platform === "macos"
      ? { metaKey: true, shiftKey: true }
      : { ctrlKey: true, shiftKey: true });
    expect(state.content()).toBe("alpha beta");
    expect(view.state.selection.main.head).toBe(5);
    expect(event.defaultPrevented).toBe(true);
    state.hook.unmount();
  });

  it.each(["wysiwyg", "source"] as const)(`${platform} composed %s old Switch Documents chord leaves the active document and event to its owner`, async (mode) => {
    const state = await setup(mode);
    const before = state.content();
    const event = press(state.target, "`", platform === "macos" ? { metaKey: true } : { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("d1");
    expect(useEditorStore.getState().viewMode).toBe(mode);
    expect(state.content()).toBe(before);
    expect(state.appAction).toHaveBeenCalledTimes(0);
    state.hook.unmount();
  });

  it.each(["wysiwyg", "source"] as const)(`${platform} composed %s old Fullscreen chord does not change document or mode`, async (mode) => {
    const state = await setup(mode);
    const before = state.content();
    const event = press(state.target, "f", platform === "macos"
      ? { metaKey: true, altKey: true }
      : { ctrlKey: true, altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("d1");
    expect(useEditorStore.getState().viewMode).toBe(mode);
    expect(state.content()).toBe(before);
    expect(state.appAction).toHaveBeenCalledTimes(0);
    state.hook.unmount();
  });

  if (platform === "linux") {
    it.each(["2", "4"] as const)("off-Mac direct Ctrl+%s changes heading without switching view mode", async (key) => {
      const state = await setup("source", "alpha");
      const event = press(state.target, key, { ctrlKey: true, code: `Digit${key}` });
      expect(event.defaultPrevented).toBe(true);
      expect(state.content()).toBe(key === "2" ? "## alpha" : "#### alpha");
      expect(useEditorStore.getState().viewMode).toBe("source");
      expect(useDocumentStore.getState().activeDocumentId).toBe("d1");
      state.hook.unmount();
    });
  }
}
