/**
 * D171 WI-2 — a save never writes over an external change the user has not answered.
 *
 * The check sits where the (possibly queued) save is about to invoke `save_file`, not
 * only at ⌘S: a save queued behind an earlier one (D70) or waiting on
 * `get_preferences` reaches the write later, and an external change recorded in the
 * meantime must stop it. The relaunch save (`prepareForRelaunch`) writes every dirty
 * document through `save_file` too, so it refuses the same way.
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

import { logLines, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  B,
  MODIFIED_MSG,
  advance,
  deferred,
  emitChange,
  flush,
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
import { prepareForRelaunch } from "../src/hooks/useUpdater";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";

const T0 = 1_700_000_000_000;
const DIRTY_B = { ...B, content: "# b, edited\n", isModified: true };

function save(actionId: string) {
  return performSave(actionId, {
    saveActiveDocument,
    updateRecentFiles: () => {},
    showToast: (message) => void toasts.push(message),
  });
}

const blockedLines = () =>
  logLines("file.change.pending").filter((l) => (l.context as { action?: string }).action === "save-blocked");

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useToastStore.setState({ message: null });
  useDocumentStore.setState({ documents: [A, DIRTY_B], activeDocumentId: "b" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D171 WI-2 — a pending external change blocks the write", () => {
  it("red 3a: pending record on B → activate B → immediate ⌘S writes nothing", async () => {
    useDocumentStore.setState({ activeDocumentId: "a" });
    await mountPrompt();
    emitChange(B.path!);
    act(() => view.current?.api.setActiveDocumentById("b"));

    await flush(() => save("save-1")); // inside the 300 ms presentation debounce
    expect(ipcCount("save_file")).toBe(0);
    expect(toasts.some((t) => /changed on disk/i.test(t))).toBe(true);
    expect(blockedLines()).toHaveLength(1);
    expect(blockedLines()[0].context).toMatchObject({ documentId: "b" });
    expect(useDocumentStore.getState().getDocumentById("b")?.isModified).toBe(true);

    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("red 3b: a save queued before the event, reaching save_file after it, writes nothing", async () => {
    await mountPrompt();
    const first = deferred<unknown>();
    onIpc("save_file", () => first.promise);

    let s1: Promise<void> = Promise.resolve();
    let s2: Promise<void> = Promise.resolve();
    await flush(() => {
      s1 = save("save-1"); // in flight in save_file
      s2 = save("save-2"); // queued behind it (D70)
    });
    expect(ipcCount("save_file")).toBe(1);

    emitChange(B.path!); // the external write lands while save-2 waits
    await flush(() => first.resolve({ success: true, path: B.path, savedAt: T0 + 1 }));
    await flush(() => Promise.all([s1, s2]));

    expect(ipcCount("save_file")).toBe(1);
    expect(blockedLines()).toHaveLength(1);
  });

  it("after Ignore the same document saves normally", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
    act(() => view.current?.handleIgnoreReload());

    await flush(() => save("save-1"));
    expect(ipcCount("save_file")).toBe(1);
    expect(blockedLines()).toHaveLength(0);
  });

  it("another document's pending change does not block this one", async () => {
    await mountPrompt();
    emitChange(A.path!);
    await flush(() => save("save-1"));
    expect(ipcCount("save_file")).toBe(1);
  });

  it("the relaunch save refuses while a dirty document has a pending change", async () => {
    useDocumentStore.setState({ activeDocumentId: "a" });
    await mountPrompt();
    emitChange(B.path!);

    let ok = true;
    await flush(async () => {
      ok = await prepareForRelaunch();
    });
    expect(ok).toBe(false);
    expect(ipcCount("save_file")).toBe(0);
    expect(blockedLines()).toHaveLength(1);
  });
});
