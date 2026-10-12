/**
 * D178 — a rename never replaces an unresolved content change.
 *
 * Before the fix `recordFileChange` kept one slot per document, the latest event, so an
 * external program that modified notes.md and then moved it to notes2.md left only the
 * `renamed` record. On activation `useExternalChangePrompt` took the rename branch
 * (`updateDocumentPath`, acknowledge "renamed"), the record was gone, no prompt showed,
 * and the next ⌘S wrote the pre-modify buffer to the new path over the external edit.
 *
 * The spec pinned here: the rename is applied (the document's path becomes the new
 * path), and a content change (modified / deleted) recorded before it is carried to the
 * new path — it still prompts on activation and blocks ⌘S until Reload or Ignore. A
 * rename with nothing pending before it still follows silently (no-regression guard).
 *
 * Driven through App's real wiring (`tests/support/externalChangeHarness.tsx`), the
 * real `performSave` → `documentSave.saveActiveDocument` → `fileService.saveFile`.
 * Mock boundary: the Tauri event / core / window modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  B,
  DELETED_MSG,
  MODIFIED_MSG,
  advance,
  deferred,
  emitChange,
  flush,
  ipcCalls,
  ipcCount,
  mountPrompt,
  onIpc,
  reloadMessage,
  resetExternalChangeHarness,
  toasts,
  view,
} from "./support/externalChangeHarness";
import { saveActiveDocument } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

const T0 = 1_700_000_000_000;
const NEW_PATH = "/tmp/b-moved.md";
/** B's buffer: the pre-modify text with an unsaved local edit. */
const DIRTY_B = { ...B, content: "# b, edited before the external write\n", isModified: true };

function activate(id: string) {
  act(() => {
    view.current?.api.setActiveDocumentById(id);
  });
}

function save(actionId = "save-1") {
  return performSave(actionId, {
    saveActiveDocument,
    updateRecentFiles: () => {},
    showToast: (message) => void toasts.push(message),
  });
}

const pathOfB = () => useDocumentStore.getState().getDocumentById("b")?.path;

const blockedLines = () =>
  logLines("file.change.pending").filter((l) => (l.context as { action?: string }).action === "save-blocked");

const saveFilePaths = () => ipcCalls.filter((c) => c.cmd === "save_file").map((c) => c.args.path);

/** The external program's sequence on B: write notes.md, then move it to NEW_PATH. */
function modifyThenRename() {
  emitChange(B.path!, "modified", { timestamp: T0 + 1 });
  emitChange(B.path!, "renamed", { newPath: NEW_PATH, timestamp: T0 + 2 });
}

/** Assert ⌘S writes nothing and logs one `save-blocked` for B on the `save` route. */
async function expectSaveBlocked() {
  await flush(() => save());
  expect(ipcCount("save_file")).toBe(0);
  expect(blockedLines()).toHaveLength(1);
  expect(blockedLines()[0].context).toMatchObject({ documentId: "b", route: "save" });
  expect(useDocumentStore.getState().getDocumentById("b")?.isModified).toBe(true);
}

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useToastStore.setState({ message: null });
  useDocumentStore.setState({ documents: [A, DIRTY_B], activeDocumentId: "a" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D178 — modify then rename on a background tab keeps the content change", () => {
  it("red: activation prompts about the modify at the new path, and ⌘S with no answer writes nothing", async () => {
    await mountPrompt();
    modifyThenRename();
    advance(1000);
    expect(reloadMessage()).toBeNull(); // A is active

    activate("b");
    advance(300);
    expect(pathOfB()).toBe(NEW_PATH); // the rename is applied
    expect(reloadMessage()).toBe(MODIFIED_MSG); // the content change is not silently accepted

    await expectSaveBlocked();
    expect(reloadMessage()).toBe(MODIFIED_MSG); // the prompt stays up
  });

  it("red: Ignore, then ⌘S writes the buffer to the new path", async () => {
    await mountPrompt();
    modifyThenRename();
    advance(1000);
    activate("b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    act(() => view.current?.handleIgnoreReload());
    expect(reloadMessage()).toBeNull();
    await flush(() => save());
    expect(saveFilePaths()).toEqual([NEW_PATH]);
    expect(blockedLines()).toHaveLength(0);
  });

  it("red: Reload reads the new path and replaces the buffer under B's id", async () => {
    await mountPrompt();
    modifyThenRename();
    advance(1000);
    activate("b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    const read = deferred<Document>();
    onIpc("reload_file", () => read.promise);
    let done: Promise<void> = Promise.resolve();
    await flush(() => {
      done = view.current!.handleReloadFile();
    });
    const reloadPaths = ipcCalls.filter((c) => c.cmd === "reload_file").map((c) => c.args.path);
    expect(reloadPaths).toEqual([NEW_PATH]);

    await flush(() =>
      read.resolve(makeDoc({ id: "moved", path: NEW_PATH, content: "# b, as the external program wrote it\n" })),
    );
    await flush(() => done);
    expect(toasts).toContain("File reloaded");
    expect(reloadMessage()).toBeNull();
    const reloaded = useDocumentStore.getState().getDocumentById("b");
    expect(reloaded?.content).toBe("# b, as the external program wrote it\n");
    expect(reloaded?.path).toBe(NEW_PATH);
    expect(reloaded?.isModified).toBe(false);
  });
});

describe("D178 — variants", () => {
  it("guard: a plain rename with nothing pending still follows silently and saves to the new path", async () => {
    await mountPrompt();
    emitChange(B.path!, "renamed", { newPath: NEW_PATH });
    advance(1000);
    activate("b");
    advance(300);
    expect(pathOfB()).toBe(NEW_PATH);
    expect(reloadMessage()).toBeNull();

    await flush(() => save());
    expect(saveFilePaths()).toEqual([NEW_PATH]);
    expect(blockedLines()).toHaveLength(0);
  });

  it("red: deleted then renamed keeps a prompt and blocks ⌘S", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted", { timestamp: T0 + 1 });
    emitChange(B.path!, "renamed", { newPath: NEW_PATH, timestamp: T0 + 2 });
    advance(1000);
    activate("b");
    advance(300);
    expect(pathOfB()).toBe(NEW_PATH);
    // Which message is open (see the report): the pending change is a deletion of the
    // old path, but a file now exists at the new one. Either way it must prompt.
    expect([DELETED_MSG, MODIFIED_MSG]).toContain(reloadMessage());

    await expectSaveBlocked();
  });

  it("red: modify shown on the active tab, then rename → the path moves, the prompt stays, ⌘S blocked", async () => {
    useDocumentStore.setState({ activeDocumentId: "b" });
    await mountPrompt();
    emitChange(B.path!, "modified", { timestamp: T0 + 1 });
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    emitChange(B.path!, "renamed", { newPath: NEW_PATH, timestamp: T0 + 2 });
    advance(1000);
    expect(pathOfB()).toBe(NEW_PATH);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    await expectSaveBlocked();
  });

  it("red: modify and rename inside one debounce on the active tab → the path moves and it prompts", async () => {
    useDocumentStore.setState({ activeDocumentId: "b" });
    await mountPrompt();
    modifyThenRename();
    advance(300);
    expect(pathOfB()).toBe(NEW_PATH);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    await expectSaveBlocked();
  });

  it("red: rename then modify at the new path on a background tab → prompts on activation", async () => {
    await mountPrompt();
    emitChange(B.path!, "renamed", { newPath: NEW_PATH, timestamp: T0 + 1 });
    emitChange(NEW_PATH, "modified", { timestamp: T0 + 2 });
    advance(1000);
    activate("b");
    advance(300);
    expect(pathOfB()).toBe(NEW_PATH);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    await expectSaveBlocked();
  });

  it("two renames in a row on a background tab follow to the last path, silently", async () => {
    const LAST = "/tmp/b-moved-again.md";
    await mountPrompt();
    emitChange(B.path!, "renamed", { newPath: NEW_PATH, timestamp: T0 + 1 });
    emitChange(NEW_PATH, "renamed", { newPath: LAST, timestamp: T0 + 2 });
    advance(1000);
    expect(pathOfB()).toBe(B.path); // a lone rename still waits for activation
    activate("b");
    advance(300);
    expect(pathOfB()).toBe(LAST);
    expect(reloadMessage()).toBeNull();

    await flush(() => save());
    expect(saveFilePaths()).toEqual([LAST]);
    expect(blockedLines()).toHaveLength(0);
  });
});
