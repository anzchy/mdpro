/**
 * @module milkdown-editor-store.test
 * Purpose: Verify the Milkdown editor instance is exposed via a small
 * Zustand store so app-level callbacks (e.g. the ⌘⌥T table insert
 * shortcut wired in App.tsx) can dispatch into the active editor.
 *
 * Strategy: store contract test (mirrors tests/tableInsertStore.test.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";

describe("useMilkdownEditorStore", () => {
  beforeEach(() => {
    useMilkdownEditorStore.setState({ getEditor: () => null });
  });

  it("starts with a getEditor function that returns null", () => {
    expect(typeof useMilkdownEditorStore.getState().getEditor).toBe("function");
    expect(useMilkdownEditorStore.getState().getEditor()).toBeNull();
  });

  it("registerEditor stores a getter that returns the registered editor", () => {
    const fakeEditor = { id: "editor-1" };
    useMilkdownEditorStore.getState().registerEditor(() => fakeEditor as unknown);

    expect(useMilkdownEditorStore.getState().getEditor()).toBe(fakeEditor);
  });

  it("unregisterEditor restores the null getter", () => {
    const fakeEditor = { id: "editor-2" };
    useMilkdownEditorStore.getState().registerEditor(() => fakeEditor as unknown);
    useMilkdownEditorStore.getState().unregisterEditor();

    expect(useMilkdownEditorStore.getState().getEditor()).toBeNull();
  });

  it("the getter is called fresh each time (returns the current editor instance)", () => {
    let current: unknown = { id: "first" };
    useMilkdownEditorStore.getState().registerEditor(() => current);

    expect(useMilkdownEditorStore.getState().getEditor()).toEqual({ id: "first" });

    current = { id: "second" };
    expect(useMilkdownEditorStore.getState().getEditor()).toEqual({ id: "second" });
  });
});
