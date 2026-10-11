/**
 * D163: a failed ⌘S toasts the Rust error text, never `[object Object]`.
 *
 * Device record docs/test/20261011-rc-c8bd2b6-a-device-check.md item 8b (F1): saving
 * into a read-only directory showed `Save failed: [object Object]`. `save_file`
 * returns `Result<SaveResult, FileError>`; `FileError` (src-tauri/src/commands/file.rs)
 * has no serde attributes, so it serializes externally tagged and `invoke` rejects
 * with the plain object `{ PermissionDenied: { path } }` (unit variant: `"DiskFull"`).
 *
 * Boundary: `invoke` (held through `tests/helpers/heldInvoke.ts`) and `loggingService`.
 * Stores, `useDocument` and `performSave` are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const RO_PATH = "/tmp/c8bd2b6-rc-a/ro/s8b.md";

let held: HeldInvoke;

function doc(path: string | null): Document {
  return { id: "doc-a", path, content: "B", encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null };
}

function reset(path: string | null): void {
  useDocumentStore.setState({ documents: [doc(path)], activeDocumentId: "doc-a" });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "source" });
}

/** Run ⌘S through the real `performSave` + `useDocument`, rejecting `cmd` with `error`. */
async function saveRejectedWith(cmd: string, error: unknown): Promise<string[]> {
  held.hold(cmd);
  const api = renderHook(() => useDocument()).result.current;
  const showToast = vi.fn();
  let p!: Promise<void>;
  await act(async () => {
    p = performSave(undefined, { saveActiveDocument: api.saveActiveDocument, updateRecentFiles: vi.fn(), showToast });
    await held.whenCalled(cmd);
  });
  await act(async () => {
    held.fail(cmd, error);
    await p;
  });
  return showToast.mock.calls.map(([m]) => String(m));
}

beforeEach(() => {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  held.assertDrained();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D163 — the save-failure toast carries the Rust FileError text", () => {
  it("save_file rejects with FileError::PermissionDenied — toast names the path, doc stays dirty", async () => {
    reset(RO_PATH);
    const toasts = await saveRejectedWith("save_file", { PermissionDenied: { path: RO_PATH } });
    expect(toasts).toEqual([`Save failed: permission denied: ${RO_PATH}`]);
    expect(toasts.join()).not.toContain("[object Object]");
    expect(useDocumentStore.getState().documents[0]).toMatchObject({ isModified: true, lastSaved: null });
  });

  it("save_file rejects with the unit variant \"DiskFull\" — toast reads disk full", async () => {
    reset(RO_PATH);
    const toasts = await saveRejectedWith("save_file", "DiskFull");
    expect(toasts).toEqual(["Save failed: disk full"]);
  });

  it("untitled ⌘S → save_file_dialog rejects with FileError::IoError — toast carries the message", async () => {
    reset(null);
    const toasts = await saveRejectedWith("save_file_dialog", { IoError: { message: "Read-only file system (os error 30)" } });
    expect(toasts).toEqual(["Save failed: Read-only file system (os error 30)"]);
  });
});
