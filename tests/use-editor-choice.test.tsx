/**
 * D24 WI-3 — `useEditor().userViewModeChoice` is a reactive subscription.
 *
 * A user command re-renders the hook with a NEW choice object even when the mode does
 * not change (so `useLastViewModePersistence` sees every choice); the hook's own
 * `setViewMode` is the store action with its programmatic default, which changes the
 * mode and keeps the choice reference.
 *
 * Only `@tauri-apps/api/core` is mocked (logging reaches `invoke`); the real store runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));

import { act, renderHook } from "@testing-library/react";
import { useEditor } from "../src/hooks/useEditor";
import { useEditorStore, userViewModeCommands } from "../src/stores/editorStore";

beforeEach(() => {
  useEditorStore.setState({
    viewMode: "wysiwyg",
    editorView: null,
    userViewModeChoice: { seq: 7, mode: "wysiwyg" },
  });
});

describe("D24 WI-3 — useEditor exposes a reactive userViewModeChoice", () => {
  it("UEC-1: a same-mode user set re-renders with a new choice, seq + 1, viewMode unchanged", () => {
    const { result } = renderHook(() => useEditor());
    const before = result.current.userViewModeChoice;
    expect(before).toEqual({ seq: 7, mode: "wysiwyg" });

    act(() => userViewModeCommands.set("wysiwyg"));

    expect(result.current.userViewModeChoice).not.toBe(before);
    expect(result.current.userViewModeChoice).toEqual({ seq: 8, mode: "wysiwyg" });
    expect(result.current.viewMode).toBe("wysiwyg");
  });

  it("UEC-2: the hook's setViewMode is programmatic — mode changes, choice keeps its reference", () => {
    const { result } = renderHook(() => useEditor());
    act(() => userViewModeCommands.set("wysiwyg"));
    const afterUser = result.current.userViewModeChoice;

    act(() => result.current.setViewMode("source"));

    expect(result.current.viewMode).toBe("source");
    expect(result.current.userViewModeChoice).toBe(afterUser);
    expect(result.current.userViewModeChoice).toEqual({ seq: 8, mode: "wysiwyg" });
  });
});
