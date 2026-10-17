/**
 * D261-WI-1d: the save entry check. App's menu `onSave` runs
 * `saveIfCurrent(token, actionId, run)` (`src/utils/menuTargetToken.ts`), and
 * `run` is `performSave`, which commits by the id `saveActiveDocument` captured
 * at entry (unchanged).
 *
 * Law (S5, "commit by captured id"): a save that passes its entry check writes
 * the document that was active at entry, with that document's content,
 * whatever becomes active while it awaits. A save whose token is stale at entry
 * performs no write IPC and logs one `stale` line with `stage:"save_entry"`.
 *
 * Real `documentStore`, `saveService.performSave`, `documentSave` and
 * `saveIfCurrent`. Mocked: `@tauri-apps/api/{core,window}`. `invoke` records
 * every IPC, holds `save_file_dialog` on a promise the test resolves, answers
 * `save_file` with success and captures `log_event`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, logs, ipc, dialog } = vi.hoisted(() => ({
  win: { label: "A" },
  logs: [] as Array<Record<string, unknown>>,
  ipc: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
  dialog: { resolve: null as ((value: unknown) => void) | null },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: win.label }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") {
      logs.push((args.payload as Record<string, unknown>) ?? {});
      return Promise.resolve(null);
    }
    ipc.push({ cmd, args });
    if (cmd === "save_file_dialog") {
      return new Promise((resolve) => {
        dialog.resolve = resolve;
      });
    }
    if (cmd === "save_file") {
      return Promise.resolve({ success: true, path: args.path, savedAt: 1 });
    }
    return Promise.resolve(null);
  },
}));

import { saveActiveDocument } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";
import { captureToken, saveIfCurrent } from "../src/utils/menuTargetToken";
import { doc, newView } from "./support/editorGenerationDomain";

const deps = () => ({
  saveActiveDocument,
  updateRecentFiles: () => {},
  showToast: useToastStore.getState().showToast,
});

const untitled = (id: string, content: string): Document => ({ ...doc(id, content), path: null, isModified: true });
const byId = (id: string) => useDocumentStore.getState().documents.find((d) => d.id === id);
const writes = () => ipc.filter((c) => c.cmd === "save_file" || c.cmd === "save_file_dialog");
const staleLines = () =>
  logs.filter((l) => l.event === "ui.menu.select" && (l.context as { reason?: string })?.reason === "stale");

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

beforeEach(() => {
  win.label = "A";
  logs.length = 0;
  ipc.length = 0;
  dialog.resolve = null;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.getState().setEditorView(null);
  useToastStore.getState().clearToast();
});

describe("Save As, then a switch while the dialog is open, still saves the original (S5)", () => {
  type Target = "d2" | "d3";
  type Timing = "switch" | "close-and-switch";
  const grid: Array<[Target, Timing]> = [
    ["d2", "switch"],
    ["d2", "close-and-switch"],
    ["d3", "switch"],
    ["d3", "close-and-switch"],
  ];

  it.each(grid)("switch target %s, timing %s", async (target, timing) => {
    const d2: Document = { ...doc("d2", "two"), path: "/x/d2.md" };
    const d3 = untitled("d3", "three");
    useDocumentStore.setState({ documents: [untitled("d1", "one"), d2, d3], activeDocumentId: "d1" });
    const other = target === "d2" ? "d3" : "d2";
    const targetBefore = { ...byId(target)! };

    const token = captureToken("A");
    const saving = saveIfCurrent(token, "act-1", () => performSave("act-1", deps()));
    await until(() => dialog.resolve !== null);

    if (timing === "switch") {
      useDocumentStore.getState().setActiveDocument(target);
    } else {
      useDocumentStore.getState().setActiveDocument(other);
      useDocumentStore.getState().closeDocument(other);
      useDocumentStore.getState().setActiveDocument(target);
    }
    dialog.resolve!({ success: true, path: "/tmp/x.md", savedAt: 5, changedSinceRead: false, blockedByPendingChange: false });
    await expect(saving).resolves.toBe(true);

    // Level 6, a supplement: the dialog was asked to save d1's own content.
    const dialogArgs = ipc.filter((c) => c.cmd === "save_file_dialog").map((c) => c.args);
    expect(dialogArgs).toHaveLength(1);
    expect(dialogArgs[0]).toMatchObject({ documentId: "d1", content: "one" });

    // Level 5: the store result.
    expect(byId("d1")).toMatchObject({ path: "/tmp/x.md", isModified: false, content: "one" });
    const targetAfter = byId(target)!;
    expect({ content: targetAfter.content, path: targetAfter.path, isModified: targetAfter.isModified }).toEqual({
      content: targetBefore.content,
      path: targetBefore.path,
      isModified: targetBefore.isModified,
    });
    expect(useDocumentStore.getState().activeDocumentId).toBe(target);
    expect(ipc.filter((c) => c.cmd === "save_file")).toHaveLength(0);
    expect(staleLines()).toHaveLength(0);
  });
});

describe("a token stale at entry saves nothing (S4 over the three causes)", () => {
  it.each(["SWITCH", "AWAY_BACK", "REMOUNT"] as const)("%s", async (cause) => {
    useDocumentStore.setState({
      documents: [{ ...doc("d1", "one"), path: "/tmp/d1.md", isModified: true }, doc("d2", "two")],
      activeDocumentId: "d1",
    });
    const token = captureToken("A");
    if (cause === "SWITCH") {
      useDocumentStore.getState().setActiveDocument("d2");
    } else if (cause === "AWAY_BACK") {
      useDocumentStore.getState().setActiveDocument("d2");
      useDocumentStore.getState().setActiveDocument("d1");
    } else {
      useEditorStore.getState().setEditorView(newView());
    }
    const d2Before = { ...byId("d2")! };
    logs.length = 0;

    const saved = await saveIfCurrent(token, "act-9", () => performSave("act-9", deps()));

    expect(saved).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(byId("d1")!.isModified).toBe(true);
    expect(byId("d2")).toEqual(d2Before);
    const stale = staleLines();
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ event: "ui.menu.select", status: "cancel", actionId: "act-9" });
    expect(stale[0].context).toMatchObject({ windowLabel: "A", reason: "stale", stage: "save_entry" });
  });

  it("a missing token fails closed: no write, one stale line", async () => {
    useDocumentStore.setState({
      documents: [{ ...doc("d1", "one"), path: "/tmp/d1.md", isModified: true }],
      activeDocumentId: "d1",
    });
    const saved = await saveIfCurrent(undefined, "act-10", () => performSave("act-10", deps()));
    expect(saved).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(staleLines()).toHaveLength(1);
  });
});

describe("a current token saves the active document (S1, positive control)", () => {
  it("returns true; save_file succeeds and d1 is clean", async () => {
    useDocumentStore.setState({
      documents: [{ ...doc("d1", "one"), path: "/tmp/d1.md", isModified: true }, doc("d2", "two")],
      activeDocumentId: "d1",
    });
    const saved = await saveIfCurrent(captureToken("A"), "act-2", () => performSave("act-2", deps()));
    expect(saved).toBe(true);
    expect(ipc.filter((c) => c.cmd === "save_file").map((c) => c.args.documentId)).toEqual(["d1"]);
    expect(byId("d1")!.isModified).toBe(false);
    expect(useToastStore.getState().message).toBe("Saved");
    expect(staleLines()).toHaveLength(0);
  });
});
