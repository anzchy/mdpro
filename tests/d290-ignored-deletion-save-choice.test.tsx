/** D290: ignored deletion must ask before a Save can recreate the old path. */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { AppDialogs } from "../src/components/AppDialogs";
import { prepareForRelaunch } from "../src/hooks/useUpdater";
import { saveActiveDocument } from "../src/services/documentSave";
import { saveAfterIgnoredDeletionChoice } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { performRecreateChoice } from "../src/services/saveService";
import { ignoredDeletionFor, pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { resetHarness } from "./helpers/fileWatcherLogHarness";
import { logLines } from "./helpers/fileWatcherLogHarness";
import { B, advance, emitChange, flush, ipcCount, mountPrompt, resetExternalChangeHarness, toasts, view } from "./support/externalChangeHarness";
import { A, deferred, ipcCalls, onIpc } from "./support/externalChangeHarness";

const DIRTY = { ...B, content: "# edited\n", isModified: true };
type Request = { documentId: string; path: string; seq: number; actionId: string };

function dialog(request: Request | null, onChoice: (choice: string) => void) {
  const props = {
    drafts: [], onRecoverDraft: () => {}, onDiscardDraft: () => {},
    reloadMessage: null, onReload: () => {}, onIgnoreReload: () => {},
    encodingIssue: null, onEncodingSelect: () => {}, onEncodingCancel: () => {},
    confirmDialog: { open: false, message: "" }, onConfirmClose: () => {}, onCancelClose: () => {},
    settingsOpen: false, onSettingsClose: () => {},
    recreateRequest: request, onRecreateChoice: onChoice,
  } as unknown as React.ComponentProps<typeof AppDialogs>;
  return render(<AppDialogs {...props} />);
}

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [DIRTY], activeDocumentId: "b" });
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe("D290 ignored deletion save choice", () => {
  it.each(["move", "delete"])("D290-WI-1 asks before saving after %s + Ignore", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    let request: Request | null = null;
    await flush(() => performSave("d290-save", {
      saveActiveDocument, updateRecentFiles: () => {}, showToast: (message) => toasts.push(message),
      onRecreateRequired: (value: Request) => { request = value; },
    } as Parameters<typeof performSave>[1]));
    expect(ipcCount("save_file")).toBe(0);
    expect(toasts).not.toContain("Saved");
    expect(useDocumentStore.getState().getDocumentById("b")?.isModified).toBe(true);
    dialog(request, () => {});
    expect(screen.getByRole("dialog", { name: "Recreate file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save to original path" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save As…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("D290-WI-2 Cancel leaves the file guarded for another Save", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    const onChoice = vi.fn();
    dialog({ documentId: "b", path: B.path!, seq: 1, actionId: "d290" }, onChoice);
    vi.useRealTimers();
    vi.spyOn(vi, "advanceTimersByTime").mockImplementation(() => vi);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChoice).toHaveBeenCalledWith("cancel");
    expect(ipcCount("save_file")).toBe(0);
    expect(useDocumentStore.getState().getDocumentById("b")?.isModified).toBe(true);
  });

  it("explicit original choice writes once for the captured document and clears its marker", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    const marker = ignoredDeletionFor("b")!;
    await flush(() => saveAfterIgnoredDeletionChoice(marker, "original", "choice-original"));
    expect(ipcCount("save_file")).toBe(1);
    expect(ipcCalls.find((call) => call.cmd === "save_file")?.args).toMatchObject({ documentId: "b", path: B.path });
    expect(ignoredDeletionFor("b")).toBeUndefined();
    expect(useDocumentStore.getState().getDocumentById("b")?.isModified).toBe(false);
  });

  it("Save As cancellation keeps the marker; success moves the path only after the reply", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    const marker = ignoredDeletionFor("b")!;
    onIpc("save_file_dialog", async () => null);
    await flush(() => saveAfterIgnoredDeletionChoice(marker, "save-as", "choice-as-cancel"));
    expect(ipcCount("save_file")).toBe(0);
    expect(ignoredDeletionFor("b")).toEqual(marker);
    const reply = deferred<unknown>();
    onIpc("save_file_dialog", () => reply.promise);
    let save: Promise<unknown> = Promise.resolve();
    await flush(() => { save = saveAfterIgnoredDeletionChoice(marker, "save-as", "choice-as-success"); });
    expect(useDocumentStore.getState().getDocumentById("b")?.path).toBe(B.path);
    await flush(() => reply.resolve({ success: true, path: "/tmp/b-copy.md", savedAt: 10, changedSinceRead: false }));
    await flush(() => save);
    expect(useDocumentStore.getState().getDocumentById("b")?.path).toBe("/tmp/b-copy.md");
    expect(ignoredDeletionFor("b")).toBeUndefined();
  });

  it("an older dialog choice cannot consume a newer deletion", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    const old = ignoredDeletionFor("b")!;
    emitChange(B.path!, "deleted", { timestamp: 2 });
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    const latest = ignoredDeletionFor("b")!;
    expect(latest.seq).toBeGreaterThan(old.seq);
    await flush(() => saveAfterIgnoredDeletionChoice(old, "original", "old-choice"));
    expect(ipcCount("save_file")).toBe(0);
    expect(ignoredDeletionFor("b")).toEqual(latest);
  });

  it("a queued save prompts for its captured document after the active tab changes", async () => {
    useDocumentStore.setState({ documents: [A, DIRTY], activeDocumentId: "b" });
    await mountPrompt();
    const first = deferred<unknown>();
    onIpc("save_file", () => first.promise);
    let initial: Promise<unknown> = Promise.resolve();
    let queued: Promise<unknown> = Promise.resolve();
    let requested: Request | null = null;
    await flush(() => {
      initial = saveActiveDocument("first");
      queued = performSave("queued", { saveActiveDocument, updateRecentFiles: () => {}, showToast: () => {}, onRecreateRequired: (request) => { requested = request; } });
    });
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    act(() => view.current?.api.setActiveDocumentById("a"));
    await flush(() => first.resolve({ success: true, path: B.path, savedAt: 10 }));
    await flush(() => Promise.all([initial, queued]));
    expect(requested).toMatchObject({ documentId: "b", path: B.path });
    expect(ipcCount("save_file")).toBe(1);
    expect(pendingFileChangeFor("b")).toBeUndefined();
  });

  it("Escape chooses Cancel and focus returns to the opener", async () => {
    vi.useRealTimers();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onChoice = vi.fn();
    const rendered = dialog({ documentId: "b", path: B.path!, seq: 1, actionId: "escape" }, onChoice);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.setup().keyboard("{Escape}");
    expect(onChoice).toHaveBeenCalledWith("cancel");
    rendered.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("logs one enum-only decision with the save action id", async () => {
    await performRecreateChoice({ documentId: "b", path: B.path!, seq: 1, actionId: "d290-log" }, "cancel", {
      saveDecision: async () => { throw new Error("should not run"); },
      updateRecentFiles: () => {}, showToast: () => {},
    });
    const lines = logLines("file.save.recreate_choice");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actionId: "d290-log", context: { choice: "cancel", outcome: "cancelled" } });
    expect(JSON.stringify(lines[0].context)).not.toContain("/tmp/");
    expect(JSON.stringify(lines[0].context)).not.toContain("# edited");
  });

  it("relaunch does not silently recreate an ignored deletion", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    let ok = true;
    await flush(async () => { ok = await prepareForRelaunch(); });
    expect(ok).toBe(false);
    expect(ipcCount("save_file")).toBe(0);
    expect(ignoredDeletionFor("b")).toBeDefined();
  });
});
