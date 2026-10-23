/** D255: the off-Mac keyboard entry saves through the same body in both modes. */
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; args: Record<string, unknown> }> }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "save_file_dialog") return { success: true, path: "/tmp/saved.md", savedAt: 1 };
    return null;
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "A" }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

it.each(["wysiwyg", "source"] as const)("Ctrl+Shift+S saves a %s document through Save As", async (mode) => {
  const platform = window.navigator.platform;
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
  try {
    vi.resetModules();
    const { useKeyboardShortcuts } = await import("../src/hooks/useKeyboardShortcuts");
    const { saveActiveDocumentAs } = await import("../src/services/documentSave");
    const { useDocumentStore } = await import("../src/stores/documentStore");
    const { useEditorStore } = await import("../src/stores/editorStore");
    const { doc } = await import("./support/editorGenerationDomain");
    useDocumentStore.setState({ documents: [{ ...doc("a", mode), path: "/tmp/original.md", isModified: true }], activeDocumentId: "a" });
    useEditorStore.setState({ viewMode: mode, activeDocumentId: "a", editorView: null });
    calls.length = 0;
    let saving: Promise<unknown> | undefined;
    const hook = renderHook(() => useKeyboardShortcuts({ onSaveAs: () => { saving = saveActiveDocumentAs(); } }));
    const event = new KeyboardEvent("keydown", { key: "S", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(event));
    await saving;
    expect(event.defaultPrevented).toBe(true);
    expect(calls.filter(({ cmd }) => cmd === "save_file_dialog")).toHaveLength(1);
    expect(useDocumentStore.getState().getDocumentById("a")).toMatchObject({ path: "/tmp/saved.md", content: mode, isModified: false });
    hook.unmount();
  } finally {
    Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  }
});
