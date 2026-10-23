import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { keymap, runScopeHandlers } from "@codemirror/view";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import { useEditorStore } from "../src/stores/editorStore";

afterEach(teardownEditor);

it("D267: an unassigned Code Fences key does not fall through to deleteLine", () => {
  const applied = defaultAppliedShortcuts("linux");
  applied.bindings.paragraphCodeFences = { state: "unassigned" };
  const view = mountEditor("alpha\nbeta", { appliedShortcuts: applied });
  expect(view.state.facet(keymap).length).toBeGreaterThan(0);
  expect(view.state.facet(keymap).flat().some((row) => row.key === "Shift-Mod-k")).toBe(false);
  view.dispatch({ selection: { anchor: 2 } });
  const event = new KeyboardEvent("keydown", { key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(view.state.doc.toString()).toBe("alpha\nbeta");
});

it("D269: Highlight owns Ctrl+Shift+M without a lint keymap rival", () => {
  const view = mountEditor("alpha", { appliedShortcuts: defaultAppliedShortcuts("linux") });
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  const event = new KeyboardEvent("keydown", { key: "M", code: "KeyM", keyCode: 77, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  expect(view.state.facet(keymap).flat().map((row) => row.key)).toContain("Ctrl-Shift-m");
  expect(view.state.doc.toString()).toBe('<mark style="background: #FF5582A6;">alpha</mark>');
  expect(view.state.facet(keymap).flat().some((row) => row.key === "Mod-Shift-m")).toBe(false);
});

it("D272: off-Mac Ctrl+M stays available to native Minimize", () => {
  const view = mountEditor("alpha", { appliedShortcuts: defaultAppliedShortcuts("linux") });
  const event = new KeyboardEvent("keydown", { key: "m", code: "KeyM", keyCode: 77, ctrlKey: true, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(view.state.facet(keymap).flat().some((row) => row.key === "Ctrl-m" && row.mac === "Shift-Alt-m")).toBe(false);
});

it("applies default Source Indent and Outdent and follows a custom Indent chord", () => {
  const applied = defaultAppliedShortcuts("linux");
  applied.bindings.paragraphIndent = { state: "bound", chord: "Cmd+J" };
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  const press = (key: string, extra: KeyboardEventInit) =>
    runScopeHandlers(view, new KeyboardEvent("keydown", {
      key, bubbles: true, cancelable: true, ...extra,
    }), "editor");
  view.dispatch({ selection: { anchor: 2 } });
  press("]", { ctrlKey: true });
  expect(view.state.doc.toString()).toBe("alpha");
  press("j", { ctrlKey: true });
  expect(view.state.doc.toString()).toBe("    alpha");
  press("[", { ctrlKey: true });
  expect(view.state.doc.toString()).toBe("alpha");
});

it("an unassigned Source Indent chord does not fall through to CodeMirror's default", () => {
  const applied = defaultAppliedShortcuts("linux");
  applied.bindings.paragraphIndent = { state: "unassigned" };
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 2 } });
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    key: "]", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  expect(view.state.doc.toString()).toBe("alpha");
});

it("Source Quote follows its v2 applied chord and an unassigned chord stays inert", () => {
  const applied = defaultAppliedShortcuts("linux");
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 2 } });
  runScopeHandlers(view, new KeyboardEvent("keydown", {
    key: "Q", code: "KeyQ", keyCode: 81, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }), "editor");
  expect(view.state.doc.toString()).toBe("> alpha");
  teardownEditor();
  const unassigned = defaultAppliedShortcuts("linux");
  unassigned.bindings.paragraphQuote = { state: "unassigned" };
  const next = mountEditor("alpha", { appliedShortcuts: unassigned });
  next.dispatch({ selection: { anchor: 2 } });
  runScopeHandlers(next, new KeyboardEvent("keydown", {
    key: "Q", code: "KeyQ", keyCode: 81, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }), "editor");
  expect(next.state.doc.toString()).toBe("alpha");
});

it("Source F6 cycles view mode as the fixed v2 secondary", () => {
  useEditorStore.setState({ viewMode: "source" });
  const before = useEditorStore.getState().userViewModeChoice.seq;
  const view = mountEditor("alpha", { appliedShortcuts: defaultAppliedShortcuts("linux") });
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    key: "F6", bubbles: true, cancelable: true,
  }));
  expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  expect(useEditorStore.getState().userViewModeChoice).toEqual({ seq: before + 1, mode: "wysiwyg" });
});

it.each(["custom", "unassigned"] as const)("Source F6 survives a %s configurable primary", (state) => {
  const applied = defaultAppliedShortcuts("linux");
  applied.bindings.viewCycleViewMode = state === "custom"
    ? { state: "bound", chord: "Cmd+Option+J" } : { state: "unassigned" };
  useEditorStore.setState({ viewMode: "source" });
  const before = useEditorStore.getState().userViewModeChoice.seq;
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true, cancelable: true }));
  expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  expect(useEditorStore.getState().userViewModeChoice.seq).toBe(before + 1);
});
