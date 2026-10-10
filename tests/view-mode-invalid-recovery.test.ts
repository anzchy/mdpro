/**
 * D24 — `nextViewMode` recovers from a mode outside `VIEW_MODE_ORDER`.
 *
 * A persisted or stale value (e.g. the removed "split" mode) has index -1; a user cycle
 * must land on the first mode, "wysiwyg", and record that landed mode as the choice.
 *
 * Runs under jsdom (no node marker): the store's import graph reaches DOMPurify,
 * which needs a window at module load. Only `@tauri-apps/api/core` is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));

import { useEditorStore } from "../src/stores/editorStore";

beforeEach(() => {
  useEditorStore.setState({
    viewMode: "wysiwyg",
    editorView: null,
    userViewModeChoice: { seq: 2, mode: "source" },
  });
});

describe("D24 — cycle from an unknown view mode", () => {
  it("VIR-1: a user cycle from 'split' lands on wysiwyg and records { seq + 1, wysiwyg }", () => {
    useEditorStore.setState({ viewMode: "split" as never });
    const before = useEditorStore.getState().userViewModeChoice.seq;

    useEditorStore.getState().cycleViewMode("user");

    const s = useEditorStore.getState();
    expect(s.viewMode).toBe("wysiwyg");
    expect(s.userViewModeChoice).toEqual({ seq: before + 1, mode: "wysiwyg" });
  });
});
