/**
 * D84-WI-2: the draft carries a typed, unsaved edit.
 *
 * A same-length edit on an already-dirty document (F3: `| f  |` → `| fk |`)
 * must reach `save_draft` on the next interval. useAutoSave reads the store at
 * tick time, so this was green before the D84 fix; it pins that the draft has
 * no length-based gate like the one D84 removed from useMcpSync.
 *
 * Boundary mocked: `invoke` (IPC) and the logging sink. Store and hook are real.
 * Runs under jsdom: the hook schedules with `window.setInterval`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAutoSave } from "../src/hooks/useAutoSave";
import { useDocumentStore } from "../src/stores/documentStore";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

describe("useAutoSave — draft carries a typed, unsaved edit (D84-WI-2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a same-length edit on a dirty doc reaches save_draft when the interval elapses", async () => {
    vi.useFakeTimers();
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useDocumentStore.setState({
      documents: [
        { id: "d1", path: "/a/one.md", content: "| f  |", encoding: "utf-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null },
      ] as never,
      activeDocumentId: "d1",
    });

    const { unmount } = renderHook(() => useAutoSave(5));
    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "| fk |");
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    const drafts = invokeMock.mock.calls.filter((call) => call[0] === "save_draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0][1]).toMatchObject({ documentId: "d1", content: "| fk |", originalPath: "/a/one.md" });
    unmount();
  });
});
