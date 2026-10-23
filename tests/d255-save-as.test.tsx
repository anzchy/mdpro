/** D255 Save As: menu entry, captured-document save, and conflict feedback. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, responses } = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
  responses: { dialog: null as unknown },
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "save_file_dialog") {
      if (responses.dialog instanceof Error || (responses.dialog && typeof responses.dialog === "object" && ("ExternalChangeConflict" in responses.dialog || "AlreadyOpen" in responses.dialog || "FileTooLarge" in responses.dialog || "InvalidPath" in responses.dialog))) throw responses.dialog;
      return responses.dialog;
    }
    return null;
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "A" }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { dispatchMenuAction } from "../src/hooks/menuActionTable";
import { saveActiveDocumentAs } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { doc } from "./support/editorGenerationDomain";

const oldPath = "/tmp/d255-old.md";
const newPath = "/tmp/d255-new.md";
const original = () => ({ ...doc("a", "编辑\r\n"), path: oldPath, isModified: true });
const byId = () => useDocumentStore.getState().getDocumentById("a")!;
const dialogCalls = () => calls.filter((call) => call.cmd === "save_file_dialog");

beforeEach(() => {
  calls.length = 0;
  responses.dialog = null;
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useDocumentStore.setState({ documents: [original()], activeDocumentId: "a" });
});

describe("D255 Save As", () => {
  it("the menu action opens the dialog and rebinds the captured document", async () => {
    responses.dialog = { success: true, path: newPath, savedAt: 1, changedSinceRead: false };
    const selected: string[] = [];
    let saving: Promise<unknown> | undefined;
    dispatchMenuAction({ action: "file.save_as" }, {
      onSaveAs: (actionId) => { saving = saveActiveDocumentAs(actionId); },
    }, (id) => { selected.push(id); return "d255-save"; });
    await saving;

    expect(selected).toEqual(["menu.file.save_as"]);
    expect(dialogCalls()).toHaveLength(1);
    expect(dialogCalls()[0].args).toMatchObject({ documentId: "a", content: "编辑\r\n" });
    expect(dialogCalls()[0].args).toMatchObject({ originalPath: oldPath });
    expect(byId()).toMatchObject({ path: newPath, content: "编辑\r\n", isModified: false });
  });

  it("a cancelled picker preserves the old dirty document and performs no write", async () => {
    await saveActiveDocumentAs("cancel");
    expect(byId()).toMatchObject({ path: oldPath, content: "编辑\r\n", isModified: true });
    expect(calls.filter((call) => call.cmd === "save_file")).toHaveLength(0);
  });

  it("a typed target conflict reaches save feedback and keeps the old dirty buffer", async () => {
    responses.dialog = { ExternalChangeConflict: { path: newPath } };
    const toasts: string[] = [];
    await performSave("conflict", {
      saveActiveDocument: saveActiveDocumentAs,
      updateRecentFiles: () => {},
      showToast: (message) => toasts.push(message),
    });
    expect(toasts[0]).toMatch(/Save failed:.*external change/i);
    expect(byId()).toMatchObject({ path: oldPath, content: "编辑\r\n", isModified: true });
  });

  it("refuses a target already open in mdpro and preserves the source buffer", async () => {
    responses.dialog = { AlreadyOpen: { path: newPath } };
    const toasts: string[] = [];
    await performSave("already-open", {
      saveActiveDocument: saveActiveDocumentAs,
      updateRecentFiles: () => {},
      showToast: (message) => toasts.push(message),
    });
    expect(toasts[0]).toMatch(/already open in mdpro/i);
    expect(byId()).toMatchObject({ path: oldPath, content: "编辑\r\n", isModified: true });
  });

  it("surfaces a typed oversize snapshot error and keeps the old dirty binding", async () => {
    responses.dialog = { FileTooLarge: { path: oldPath, size: 10 * 1024 * 1024 + 1 } };
    const toasts: string[] = [];
    await performSave("oversize-snapshot", {
      saveActiveDocument: saveActiveDocumentAs,
      updateRecentFiles: () => {},
      showToast: (message) => toasts.push(message),
    });
    expect(toasts[0]).toMatch(/Save failed:.*too large/i);
    expect(byId()).toMatchObject({ path: oldPath, content: "编辑\r\n", isModified: true });
  });

  it("a switch during the picker applies only to the captured document", async () => {
    let resolve!: (value: unknown) => void;
    responses.dialog = new Promise((done) => { resolve = done; });
    const other = { ...doc("b", "other"), path: "/tmp/b.md" };
    useDocumentStore.setState({ documents: [original(), other], activeDocumentId: "a" });
    const saving = saveActiveDocumentAs("switch");
    useDocumentStore.setState({ activeDocumentId: "b" });
    resolve({ success: true, path: newPath, savedAt: 1 });
    await saving;
    expect(byId()).toMatchObject({ path: newPath, content: "编辑\r\n", isModified: false });
    expect(useDocumentStore.getState().getDocumentById("b")).toMatchObject(other);
  });

  it("a replaced document during the picker keeps the newer dirty buffer and old binding", async () => {
    let resolve!: (value: unknown) => void;
    responses.dialog = new Promise((done) => { resolve = done; });
    const saving = saveActiveDocumentAs("replace");
    useDocumentStore.getState().upsertDocument({ ...original(), content: "newer", isModified: true });
    resolve({ success: true, path: newPath, savedAt: 1 });
    await saving;
    expect(byId()).toMatchObject({ path: oldPath, content: "newer", isModified: true });
  });
});
