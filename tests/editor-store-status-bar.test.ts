import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../src/stores/editorStore";

describe("editorStore showStatusBar", () => {
  beforeEach(() => {
    useEditorStore.setState({ showStatusBar: false });
  });

  // B1: default is false
  it("defaults showStatusBar to false", () => {
    expect(useEditorStore.getState().showStatusBar).toBe(false);
  });

  // B2: toggle flips
  it("toggles showStatusBar on/off", () => {
    useEditorStore.getState().toggleStatusBar();
    expect(useEditorStore.getState().showStatusBar).toBe(true);
    useEditorStore.getState().toggleStatusBar();
    expect(useEditorStore.getState().showStatusBar).toBe(false);
  });

  // B3: setter sets explicit value
  it("sets showStatusBar explicitly", () => {
    useEditorStore.getState().setShowStatusBar(true);
    expect(useEditorStore.getState().showStatusBar).toBe(true);
    useEditorStore.getState().setShowStatusBar(false);
    expect(useEditorStore.getState().showStatusBar).toBe(false);
  });
});
